"""Durable first verified-download onboarding state.

The tracker writes this as part of verified terminal-job processing; history
GET still reconciles earlier jobs created before the tracker was installed.
Never mark onboarding for a failed, incomplete or other-owner download.
"""
from __future__ import annotations

from typing import Any


def is_verified_completed(job: Any, owner_id: str) -> bool:
    if not isinstance(job, dict) or job.get("owner_id") != owner_id:
        return False
    files = job.get("output_files")
    return bool(
        job.get("status") == "completed"
        and isinstance(files, list) and files
        and all(isinstance(item, dict) and item.get("verified") is True for item in files)
    )


async def reconcile_first_verified(nc, owner_id: str, jobs: list[dict]) -> bool:
    if not any(is_verified_completed(job, owner_id) for job in jobs):
        return False
    prefs = nc.preferences_ex
    if await prefs.get_value("first_download_verified", "0") != "1":
        await prefs.set_value("first_download_verified", "1")
    return True
