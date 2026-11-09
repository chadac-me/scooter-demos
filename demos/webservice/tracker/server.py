"""Tidewater's tracker service: the app with live reload, the chat beside it, and pins.

    server.py                 serve (the webServices.tracker unit)
    server.py resolve <id>    mark a pin resolved (the `tracker` command)

Pins left on the page are POSTed here, stored, and announced to this conversation
through the router's self-access listener, so a note on the page wakes Scooter.
"""

import json
import os
import shutil
import sys
import threading
import time
import urllib.error
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

PORT = int(os.environ.get("TRACKER_PORT", "2730"))
APP = Path(os.environ.get("TRACKER_APP_DIR", "/workspace/tracker"))
SEED = Path(os.environ.get("TRACKER_SEED", ""))
STATIC = Path(os.environ.get("TRACKER_STATIC", Path(__file__).parent))
PINS = Path(os.environ.get("TRACKER_PINS", APP.parent / ".tracker" / "pins.json"))

TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json",
    ".png": "image/png",
}
OVERLAY = b'<script src="../_t/pins.js" defer></script>\n'


def log(msg: str) -> None:
    print(f"tracker: {msg}", file=sys.stderr, flush=True)


class Hub:
    """Server-sent events to every open page: file changes and pin updates."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.queues: list[list[bytes]] = []
        self.cond = threading.Condition(self.lock)

    def publish(self, event: str, data: object) -> None:
        msg = f"event: {event}\ndata: {json.dumps(data)}\n\n".encode()
        with self.cond:
            for q in self.queues:
                q.append(msg)
            self.cond.notify_all()

    def stream(self, write) -> None:
        q: list[bytes] = []
        with self.cond:
            self.queues.append(q)
        try:
            write(b": hello\n\n")
            while True:
                with self.cond:
                    self.cond.wait_for(lambda: q, timeout=15)
                    out, q[:] = list(q), []
                write(b"".join(out) or b": ping\n\n")
        finally:
            with self.cond:
                self.queues.remove(q)


class Pins:
    """The page's pins, kept on the workspace so they survive a restart."""

    def __init__(self, path: Path, hub: Hub) -> None:
        self.path, self.hub = path, hub
        self.lock = threading.Lock()
        self.items: list[dict] = json.loads(path.read_text()) if path.exists() else []

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.items, indent=2))
        tmp.replace(self.path)
        self.hub.publish("pins", self.items)

    def add(self, body: dict) -> dict:
        with self.lock:
            pin = {
                "id": max((p["id"] for p in self.items), default=0) + 1,
                "selector": str(body.get("selector", ""))[:400],
                "text": " ".join(str(body.get("text", "")).split())[:80],
                "note": str(body.get("note", "")).strip()[:2000],
                "fx": float(body.get("fx", 0.5)),
                "fy": float(body.get("fy", 0.5)),
                "x": float(body.get("x", 0)),
                "y": float(body.get("y", 0)),
                "resolved": False,
                "created": time.time(),
            }
            self.items.append(pin)
            self.save()
        return pin

    def resolve(self, pin_id: int) -> dict | None:
        with self.lock:
            for pin in self.items:
                if pin["id"] == pin_id:
                    pin["resolved"] = True
                    self.save()
                    return pin
        return None


def pid1_env(name: str) -> str:
    """Units inherit no pod env, so read what the pod was given from PID 1."""
    if os.environ.get(name):
        return os.environ[name]
    try:
        for kv in Path("/proc/1/environ").read_bytes().split(b"\0"):
            k, _, v = kv.decode(errors="replace").partition("=")
            if k == name:
                return v
    except OSError:
        pass
    return ""


