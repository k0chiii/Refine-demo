#!/usr/bin/env python3
"""Assemble a temporary export+R2 layout, then run verify-backup (A-14 dry-run).

This does not talk to Convex or R2. It proves the restore-check pipeline:
copy fixtures into a staging dir, then verify hashes. Real restore remains
manual per docs/RECOVERY.md.
"""
from __future__ import annotations

import gzip
import hashlib
import importlib.util
import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("verify_backup", ROOT / "verify-backup.py")
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def build_fixture(staging: Path) -> tuple[Path, Path]:
    export = staging / "restored-export"
    storage = staging / "restored-r2"
    (export / "artifacts").mkdir(parents=True)
    (export / "commentFiles").mkdir()
    storage.mkdir()
    data = b"%PDF-restore-dryrun"
    (storage / "original").write_bytes(data)
    (storage / "compressed").write_bytes(gzip.compress(data))
    (storage / "inventory.json").write_text(
        json.dumps(
            [
                {"key": "a", "file": "original"},
                {"key": "b", "file": "compressed", "encoding": "gzip"},
            ]
        )
    )
    row = {
        "_id": "a",
        "objectKey": "a",
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }
    (export / "artifacts/documents.jsonl").write_text(json.dumps(row))
    (export / "commentFiles/documents.jsonl").write_text(
        json.dumps({**row, "_id": "b", "objectKey": "b", "status": "verified"})
    )
    return export, storage


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="mf100-restore-dryrun-") as temporary:
        staging = Path(temporary)
        export, storage = build_fixture(staging)
        # Mimic "restore": copy into a second tree the operator would check.
        checked_export = staging / "checked" / "export"
        checked_r2 = staging / "checked" / "r2"
        shutil.copytree(export, checked_export)
        shutil.copytree(storage, checked_r2)
        result = module.verify(checked_export, checked_r2)
        print(json.dumps(result, ensure_ascii=False))
        if not result.get("ok"):
            print("restore dry-run verify failed", file=sys.stderr)
            return 1
        print("restore dry-run verify ok")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
