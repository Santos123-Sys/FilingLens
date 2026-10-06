#!/usr/bin/env python3
"""Materialize and execute an exact Python utility from a user-supplied skill ZIP.

The repository stores the original ZIP bytes as base64 text so GitHub's text-only
connector can preserve the supplied archive byte-for-byte. This runner decodes the
archive in memory, extracts exactly one allow-listed member to a private temporary
directory, and executes it with the current Python interpreter.
"""
from __future__ import annotations

import base64
import io
import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: skill_runner.py <archive.b64> <member> [script args...]", file=sys.stderr)
        return 64

    archive_path = Path(sys.argv[1]).resolve()
    member = sys.argv[2]
    script_args = sys.argv[3:]

    if not archive_path.is_file() or archive_path.suffix != ".b64":
        print("skill archive asset is missing or invalid", file=sys.stderr)
        return 66
    if member.startswith("/") or ".." in Path(member).parts or not member.endswith(".py"):
        print("refusing unsafe skill member path", file=sys.stderr)
        return 65

    try:
        encoded = "".join(archive_path.read_text(encoding="utf-8").split())
        archive_bytes = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        print(f"failed to decode skill archive: {exc}", file=sys.stderr)
        return 65

    stdin_bytes = sys.stdin.buffer.read()
    try:
        with zipfile.ZipFile(io.BytesIO(archive_bytes), "r") as zf:
            if member not in zf.namelist():
                print(f"skill member not found: {member}", file=sys.stderr)
                return 66
            script_bytes = zf.read(member)
    except Exception as exc:
        print(f"failed to open skill archive: {exc}", file=sys.stderr)
        return 65

    with tempfile.TemporaryDirectory(prefix="filinglens-skill-") as tmp:
        script_path = Path(tmp) / Path(member).name
        script_path.write_bytes(script_bytes)
        os.chmod(script_path, 0o700)
        proc = subprocess.run(
            [sys.executable, str(script_path), *script_args],
            input=stdin_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
            check=False,
        )
        sys.stdout.buffer.write(proc.stdout)
        sys.stderr.buffer.write(proc.stderr)
        return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())
