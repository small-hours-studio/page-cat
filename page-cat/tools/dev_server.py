"""Local dev server for the test pages: serves the page-cat folder, and lets a test page save
PNG screenshots into store/screenshots/ with  POST /save/<name>.png  (body = PNG data URL).

Run from the page-cat folder:  python tools/dev_server.py [port]
Binds to 127.0.0.1 only.
"""
import base64
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "store" / "screenshots"


class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        m = re.fullmatch(r"/save/([a-z0-9-]+\.png)", self.path)
        if not m:
            self.send_error(404)
            return
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode()
        data = base64.b64decode(body.split(",", 1)[1])
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / m.group(1)).write_bytes(data)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"saved")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8767
    ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(ROOT))).serve_forever()
