"""Local, anonymous fixtures shared by the installed-browser smoke tests."""

import http.server
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        fixture = {"/article": "article.html", "/docs": "docs.html"}.get(self.path)
        if fixture:
            body = (ROOT / "tests/fixtures/semantic" / fixture).read_text()
            title = "mdfier · Capture examples"
        elif self.path == "/empty":
            body, title = "", "Empty page"
        else:
            count = 500 if self.path == "/500" else 24
            records = "".join(
                f"<section><h2>Record {i:03}</h2><p>Loaded route {i:03}: useful field observations and route details.</p></section>"
                for i in range(1, count + 1)
            )
            body = f"<nav>Navigation noise</nav><main><h1>Field records</h1>{records}<p>FINAL RECORD COMPLETE</p></main><footer>Footer noise</footer>"
            title = "Field records"
        html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
        <title>{title}</title><style>
        body {{ margin: 32px auto; padding: 0 32px; max-width: 680px;
          color: #243730; background: #fafbf9; font: 16px/1.65 system-ui,sans-serif }}
        h1 {{ font-size: 32px; line-height: 1.2 }} h2 {{ font-size: 21px }}
        a {{ color: #246452 }} nav, footer {{ color: #6c7771; font-size: 13px }}
        pre {{ padding: 16px; background: #edf1ed; border-radius: 8px; overflow: auto }}
        blockquote {{ border-left: 3px solid #246452; margin-left: 0; padding-left: 20px }}
        table {{ width: 100%; border-collapse: collapse }} th, td {{ padding: 8px; border-bottom: 1px solid #ced8d0; text-align: left }}
        </style></head><body>{body}</body></html>"""
        self.send_response(200)
        self.send_header("Content-Type", "text/html;charset=utf-8")
        self.end_headers()
        self.wfile.write(html.encode())

    def log_message(self, *args):
        pass


def start_server():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
