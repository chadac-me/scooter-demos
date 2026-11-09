# scooter-demos: five more demos

## Problem

The gallery has four demos: `math`, `ask-user`, `inline-dashboard` and `marimo`. All four
show Scooter replying in chat or opening a page it made. None of them shows the user and
Scooter working on the same surface: a live notebook, a doc under review, an editor, a
running app, a desktop. These five demos cover that.

All five run on `stack: cluster`, because each needs a real sandbox service. The pod has
no internet, so whatever a demo opens has to be baked into the sandbox image, the way
`nix/marimo-offline.nix` bakes in marimo.

## Proposal

Each demo is about 30 to 45 s, rendered in light and dark like the others. "Real" means
the pinned Scooter actually does it. "Scripted" means the replay agent fakes it.

### 1. `marimo-pair`: pairing in a live notebook

The user already has a notebook open: the `ci_trends.py` from the `marimo` demo, with the
chat beside it. Scooter writes no file. It works in the user's running kernel.

1. Prompt in the side chat: *"Why did e2e full get slower last week? Dig in here."*
2. Scooter thinks, then runs marimo-pair's `execute-code` against the kernel. Two new
   cells appear in the notebook while the user watches: a per-day breakdown and a
   p50/p95 line chart.
3. The user edits a cell on camera, changing the window from 7 to 14 days.
4. Prompt: *"I changed the window. Does it still hold?"* Scooter reads the edited cell
   from the kernel, then answers with a number the notebook just computed.

Poster: the notebook with the new chart, and the chat explaining it.
Real: the notebook, the kernel, and every cell marimo-pair creates. The `shell` steps
run unscripted. Scripted: the reasoning and the prose.

### 2. `design-review`: reviewing a design doc in Files

1. Prompt: *"Design retry handling for the outbox and send it to me."*
2. Scooter writes `docs/design/outbox-retry.md` and replies with a files-viewer link.
   That turn is this skill working as it is meant to.
3. The user opens the link. The doc renders with two question forms. The user
   highlights a line, comments *"what happens during a rolling deploy?"*, then picks an
   option in one of the question forms.
4. Both remarks wake Scooter as a Files event in the chat. Scooter rewrites that
   section, replies in the thread as "Scooter", and resolves it. The viewer shows the
   revised section and the open count going from 2 to 0.

Poster: the rendered doc, with the comment thread and the answered question beside it.
Real: the viewer, the annotations, the self-access wake and the thread reply.
Scripted: the doc's content and both revisions, which are written from files in the
demo folder.

### 3. `vscode`: working with Scooter in VS Code

1. In chat, the user asks Scooter to open the repo in Code. Scooter starts `vscode` and
   links it.
2. VS Code opens on a small TypeScript service. The user opens a file, selects a
   function, and asks in **VS Code's chat panel**: *"This retries forever. Cap it at
   five and add a test."*
3. The reply streams into VS Code's chat. That chat is this conversation, carried over
   the AHP bridge. The editor gets the edit as a diff, and a new test file appears in
   the explorer.
4. The user runs the test in VS Code's terminal, and it passes. Last shot: the same
   turn showing in Scooter's own chat tab.

Poster: VS Code with the diff and the chat panel open.
Real: code-server, the AHP bridge, the file writes and the test run. Scripted: the
reasoning and the reply.

### 4. `webservice`: changing a company's running app from feedback

This demo shows only the last part: Scooter changing a web app the company already owns.
The company is a fictional one, **Tidewater Freight**, and its shipment tracker is
already running as a custom `webServices.tracker`. That service has the app on the
left, this conversation's chat on the right, and a pin overlay for feedback. Scooter
built it in an earlier conversation that we don't show. Scooter itself gets no new
layout feature.

1. The demo opens on the running tracker, with the chat on the right.
2. The user drops three pins on the page: *"these status badges are hard to read"* on
   a badge, *"ETA first"* on the table header, and *"our logo here"* on the header.
   Each pin posts to `$SCOOTER_SELF_URL` with the element's selector, and that wakes
   Scooter the way a Files comment does.
3. Scooter edits the existing app without asking first, and the app pane hot-reloads
   after each fix. The pin turns into a check mark, and the chat on the right logs one
   line per fix.

