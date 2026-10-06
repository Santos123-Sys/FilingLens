from __future__ import annotations
import asyncio
import json
import os
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(os.getenv("FILINGLENS_ROOT", "/app"))
RUNNER = ROOT / "skills" / "skill_runner.py"
SPECS = {
    "ratios": (ROOT / "skills" / "financial-ratio-toolkit" / "source.zip.b64", "scripts/analyze.py"),
    "statements": (ROOT / "skills" / "financial-statement-analyzer" / "source.zip.b64", "scripts/analyze_financials.py"),
    "timeline": (ROOT / "skills" / "filing-timeline-extractor" / "source.zip.b64", "filing-timeline-extractor/scripts/validate_timeline.py"),
}


def status() -> dict[str, Any]:
    return {
        "runner": RUNNER.exists(),
        "archives": {name: archive.exists() for name, (archive, _) in SPECS.items()},
    }


async def _run(skill: str, args: list[str]) -> str:
    archive, member = SPECS[skill]
    proc = await asyncio.create_subprocess_exec(
        "python3", str(RUNNER), str(archive), member, *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(ROOT),
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=40)
    except TimeoutError:
        proc.kill()
        await proc.communicate()
        raise RuntimeError(f"{skill}_skill_timeout")
    if proc.returncode != 0:
        raise RuntimeError(f"{skill}_skill_failed:{stderr.decode('utf-8', errors='replace')[:1000]}")
    return stdout.decode("utf-8", errors="replace").strip()


async def _with_json(payload: Any, callback) -> Any:
    with tempfile.TemporaryDirectory(prefix="filinglens-skill-") as tmp:
        path = Path(tmp) / "input.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        return await callback(str(path))


async def run_ratios(payload: Any) -> Any:
    async def call(path: str):
        raw = await _run("ratios", ["--input", path, "--json"])
        return json.loads(raw)
    return await _with_json(payload, call)


async def run_statements(payload: Any) -> Any:
    async def call(path: str):
        raw = await _run("statements", [path, "--json"])
        return json.loads(raw)
    return await _with_json(payload, call)


async def validate_timeline(payload: Any) -> dict[str, str]:
    async def call(path: str):
        raw = await _run("timeline", [path])
        return {"output": raw}
    return await _with_json(payload, call)
