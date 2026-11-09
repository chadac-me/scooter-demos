/**
 * Render demos: boot Scooter's fast stack with the replay agent, play each
 * demo's scene in a headed browser on a virtual display, and encode the grab.
 *
 *   node lib/render.mjs [--preview] [--all] [--theme light|dark|both] [demo ...]
 *
 * Run it inside this repo's dev shell, which provides SCOOTER_SRC (the pinned
 * Scooter source), Chromium, ffmpeg and Xvfb. Demos with `stack: cluster` play
 * against the k3d platform from lib/cluster-up.sh; render those inside dockerd's
 * network: `docker-netns nix develop -c node lib/render.mjs <demo>`.
 */

import { spawn, spawnSync } from "node:child_process";
import { connect } from "node:net";
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { chromium } from "playwright-core";
import YAML from "yaml";

import { encode, startDisplay, startRecording } from "./capture.mjs";
import { Director, FAST_STACK_CSS, seeded } from "./director.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const DEMOS = join(ROOT, "demos");
const OUT = join(ROOT, "out");
const CACHE = join(ROOT, ".cache");
const UI = "http://127.0.0.1:5173";
// The app treats localhost as its own origin, so the browser uses that name.
const BROWSER_UI = "http://localhost:5173";
const ROUTER = "http://127.0.0.1:8080";
// The cluster's UI Service, port-forwarded; its nginx also proxies the API.
const CLUSTER_UI = "http://127.0.0.1:8899";
// ingress.host and ingress.sandboxDomain of the cluster platform (flake.nix).
const CLUSTER_HOST = "scooter.e2e.test";
const SANDBOX_DOMAIN = "sandbox.e2e.test";
const SANDBOX_EDGE_PORT = "8897";
const UI_EDGE_PORT = "8443";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    preview: { type: "boolean", default: false },
    // With no names, cluster demos too; needs lib/cluster-up.sh first.
    all: { type: "boolean", default: false },
    theme: { type: "string", default: "both" },
    fps: { type: "string", default: "60" },
  },
});

const log = (m) => console.log(`[render] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];

function must(cmd, args, cwd) {
  log(`${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}`);
}

/** A writable, built copy of the pinned Scooter, reused across renders. */
function scooterCheckout() {
  const src = process.env.SCOOTER_SRC;
  if (!src) throw new Error("SCOOTER_SRC is unset; run inside `nix develop`");
  const dir = process.env.SCOOTER_DIR ?? join(CACHE, `scooter-${process.env.SCOOTER_REV ?? "src"}`);
  if (!existsSync(join(dir, ".built"))) {
    mkdirSync(dir, { recursive: true });
    cpSync(src, dir, { recursive: true });
    must("chmod", ["-R", "u+w", dir]);
    must("npm", ["ci", "--no-audit", "--no-fund"], dir);
    must("npm", ["run", "pretest:e2e"], dir);
    // Every contrib's UI rows, as a deployment with all contribs enabled serves them.
    must("nix", ["build", `${src}#contrib-ui-manifest`, "-o", join(dir, ".manifest")], dir);
    writeFileSync(join(dir, ".built"), "");
  }
  return dir;
}

/** The GOOSE_BIN agent-host runs; it gets a filtered env, so paths are baked in. */
function replayWrapper() {
  const bin = join(CACHE, "bin", "replay-agent");
  mkdirSync(join(CACHE, "bin"), { recursive: true });
  writeFileSync(
    bin,
    `#!/bin/sh\nexport DEMO_SCRIPTS=${JSON.stringify(DEMOS)}\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(ROOT, "lib/replay-agent/agent.mjs"))}\n`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

async function waitFor(url, name, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not up yet.
    }
    await sleep(500);
  }
  throw new Error(`${name} not healthy at ${url}`);
}

function startService(name, cmd, args, cwd, env) {
  log(`starting ${name}`);
  // Its own process group, so stopping it also stops what npm and node spawned.
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "inherit"], detached: true });
  children.push(p);
  return p;
}

