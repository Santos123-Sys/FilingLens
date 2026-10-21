"""One checked-in access decision for every production SEC network path."""
import json
import os
import re
from pathlib import Path


def sec_access_status() -> dict:
    root = Path(__file__).resolve().parents[3]
    path = Path(os.getenv("SEC_ACCESS_POLICY_PATH", str(root / "config/sec-acquisition-access.json")))
    try:
        policy = json.loads(path.read_text())
        reviewed = (policy.get("schema") == "filinglens.sec_acquisition_access.v1" and policy.get("state") == "reviewed"
                    and re.fullmatch(r"https://github.com/Santos123-Sys/FilingLens/(issues|pull)/[0-9]+", policy.get("reviewReference") or ""))
        return {"status": "reviewed" if reviewed else "paused", "reason": policy.get("reason", "review_required"),
                "evidence": policy.get("evidence"), "liveRetrievalVerified": False}
    except (OSError, ValueError, TypeError):
        return {"status": "paused", "reason": "policy_unavailable", "liveRetrievalVerified": False}


def require_sec_access() -> None:
    if sec_access_status()["status"] != "reviewed":
        raise ValueError("sec_access_review_required")
