"""Exercise the byte-only converter locally without building/publishing an image."""
import importlib.util
from http.server import HTTPServer
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError

SOURCE = Path(__file__).resolve().parents[1] / "apps/api/container/server.py"
spec = importlib.util.spec_from_file_location("preview_server", SOURCE)
server_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server_module)

class PreviewTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), server_module.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join()
    def send(self, query, data):
        return urlopen(Request(f"http://127.0.0.1:{self.server.server_port}/convert?{query}", data=data, method="POST"), timeout=40)
    def test_invalid_parameters(self):
        for query in ("kind=video&time=nan", "kind=url&time=0", "kind=video&time=-1"):
            with self.assertRaises(HTTPError) as caught: self.send(query, b"untrusted")
            self.assertEqual(caught.exception.code, 400)
    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg is required for the local conversion check")
    def test_video_frame(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "sample.mp4"
            subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=64x64:d=1", "-c:v", "mpeg4", str(source)], check=True, timeout=20)
            with self.send("kind=video&time=0", source.read_bytes()) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers["Content-Type"], "image/png")
                self.assertTrue(response.read().startswith(b"\x89PNG\r\n\x1a\n"))

if __name__ == "__main__": unittest.main()
