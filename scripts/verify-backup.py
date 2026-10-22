#!/usr/bin/env python3
"""Read-only verification of an extracted Convex export against a local R2 backup.

Usage: python3 scripts/verify-backup.py EXPORT_DIR R2_DIR
R2_DIR/inventory.json: [{"key": "...", "file": "objects/001", "encoding": "gzip"}]
No network calls, restore operations, secret reads, or changes to either backup.
"""
import gzip
import hashlib
import json
import sys
from pathlib import Path


def verify(export, storage):
    inventory = json.loads((storage / "inventory.json").read_text())
    objects = {}
    for item in inventory:
        if item["key"] in objects:
            raise ValueError("duplicate inventory key")
        objects[item["key"]] = item
    checked = 0
    failures = []
    for table in ("artifacts", "commentFiles"):
        source = export / table / "documents.jsonl"
        if not source.is_file():
            failures.append({"table": table, "reason": "missing_table_export"})
            continue
        for line in source.read_text().splitlines():
            row = json.loads(line)
            key = row.get("objectKey")
            if not key or (table == "commentFiles" and row.get("status") != "verified"):
                continue
            if not isinstance(row.get("size"), int) or row["size"] < 0:
                failures.append({"table": table, "id": row["_id"], "reason": "missing_size"})
                continue
            item = objects.get(key)
            if item is None:
                failures.append({"table": table, "id": row["_id"], "reason": "missing_object"})
                continue
            path = (storage / item["file"]).resolve()
            if not path.is_relative_to(storage.resolve()):
                raise ValueError("inventory file escapes backup directory")
            digest = hashlib.sha256()
            size = 0
            opener = gzip.open if item.get("encoding") == "gzip" else open
            with opener(path, "rb") as data:
                while chunk := data.read(1024 * 1024):
                    size += len(chunk)
                    if size > row.get("size", size):
                        break
                    digest.update(chunk)
            if not row.get("sha256"):
                failures.append({"table": table, "id": row["_id"], "reason": "missing_checksum"})
            elif digest.hexdigest() != row["sha256"] or size != row["size"]:
                failures.append({"table": table, "id": row["_id"], "reason": "content_mismatch"})
            else:
                checked += 1
    return {"checked": checked, "failures": failures, "ok": checked > 0 and not failures}


if __name__ == "__main__":
    try:
        result = verify(Path(sys.argv[1]), Path(sys.argv[2]))
        print(json.dumps(result))
        sys.exit(0 if result["ok"] else 1)
    except (OSError, ValueError, KeyError, IndexError) as error:
        print(json.dumps({"ok": False, "reason": type(error).__name__}))
        sys.exit(1)
