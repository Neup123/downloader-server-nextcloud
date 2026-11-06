"""Small, sanitized per-user search metadata index for native Nextcloud Search.

The native PHP bridge reads only this user's own Nextcloud preferences; all
job execution, delivery, and engine work stays in the standalone core.
"""
from __future__ import annotations

import json
from urllib.parse import urlsplit, urlunsplit

SEARCH_KEY = "download_search_index"
MAX_ITEMS = 100
MAX_VALUE = 60000


def search_record(job: dict, owner_id: str) -> dict | None:
    if not isinstance(job, dict) or job.get("owner_id") != owner_id:
        return None
    job_id = job.get("id")
    url = job.get("url")
    if not isinstance(job_id, str) or not isinstance(url, str):
        return None
    source = urlsplit(url)
    if source.scheme not in {"http", "https"} or not source.hostname:
        # Avoid indexing credential-carrying magnet / FTP and unknown schemes.
        display = "Download"
    else:
        # Strip credentials, query strings and fragments (often signed tokens).
        hostname = source.hostname
        if source.port:
            hostname += f":{source.port}"
        display = urlunsplit((source.scheme, hostname, source.path, "", ""))[:512]
    file_names = [
        str(item.get("filename", ""))[:180]
        for item in (job.get("output_files") or [])[:12]
        if isinstance(item, dict) and item.get("verified") and item.get("filename")
    ]
    return {
        "id": job_id[:36],
        "title": display,
        "status": str(job.get("status") or "queued")[:25],
        "engine": str(job.get("engine") or "")[:32],
        "files": file_names,
        "created_at": str(job.get("created_at") or "")[:35],
    }


def merge_index(raw: str | None, jobs: list[dict], owner_id: str) -> list[dict]:
    try:
        existing = json.loads(raw or "[]")
    except (TypeError, ValueError):
        existing = []
    if not isinstance(existing, list):
        existing = []
    # Existing records came from the same current user's scoped preference.
    records = {item["id"]: item for item in existing[:MAX_ITEMS] if
               isinstance(item, dict) and isinstance(item.get("id"), str)}
    for job in jobs:
        if record := search_record(job, owner_id):
            records[record["id"]] = record
    result = sorted(records.values(), key=lambda item: str(item.get("created_at", "")), reverse=True)[:MAX_ITEMS]
    while result and len(json.dumps(result, ensure_ascii=False)) > MAX_VALUE:
        result.pop()
    return result


async def update_index(nc, owner_id: str, jobs: list[dict]) -> None:
    preferences = nc.preferences_ex
    existing = await preferences.get_value(SEARCH_KEY, "[]")
    indexed = merge_index(existing, jobs, owner_id)
    await preferences.set_value(SEARCH_KEY, json.dumps(indexed, ensure_ascii=False, separators=(",", ":")))
