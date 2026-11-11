"""The tracker's dev server: its files under the base path, with live reload.

    serve.py --port 5173 --base "$REVIEW_BASE"

Serves the working directory. Pages get a live-reload script: CSS edits swap
in place, any other edit reloads the page.
"""

import argparse
import json
import os
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

LIVE = b"""<script>
new EventSource("__live").addEventListener("change", (e) => {
  if (!JSON.parse(e.data).every((p) => p.endsWith(".css"))) return location.reload();
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    const url = new URL(link.href);
    url.searchParams.set("v", Date.now());
    link.href = url.href;
  }
});
</script>
"""


def snapshot(root: Path) -> dict[str, int]:
    return {str(p.relative_to(root)): p.stat().st_mtime_ns for p in root.rglob("*") if p.is_file()}


def make_handler(base: str, root: Path):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

        def end_headers(self):
            # Every save must show on the next load.
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def log_message(self, fmt, *args):
            pass

        def live(self):
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            seen, idle = snapshot(root), 0.0
            try:
                self.wfile.write(b": hello\n\n")
                self.wfile.flush()
                while True:
                    time.sleep(0.25)
                    now = snapshot(root)
                    changed = sorted(k for k in now.keys() | seen.keys() if now.get(k) != seen.get(k))
                    idle += 0.25
                    if changed:
                        seen, idle = now, 0.0
                        self.wfile.write(f"event: change\ndata: {json.dumps(changed)}\n\n".encode())
                    elif idle >= 15:
                        idle = 0.0
                        self.wfile.write(b": ping\n\n")
                    else:
                        continue
                    self.wfile.flush()
            except OSError:
                pass

        def page(self, path: Path):
            body = path.read_bytes().replace(b"</body>", LIVE + b"</body>", 1)
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = urlsplit(self.path).path
            if path + "/" == base:
                self.send_response(HTTPStatus.MOVED_PERMANENTLY)
                self.send_header("Location", base)
                self.end_headers()
                return
            if not path.startswith(base):
                return self.send_error(HTTPStatus.NOT_FOUND, "outside the app's base path")
            rest = path[len(base):]
            if rest == "__live":
                return self.live()
            file = (root / (rest or "index.html")).resolve()
            if file.suffix == ".html" and file.parent == root.resolve() and file.is_file():
                return self.page(file)
            self.path = "/" + rest
            super().do_GET()

    return Handler


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=int(os.environ.get("PORT", "5173")))
    p.add_argument("--base", default=os.environ.get("REVIEW_BASE", "/"))
    args = p.parse_args()
    base = "/" + args.base.strip("/") + "/" if args.base.strip("/") else "/"
    root = Path.cwd()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(base, root))
    server.daemon_threads = True
    print(f"Tidewater tracker on http://localhost:{args.port}{base}, serving {root}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
