/**
 * Build out/ from per-demo artifacts; unrendered demos keep live videos.
 *
 *   node lib/assemble.mjs <parts-dir>
 *
 * <parts-dir> holds one render job's out/ per subdirectory.
 */

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const OUT = join(ROOT, "out");
const BASE = process.env.SITE_URL ?? "https://chadac-me.github.io/scooter-demos";
const parts = resolve(process.argv[2] ?? "parts");

const names = readdirSync(join(ROOT, "demos")).filter((n) => existsSync(join(ROOT, "demos", n, "demo.yaml")));
mkdirSync(OUT, { recursive: true });

// This run's renders, keyed by demo.
const fresh = {};
let rev;
for (const part of existsSync(parts) ? readdirSync(parts) : []) {
  const file = join(parts, part, "manifest.json");
  if (!existsSync(file)) continue;
  const m = JSON.parse(readFileSync(file, "utf8"));
  rev ??= m.scooterRev;
  for (const [name, d] of Object.entries(m.demos)) fresh[name] = { ...d, dir: join(parts, part) };
}

let live;
async function liveManifest() {
  if (live === undefined) {
    const res = await fetch(`${BASE}/manifest.json`);
    live = res.ok ? await res.json() : { demos: {} };
  }
  return live;
}

async function download(file) {
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok) throw new Error(`${BASE}/${file} answered ${res.status}`);
  writeFileSync(join(OUT, file), Buffer.from(await res.arrayBuffer()));
}

const demos = {};
const rendered = [];
const kept = [];
const missing = [];
for (const name of names) {
  if (fresh[name]) {
    const { dir, ...d } = fresh[name];
    for (const r of d.renders) for (const f of r.files) copyFileSync(join(dir, f), join(OUT, f));
    demos[name] = d;
    rendered.push(name);
    continue;
  }
  const old = (await liveManifest()).demos[name];
  if (!old) {
    missing.push(name);
    continue;
  }
  // Drops WebMs listed by older renders.
  const renders = old.renders.map((r) => ({ ...r, files: r.files.filter((f) => /\.(mp4|png)$/.test(f)) }));
  for (const r of renders) for (const f of r.files) await download(f);
  demos[name] = { ...old, renders };
  kept.push(name);
}

writeFileSync(
  join(OUT, "manifest.json"),
  JSON.stringify({ demos, scooterRev: rev ?? live?.scooterRev, renderedAt: new Date().toISOString() }, null, 2) + "\n",
);

const summary = [
  "## Gallery",
  `- **Rendered:** ${rendered.join(", ") || "none"}`,
  `- **Kept from the live site:** ${kept.join(", ") || "none"}`,
  ...(missing.length ? [`- **Not on the site** (no render, nothing published before): ${missing.join(", ")}`] : []),
].join("\n");
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
