# scooter-demos

Short videos of Scooter at work, for the [Scooter docs](https://chadac-me.github.io/scooter/).
Every video is defined in code and rendered against a pinned Scooter, so one
command rebuilds them all whenever the UI changes.

Gallery: <https://chadac-me.github.io/scooter-demos/>

## How it works

Each demo plays a **script** of what the agent says and does (reasoning, streamed
replies, tool calls, question cards) through a small ACP agent, the *replay
agent*, in place of a model. Everything else is the real thing: Scooter's UI,
agent-host and conversation-router, booted as Scooter's own fast e2e stack from
the commit `flake.lock` pins. The story stays the same between renders, and the
UI is always the pinned version.

A **scene** drives the browser the way a person would on camera: paced typing,
a gliding pointer, holds. Chromium runs headed on Xvfb and ffmpeg grabs the
display at 60 fps. The grab is then trimmed to the scene's `begin`/`end` marks and
encoded to MP4 (H.264), WebM (VP9) and a poster PNG, in light and dark.

```
demos/<name>/
  demo.yaml     title, blurb, stack, extra manifest rows, routed pages
  script.yaml   the agent's turns
  scene.mjs     what the "user" does on camera
lib/
  replay-agent/ the ACP agent that plays script.yaml
  director.mjs  scene helpers
  capture.mjs   Xvfb + ffmpeg grab and encode
  render.mjs    boots the stack and renders demos into out/
  site.mjs      builds the gallery page from out/manifest.json
```

## Rendering

Everything comes from the dev shell (node, Postgres, the router, Chromium,
ffmpeg, Xvfb, fonts), so a laptop and CI render the same frames.

```bash
nix develop
npm ci
just render                 # every fast-stack demo, light and dark, into out/
just render math            # one demo
just preview math           # headless with Playwright's recorder: quick, not smooth
just site                   # out/index.html
```

The first render copies the pinned Scooter source into `.cache/` and builds it,
which takes a few minutes. Later renders reuse it. Set `SCOOTER_DIR` to point at
a Scooter checkout you have already built.

Postgres refuses to run as root, so render as a regular user.

## Updating the videos

1. `just bump` moves the pinned Scooter to its latest `main`.
2. Run the **render** workflow (Actions → render → Run workflow). It renders
   every demo, summarises them on the run page and publishes the gallery to
   GitHub Pages. Untick *publish* to look at the artifact first.

Nothing renders on a schedule.

## Embedding in the docs

Each demo's "Embed" snippet on the gallery page shows the light render in light
mode and the dark render in dark mode:

```html
<video class="scooter-demo only-light" src="https://chadac-me.github.io/scooter-demos/math-light.mp4"
       poster="https://chadac-me.github.io/scooter-demos/math-light.png" autoplay muted loop playsinline></video>
```

## Writing a demo

1. Copy the closest demo to `demos/<name>/`. Any folder with a `demo.yaml` is
   picked up by `just render`, the workflow and the gallery; nothing else to
   register.
2. Write `script.yaml` (what the agent does) and `scene.mjs` (what the user
   does). The scene's prompts must match the script's `prompt`s.
3. Iterate with `just preview <name>`: it fails fast on a locator that never
   appears, and leaves a recording in `out/preview/`.
4. Do a real `just render <name>` and check the poster and both themes in `out/`.
5. Commit. The videos themselves come from the render workflow.

`script.yaml` is a list of turns, each matched to the user's prompt (case and
whitespace are ignored):

```yaml
title: Conversation title
pace: { say: 240, think: 420 }    # characters per second (optional)
turns:
  - prompt: The exact text the scene types
    steps:
      - think: Reasoning, streamed into the Reasoning block.
      - shell: { command: ls src/, output: "app.ts\n" }   # leave out output to run it for real
      - tool: { title: publish, input: { ... }, output: "..." }
      - say: Markdown reply, streamed.
      - pause: 400
      - ask:                                             # an ask-user question card
          header: Database
          question: Which database?
          options: [{ label: SQLite, description: ... }, { label: Postgres, description: ... }]
          then: { SQLite: [ ...steps ], Postgres: [ ...steps ] }
```

`scene.mjs` exports a function of the director:

```js
import { scene } from "../../lib/director.mjs";

export default scene(async (d) => {
  await d.open();
  d.mark("begin");
  await d.ask("The exact text the scene types");   // type, send, wait for the reply
  await d.focus(".katex-display");                  // smooth-scroll it to the centre
  d.mark("poster");
  await d.hold(3000);
  d.mark("end");
});
```

The video is trimmed to `begin`…`end`, and the poster is the frame at `poster`.
The director (`lib/director.mjs`) also has:

| Helper | Does |
| --- | --- |
| `type(text)`, `send()`, `waitForReply()` | the pieces of `ask` |
| `moveTo(target)`, `click(target)` | glide the drawn pointer, then click |
| `drag(target, { dx, dy })` | press, glide and release, e.g. a slider |
| `submitCard(card, button)` | answer an ask-user card |
| `scrollToEnd()`, `park()` | show the reply's tail; move the pointer aside |
| `use(page)` | carry on in another tab, such as one a link opened |
| `hold(ms)`, `settle()` | pause on camera; wait for layout to stop moving |

`d.page` is the Playwright page, for locators and anything else. Targets are
locators or CSS selectors.

In `demo.yaml`, `manifest` adds contrib UI rows the shipped manifest lacks
(opt-in contribs such as `math`), and `routes` serves files for URLs the fast
stack can't, such as a published share.

## Cluster demos

A demo that needs a real sandbox, such as `marimo`, sets `stack: cluster` and
plays on a local k3d cluster running Scooter's e2e platform (`.#cluster`). That
platform runs the replay agent through `scooter.agent.command` and bakes marimo
into the sandbox image, so the cluster needs no internet once its images are in.

```bash
lib/cluster-up.sh           # registry, cluster, images, platform: ~10 minutes
just render marimo
k3d cluster delete scooter-demos
```

The renderer port-forwards the UI and serves it, and each conversation's service
origin (`https://<id>.sandbox.e2e.test`), through local TLS edges.

Scripts for cluster demos can also use:

```yaml
      - write: { path: /workspace/nb.py, from: nb.py }   # a file from the demo's folder
      - shell:
          command: scooter-service start notebook       # runs for real
          capture: { url: 'https://\S+/notebook/' }      # later steps can say ${url}
```

Inside a Scooter sandbox, run both through `docker-netns`, and run
`lib/cluster-up.sh` outside the dev shell: the sandbox's own `k3d` adds the
`/dev/kmsg` stand-in k3s needs there.

## Not yet

- **marimo in CI**: the render workflow doesn't bring up the cluster yet, so
  `marimo` renders locally only.
- **`just record`**: writing a script from a real goose run. For now, scripts
  are written by hand.