def wake(pin: dict) -> None:
    """Tell this conversation about a new pin, as a tracker event."""
    url, token_path, conv = pid1_env("SCOOTER_SELF_URL"), pid1_env("SCOOTER_SELF_TOKEN_PATH"), pid1_env("CONVERSATION_ID")
    if not (url and token_path and conv):
        log("no SCOOTER_SELF_URL, token or CONVERSATION_ID: pin stored, nobody woken")
        return
    where = f'`{pin["selector"]}`' + (f' ("{pin["text"]}")' if pin["text"] else "")
    text = (
        f"New pin #{pin['id']} on the shipment tracker, at {where}:\n\n"
        + "\n".join(f"> {line}" for line in pin["note"].splitlines() or [""])
        + f"\n\nThe app's source is {APP}; the page reloads on save. "
        + f"Run `tracker resolve {pin['id']}` once it's addressed."
    )
    try:
        token = Path(token_path).read_text().strip()
        req = urllib.request.Request(
            f"{url.rstrip('/')}/conversations/{conv}/messages",
            data=json.dumps({"text": text, "source": "tracker"}).encode(),
            method="POST",
            headers={"authorization": f"Bearer {token}", "content-type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as res:
            res.read()
        log(f"pin {pin['id']} sent to the conversation")
    except (OSError, urllib.error.URLError) as exc:
        log(f"pin {pin['id']} not delivered: {exc}")


def watch(hub: Hub) -> None:
    """Poll the app's files and announce what changed."""

    def snapshot() -> dict[str, float]:
        return {str(p.relative_to(APP)): p.stat().st_mtime_ns for p in APP.rglob("*") if p.is_file()}

    seen = snapshot()
    while True:
        time.sleep(0.25)
        try:
            now = snapshot()
        except OSError:
            continue
        changed = sorted(k for k in now.keys() | seen.keys() if now.get(k) != seen.get(k))
        if changed:
            seen = now
            hub.publish("change", changed)


def chat_url() -> str:
    """This conversation's chat, on the main UI origin."""
    if os.environ.get("SCOOTER_CHAT_URL"):
        return os.environ["SCOOTER_CHAT_URL"]
    app, conv = pid1_env("CONVERSATION_URL"), pid1_env("CONVERSATION_ID")
    if not (app and conv):
        return ""
    u = urlsplit(app)
    return f"{u.scheme}://{u.netloc}/chat/{conv}"


def handler(hub: Hub, pins: Pins):
    shell = (STATIC / "shell.html").read_text().replace("@CHAT_URL@", chat_url()).encode()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # quiet: one line per pin is enough
            pass

        def send(self, status: int, body: bytes, ctype: str) -> None:
            self.send_response(status)
            self.send_header("content-type", ctype)
            self.send_header("content-length", str(len(body)))
            # Every save must show on the next load.
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def json(self, data: object, status: int = 200) -> None:
            self.send(status, json.dumps(data).encode(), "application/json")

        def file(self, root: Path, rel: str, overlay: bool = False) -> None:
            path = (root / (rel or "index.html")).resolve()
            if root.resolve() not in path.parents and path != root.resolve() or not path.is_file():
                return self.send(404, b"not found", "text/plain")
            body = path.read_bytes()
            if overlay and path.suffix == ".html":
                body = body.replace(b"</body>", OVERLAY + b"</body>", 1)
            self.send(200, body, TYPES.get(path.suffix, "application/octet-stream"))

        def do_GET(self) -> None:
            path = unquote(urlsplit(self.path).path)
            if path in ("/", "/index.html"):
                return self.send(200, shell, TYPES[".html"])
            if path == "/app":
                self.send_response(HTTPStatus.FOUND)
                self.send_header("location", "app/")
                self.send_header("content-length", "0")
                return self.end_headers()
            if path.startswith("/app/"):
                return self.file(APP, path[len("/app/"):], overlay=True)
            if path.startswith("/_t/"):
                return self.file(STATIC, path[len("/_t/"):])
            if path == "/api/pins":
                return self.json(pins.items)
            if path == "/api/events":
                self.send_response(200)
                self.send_header("content-type", "text/event-stream")
                self.send_header("cache-control", "no-store")
                self.send_header("x-accel-buffering", "no")
                self.end_headers()
                self.close_connection = True

                def write(b: bytes) -> None:
                    self.wfile.write(b)
                    self.wfile.flush()

                try:
                    hub.stream(write)
                except OSError:
                    pass
                return
            self.send(404, b"not found", "text/plain")

        def do_POST(self) -> None:
            path = urlsplit(self.path).path
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
            except ValueError:
                return self.json({"error": "bad json"}, 400)
            if path == "/api/pins":
                if not str(body.get("note", "")).strip():
                    return self.json({"error": "empty note"}, 400)
                pin = pins.add(body)
                threading.Thread(target=wake, args=(pin,), daemon=True).start()
                return self.json(pin, 201)
            parts = path.strip("/").split("/")
            if len(parts) == 4 and parts[:2] == ["api", "pins"] and parts[3] == "resolve" and parts[2].isdigit():
                pin = pins.resolve(int(parts[2]))
                return self.json(pin) if pin else self.json({"error": "no such pin"}, 404)
            self.json({"error": "not found"}, 404)

    return Handler


def serve() -> None:
    if not APP.exists() and SEED.is_dir():
        shutil.copytree(SEED, APP)
        for p in [APP, *APP.rglob("*")]:
            p.chmod(0o755 if p.is_dir() else 0o644)
        log(f"seeded {APP} from {SEED}")
    hub = Hub()
    pins = Pins(PINS, hub)
    threading.Thread(target=watch, args=(hub,), daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), handler(hub, pins))
    server.daemon_threads = True
    log(f"serving {APP} on :{PORT}")
    server.serve_forever()


def resolve(pin_id: str) -> int:
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/pins/{pin_id}/resolve", data=b"{}", method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            pin = json.load(res)
    except urllib.error.HTTPError as exc:
        print(f"tracker: pin {pin_id}: {json.load(exc).get('error', exc.code)}", file=sys.stderr)
        return 1
    print(f"pin #{pin['id']} resolved: {pin['note']}")
    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args == ["serve"]:
        serve()
    elif len(args) == 2 and args[0] == "resolve":
        sys.exit(resolve(args[1]))
    else:
        print("usage: tracker [serve] | tracker resolve <pin>", file=sys.stderr)
        sys.exit(2)