/** Stop every service and wait for each to exit, so the next stack gets the ports. */
async function stopServices() {
  const exits = children.map((c) => (c.exitCode !== null || c.signalCode !== null ? null : new Promise((r) => c.once("exit", r))));
  for (const c of children) {
    try {
      process.kill(-c.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  await Promise.all(exits.filter(Boolean));
  children.length = 0;
}

/** Resolve true if something already listens on the port. */
function listening(port) {
  return new Promise((res) => {
    const s = connect({ host: "127.0.0.1", port });
    s.once("connect", () => (s.destroy(), res(true)));
    s.once("error", () => res(false));
  });
}

/** Scooter's fast stack: Postgres, agent-host with the replay agent, router, UI. */
async function startFastStack(dir) {
  // A stale server on these ports would silently stand in for ours.
  for (const port of [55432, 8080, 5173]) {
    if (await listening(port)) throw new Error(`port ${port} is already in use; stop the old stack first`);
  }
  const state = join(CACHE, "state", String(Date.now()));
  startService("backend", "node", ["test/e2e/support/fakeBackend.mjs"], dir, {
    E2E_AGENT_BIN: replayWrapper(),
    LOCAL_STATE_PATH: join(state, "local"),
    MIRROR_STATE_PATH: join(state, "mirror"),
    GOOSE_MODEL: "claude-opus",
    AGENT_AVAILABLE_MODELS: "claude-opus",
    CONV_TOKEN_SECRET: "scooter-demos",
  });
  await waitFor(`${ROUTER}/healthz`, "backend");
  startService("ui", "npm", ["--prefix", "services/ui", "run", "dev", "--", "--host", "127.0.0.1", "--strictPort"], dir, { AGENT_HOST_URL: ROUTER });
  await waitFor(UI, "ui");
}

/** The k3d platform's UI, plus an edge standing in for the sandbox Ingress. */
async function startClusterStack(dir) {
  const forward = (name, svc, ports) => startService(name, "kubectl", ["-n", "agent-sandbox", "port-forward", svc, ports], ROOT, {});
  forward("ui forward", "svc/ui", "8899:8080");
  forward("sandbox forward", "svc/agent-host", "8896:8082");
  const certs = join(CACHE, "edge");
  mkdirSync(certs, { recursive: true });
  const [cert, key] = [join(certs, "cert.pem"), join(certs, "key.pem")];
  if (!existsSync(cert)) {
    const req = ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30", "-keyout", key, "-out", cert, "-subj", `/CN=*.${SANDBOX_DOMAIN}`];
    if (spawnSync("openssl", req, { stdio: "ignore" }).status !== 0) throw new Error("openssl could not make the edge certificate");
  }
  startService("sandbox edge", "node", ["test/e2e/support/sandboxEdge.mjs", SANDBOX_EDGE_PORT, "127.0.0.1:8896", cert, key], dir, {});
  // The UI over HTTPS too, so the notebook page may frame the chat.
  startService("ui edge", "node", ["test/e2e/support/sandboxEdge.mjs", UI_EDGE_PORT, "127.0.0.1:8899", cert, key], dir, {});
  await waitFor(`${CLUSTER_UI}/`, "cluster ui");
  await clearConversations();
}

/** Delete every conversation, so earlier takes don't show in the sidebar. */
async function clearConversations() {
  const res = await fetch(`${CLUSTER_UI}/conversations`);
  if (!res.ok) throw new Error(`listing conversations answered ${res.status}`);
  const body = await res.json();
  for (const c of Array.isArray(body) ? body : body.conversations) {
    await fetch(`${CLUSTER_UI}/conversations/${encodeURIComponent(c.id)}`, { method: "DELETE" });
  }
}

/** The env minus proxy settings, which would bypass the sandbox edge. */
function withoutProxy(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !/^(https?|all|no)_proxy$/i.test(k)));
}

/** Merge demo-specific manifest rows over the shipped ones. */
function mergeDeep(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? mergeDeep(base[k] ?? {}, v) : v;
  }
  return out;
}

function loadDemo(name) {
  const dir = join(DEMOS, name);
  const meta = YAML.parse(readFileSync(join(dir, "demo.yaml"), "utf8"));
  return { name, dir, ...meta };
}