Poster: the reworked app with resolved pins, and the chat's list of applied changes.
Real: the service, the proxy, the self-access wake, the hot reload and the edits.
Scripted: the reasoning and the replies. The app, the wrapper page and the
`webServices.tracker` module are baked into the demo image (`demos/webservice/app/`
and `nix/tracker.nix`), so the demo needs no `scooter-rebuild` and has no canned output.

### 5. `desktop`: GPlates over VNC

Here too, the custom web service is the thing on show. Scooter writes a `desktop`
service for this one conversation; Scooter itself gets no new contrib. The service runs
Xvfb, a minimal window manager, x11vnc and noVNC (websockify) under
`$SCOOTER_SERVICE_PREFIX/desktop`.

1. Prompt: *"Open GPlates and show me the plate reconstruction at 120 Ma with the
   coastlines."*
2. Scooter writes `/etc/scooter/modules/desktop.nix`, runs `scooter-rebuild switch` and
   `scooter-service start desktop`, launches GPlates on the display with its bundled
   sample data, and links the desktop.
3. The noVNC tab opens on the GPlates globe. Scooter drives it with `xdotool`, so the
   user watches the menus move without touching anything: the time is set to 120 Ma
   and the coastlines are loaded.
4. The user takes over: they drag the globe, then ask *"export that as a PNG for my
   slides"*. Scooter exports it, and the PNG renders inline in the chat.

Poster: the globe at 120 Ma, with the chat beside it.
Real: the desktop service, VNC, GPlates and xdotool. Scripted: the `scooter-rebuild
switch` output (the module is pre-baked into the demo image), the
reasoning and the prose. The module lives in scooter-demos (`nix/desktop.nix`), next to
`marimo-offline.nix`.

## Harness work these need

| Change | For |
| --- | --- |
| Replay agent: a turn can set `match:` (a regex) instead of `prompt:`, to match wake messages from Files and from feedback on the running app | 2, 4 |
| Replay agent: a `write` step can send a second version of a file (a revision), shown as an edit | 2, 4 |
| Director: `typeIn(locator, text)` for inputs inside iframes (the VS Code chat, the viewer's comment box) | 2, 3 |
| Director: `clickAt(canvas, x, y)` and `dragOn(canvas, …)` for noVNC's canvas | 5 |
| Offline images: code-server (its stub builds on first start, which needs internet), the demo repo, the tracker app's deps, and GPlates with its sample data | 3, 4, 5 |
| Demo image: the tracker app, wrapper and pin overlay plus `nix/tracker.nix`, already running; and `nix/desktop.nix`, the same module the agent writes on camera, so starting it works offline | 4, 5 |
| `testContribs`: turn on `files` and `code-server` next to `marimo` | 2, 3 |

The cluster platform already gives sandboxes `SCOOTER_SELF_URL`. The marimo demo shows
that the self-access wake works on k3d.

## Alternatives

- **Run 2 and 3 on the fast stack.** That stack has no sandbox, so there is no files
  viewer, no code-server and no wake. The demos would have to fake the very things they
  exist to show.
- **A Scooter feature for an app-plus-chat layout, and a `contrib/desktop`.** Rejected:
  these demos are there to show that Scooter can build custom web services itself. A
  layout or desktop that Scooter already ships would hide that.
- **QGIS or ParaView for demo 5.** Both are well known, so neither reads as a niche
  tool. GPlates is in nixpkgs, ships its own sample data, and its rotating globe makes a
  better frame.
- **A real `scooter-rebuild switch` on camera.** It needs the nix store to be reachable
  from the pod. That makes the demo slow and not deterministic, for one line of output.

## Decisions

- **Layout for demo 4:** demo-only. The app-plus-chat wrapper is part of the custom
  `webServices.tracker`, because custom web services are what the demo shows off.
- **Scope of demo 4:** only the feedback loop on an app the company already runs. The
  build happens off camera, so the demo has no `scooter-rebuild` step.
- **Feedback in demo 4:** pins on the page. They live in an overlay that Scooter writes
  into the same service, and they wake Scooter through self-access.
- **App for demo 5:** GPlates.
- **VNC service:** a demo-only `webServices.desktop` module in scooter-demos. Scooter
  writes it on camera.
- **Build order:** demos 1 to 3 first, since they only need harness work. Then demos 4
  and 5.
