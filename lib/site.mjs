/**
 * Build the gallery page (out/index.html) from out/manifest.json: every demo
 * with its video, blurb and the snippet to embed it in the Scooter docs.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const OUT = resolve(new URL("../out", import.meta.url).pathname);
const BASE = process.env.SITE_URL ?? "https://chadac-me.github.io/scooter-demos";
const index = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8"));

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** The docs snippet: the light and dark renders, each shown in its own theme. */
function snippet(name, themes) {
  return themes
    .map(
      (t) =>
        `<video class="scooter-demo only-${t}" src="${BASE}/${name}-${t}.mp4" poster="${BASE}/${name}-${t}.png" autoplay muted loop playsinline></video>`,
    )
    .join("\n");
}

const cards = Object.entries(index.demos)
  .map(([name, d]) => {
    const themes = d.renders.map((r) => r.theme);
    const videos = d.renders
      .map(
        (r) => `<video class="only-${r.theme}" poster="${name}-${r.theme}.png" autoplay muted loop playsinline>
          <source src="${name}-${r.theme}.webm" type="video/webm"><source src="${name}-${r.theme}.mp4" type="video/mp4"></video>`,
      )
      .join("");
    const secs = Math.round(d.renders[0]?.duration ?? 0);
    return `<section id="${esc(name)}">
      <h2>${esc(d.title)} <span class="len">${secs}s</span></h2>
      <p>${esc(d.blurb)}</p>
      <div class="frame">${videos}</div>
      <details><summary>Embed</summary><pre><code>${esc(snippet(name, themes))}</code></pre></details>
    </section>`;
  })
  .join("\n");

const rev = index.scooterRev ?? "unknown";
writeFileSync(
  join(OUT, "index.html"),
  `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Scooter demos</title>
<style>
  :root { color-scheme: light dark; --bg: #fafaf7; --ink: #1d1d22; --ink-2: #5b5b66; --line: #e6e4dd; }
  @media (prefers-color-scheme: dark) { :root { --bg: #141417; --ink: #ededf2; --ink-2: #a3a3ae; --line: #2b2b33; } }
  body { margin: 0 auto; max-width: 1000px; padding: 40px 24px; background: var(--bg); color: var(--ink); font: 15px/1.5 Inter, system-ui, sans-serif; }
  h1 { margin: 0 0 4px; } .sub { color: var(--ink-2); margin: 0 0 32px; }
  section { margin-bottom: 48px; } h2 { font-size: 18px; margin: 0 0 4px; } .len { color: var(--ink-2); font-weight: 400; font-size: 14px; }
  p { color: var(--ink-2); margin: 0 0 12px; }
  .frame { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; line-height: 0; }
  video { width: 100%; height: auto; }
  .only-dark { display: none; }
  @media (prefers-color-scheme: dark) { .only-dark { display: block; } .only-light { display: none; } }
  details { margin-top: 8px; color: var(--ink-2); } pre { overflow-x: auto; font-size: 12px; background: var(--line); padding: 10px; border-radius: 6px; line-height: 1.4; }
</style>
<h1>Scooter demos</h1>
<p class="sub">Rendered from Scooter <a href="https://github.com/chadac-me/scooter/commit/${esc(rev)}"><code>${esc(rev.slice(0, 7))}</code></a> on ${esc(index.renderedAt?.slice(0, 10))}. Source: <a href="https://github.com/chadac-me/scooter-demos">chadac-me/scooter-demos</a>.</p>
${cards}
</html>
`,
);
console.log(`[site] wrote ${join(OUT, "index.html")}`);