async function renderOne(demo, theme, manifest, rng) {
  const width = demo.viewport?.width ?? 1440;
  const height = demo.viewport?.height ?? 900;
  const fps = Number(opts.fps);
  const out = join(OUT, `${demo.name}-${theme}`);
  const raw = join(CACHE, "raw", `${demo.name}-${theme}.mkv`);
  const display = ":99";

  const stopDisplay = opts.preview ? () => {} : await startDisplay({ display, width, height });
  // A persistent context, so the page opens in the kiosk window rather than a new one.
  const profile = join(CACHE, "profile");
  rmSync(profile, { recursive: true, force: true });
  const onCluster = demo.stack === "cluster";
  const kiosk = ["--kiosk", `--window-size=${width},${height}`, "--window-position=0,0", "--disable-infobars", "--hide-scrollbars"];
  // The UI and service origins go to the edges, which are self-signed.
  const edge = onCluster
    ? [`--host-resolver-rules=MAP *.${SANDBOX_DOMAIN} 127.0.0.1:${SANDBOX_EDGE_PORT}, MAP ${CLUSTER_HOST} 127.0.0.1:${UI_EDGE_PORT}`]
    : [];
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.PW_CHROME,
    headless: opts.preview,
    env: { ...(onCluster ? withoutProxy(process.env) : process.env), DISPLAY: display },
    args: [...(opts.preview ? [] : kiosk), ...edge],
    ignoreHTTPSErrors: onCluster,
    baseURL: onCluster ? `https://${CLUSTER_HOST}` : BROWSER_UI,
    viewport: opts.preview ? { width, height } : null,
    colorScheme: theme,
    locale: "en-US",
    timezoneId: "UTC",
    ...(opts.preview ? { recordVideo: { dir: join(OUT, "preview"), size: { width, height } } } : {}),
  });
  // The cluster serves its own contrib manifest.
  if (!onCluster) {
    manifest = JSON.stringify(mergeDeep(JSON.parse(manifest), demo.manifest ?? {}));
    await context.route("**/contrib/manifest.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: manifest }));
  }
  // Pages a demo needs that the fast stack can't serve, such as a published share.
  for (const [glob, file] of Object.entries(demo.routes ?? {})) {
    const body = readFileSync(join(demo.dir, file));
    await context.route(glob, (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body }));
  }
  const page = context.pages()[0] ?? (await context.newPage());

  const markers = { marks: {}, mark(n) { this.marks[n] = Date.now(); } };
  let rec;
  if (!opts.preview) rec = await startRecording({ display, width, height, fps, file: raw });
  const director = new Director(page, { markers: rec ?? markers, rng, css: onCluster ? "" : FAST_STACK_CSS });
  await director.prepare();
  const { default: scene } = await import(join(demo.dir, "scene.mjs"));
  try {
    await scene(director, { theme });
  } finally {
    await rec?.stop();
    await context.close();
    stopDisplay();
  }
  if (opts.preview) return { theme };
  log(`encoding ${demo.name} (${theme})`);
  const { duration } = await encode({ raw, marks: rec.marks, out, fps });
  return { theme, duration: Number(duration.toFixed(2)), files: ["mp4", "webm", "png"].map((e) => `${demo.name}-${theme}.${e}`) };
}

async function main() {
  const names = positionals.length ? positionals : readdirSync(DEMOS).filter((n) => existsSync(join(DEMOS, n, "demo.yaml")));
  // Cluster demos need lib/cluster-up.sh first, so they render only by name or --all.
  const demos = names.map(loadDemo).filter((d) => positionals.length || opts.all || d.stack !== "cluster");
  const themes = opts.theme === "both" ? ["light", "dark"] : [opts.theme];
  const dir = scooterCheckout();
  const manifest = readFileSync(join(dir, ".manifest"), "utf8");
  const manifestFile = join(OUT, "manifest.json");
  const index = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : { demos: {} };
  for (const demo of demos) {
    const renders = [];
    for (const theme of themes) {
      log(`${demo.name} (${theme})`);
      // A fresh stack per render, so no earlier conversation shows in the sidebar.
      await (demo.stack === "cluster" ? startClusterStack(dir) : startFastStack(dir));
      try {
        // Seeded per demo, so a demo's typing rhythm doesn't depend on which others ran.
        renders.push(await renderOne(demo, theme, manifest, seeded(demo.seed ?? 1)));
      } finally {
        await stopServices();
      }
    }
    index.demos[demo.name] = { title: demo.title, blurb: demo.blurb, renders };
  }
  index.scooterRev = process.env.SCOOTER_REV;
  index.renderedAt = new Date().toISOString();
  mkdirSync(OUT, { recursive: true });
  if (!opts.preview) writeFileSync(manifestFile, JSON.stringify(index, null, 2) + "\n");
}

try {
  await main();
} finally {
  await stopServices();
}
