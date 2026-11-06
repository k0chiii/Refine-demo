"""Private, byte-only preview converter. No URLs, shell, secrets, or caller-controlled flags."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlparse, parse_qs
import math
import subprocess

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            url = urlparse(self.path)
            opts = parse_qs(url.query)
            size = int(self.headers.get("Content-Length", "0"))
            kind = opts.get("kind", [""])[0]
            time = float(opts.get("time", ["0"])[0])
            if url.path != "/convert" or kind not in ("pdf", "video") or not 0 < size <= 20_000_000 or not math.isfinite(time) or not 0 <= time <= 3600:
                self.send_error(400); return
            body = self.rfile.read(size)
            if len(body) != size:
                self.send_error(400); return
            with TemporaryDirectory() as directory:
                source, output = Path(directory) / "source", Path(directory) / "result.png"
                source.write_bytes(body)
                if kind == "pdf":
                    command = ["pdftoppm", "-f", "1", "-singlefile", "-scale-to", "1600", "-png", str(source), str(output.with_suffix(""))]
                else:
                    command = ["ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-ss", str(time), "-i", str(source), "-frames:v", "1", "-vf", "scale=min(1600\\,iw):-2", str(output)]
                subprocess.run(command, check=True, timeout=30, capture_output=True, env={"PATH": "/usr/bin:/bin"})
                data = output.read_bytes()
                if len(data) > 20_000_000: raise ValueError("output too large")
                self.send_response(200); self.send_header("Content-Type", "image/png"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
        except (ValueError, OSError, subprocess.SubprocessError):
            self.send_error(422)
    def log_message(self, *_args):
        pass

if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
