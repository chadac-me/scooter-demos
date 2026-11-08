/**
 * Screen capture: a virtual X display, a 60 fps lossless grab of it, and the
 * encode into the published MP4, WebM and poster. A headed browser on Xvfb
 * grabbed by ffmpeg holds a steady frame rate, which Playwright's recordVideo
 * doesn't.
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err = (err + d).slice(-4000)));
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}\n${err}`))));
  });
}

/** Start Xvfb on `display`, sized to the viewport. */
export async function startDisplay({ display, width, height }) {
  const xvfb = spawn("Xvfb", [display, "-screen", "0", `${width}x${height}x24`, "-nolisten", "tcp", "-ac"], { stdio: "ignore" });
  await sleep(800);
  if (xvfb.exitCode !== null) throw new Error(`Xvfb ${display} failed to start`);
  return () => xvfb.kill("SIGTERM");
}

/** Grab the display to a lossless file. Markers are times relative to the first frame. */
export async function startRecording({ display, width, height, fps, file }) {
  mkdirSync(dirname(file), { recursive: true });
  const ff = spawn(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-stats", "-f", "x11grab", "-draw_mouse", "0", "-framerate", String(fps), "-video_size", `${width}x${height}`, "-i", display,
     "-c:v", "libx264rgb", "-preset", "ultrafast", "-qp", "0", file],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  // The first progress line means frames are flowing; time zero is then.
  const t0 = await new Promise((resolve, reject) => {
    ff.stderr.once("data", () => resolve(Date.now()));
    ff.once("exit", (c) => reject(new Error(`ffmpeg exited ${c} before recording`)));
  });
  const marks = {};
  return {
    mark: (name) => (marks[name] = (Date.now() - t0) / 1000),
    marks,
    stop: () =>
      new Promise((resolve) => {
        ff.once("exit", resolve);
        // "q" lets ffmpeg finish the file cleanly.
        ff.stdin.end("q");
      }),
  };
}

/** Trim the raw grab to [begin, end] and write the published files. */
export async function encode({ raw, marks, out, fps }) {
  const begin = Math.max(0, (marks.begin ?? 0) - 0.2);
  const end = marks.end ?? undefined;
  const span = ["-ss", begin.toFixed(3), ...(end ? ["-to", end.toFixed(3)] : []), "-i", raw];
  mkdirSync(dirname(out), { recursive: true });
  await run("ffmpeg", ["-y", ...span, "-r", String(fps), "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", `${out}.mp4`]);
  await run("ffmpeg", ["-y", ...span, "-r", String(fps), "-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", "-an", `${out}.webm`]);
  const poster = marks.poster ?? end ?? begin;
  await run("ffmpeg", ["-y", "-ss", poster.toFixed(3), "-i", raw, "-frames:v", "1", `${out}.png`]);
  return { duration: (end ?? begin) - begin };
}
