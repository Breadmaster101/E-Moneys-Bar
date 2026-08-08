"""
Static file server for local development.

Identical to `python -m http.server` except that it refuses to let the browser
cache anything. Plain http.server answers with 304 Not Modified, which means an
edited stylesheet or module keeps serving the old copy until you manually hard
-refresh, which is easy to mistake for the change not working.

    python tools/devserver.py [port]
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_header(self, keyword, value):
        # drop the validator that lets the browser ask for a 304 at all
        if keyword.lower() == "last-modified":
            return
        super().send_header(keyword, value)

    def log_message(self, fmt, *args):
        if "304" not in (fmt % args):
            super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    handler = partial(NoCacheHandler, directory=".")
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"E-Money's Bar, serving on http://localhost:{port}")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
