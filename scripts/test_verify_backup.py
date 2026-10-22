import gzip
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("verify_backup", Path(__file__).with_name("verify-backup.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BackupVerification(unittest.TestCase):
    def test_original_and_gzip_hashes_and_missing_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            export, storage = root / "export", root / "r2"
            storage.mkdir()
            (export / "artifacts").mkdir(parents=True)
            (export / "commentFiles").mkdir()
            data = b"%PDF-original"
            (storage / "original").write_bytes(data)
            (storage / "compressed").write_bytes(gzip.compress(data))
            (storage / "inventory.json").write_text(json.dumps([
                {"key": "a", "file": "original"},
                {"key": "b", "file": "compressed", "encoding": "gzip"},
            ]))
            row = {"_id": "a", "objectKey": "a", "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
            (export / "artifacts/documents.jsonl").write_text(json.dumps(row))
            (export / "commentFiles/documents.jsonl").write_text(json.dumps({**row, "_id": "b", "objectKey": "b", "status": "verified"}))
            self.assertEqual(module.verify(export, storage), {"checked": 2, "failures": [], "ok": True})
            (storage / "original").write_bytes(b"corrupt")
            self.assertFalse(module.verify(export, storage)["ok"])
            (export / "commentFiles/documents.jsonl").unlink()
            self.assertFalse(module.verify(export, storage)["ok"])

    def test_empty_export_does_not_establish_readiness(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "inventory.json").write_text("[]")
            self.assertFalse(module.verify(root, root)["ok"])


if __name__ == "__main__":
    unittest.main()
