"""Nextcloud global search index stores only current-user, sanitized job metadata."""
import asyncio
import json
from types import SimpleNamespace

from nextcloud_exapp.search_index import merge_index, search_record, update_index


def test_search_index_is_user_scoped_and_url_parameters_never_indexed():
    jobs = [
        {"id": "a", "owner_id": "alice", "url": "https://alice:password@media.example.test/video.mp4?signature=secret#private",
         "status": "completed", "engine": "generic",
         "output_files": [{"filename": "video.mp4", "verified": True}], "created_at": "2026-01-02"},
        {"id": "b", "owner_id": "bob", "url": "https://media.example.test/bob.mp4", "status": "completed"},
    ]
    index = merge_index("[]", jobs, "alice")
    assert len(index) == 1 and index[0]["id"] == "a"
    serialized = json.dumps(index)
    for secret in ("signature=", "secret", "password", "private", "bob.mp4"):
        assert secret not in serialized
    assert "video.mp4" in serialized


def test_search_index_ignores_invalid_existing_data_and_is_bounded():
    jobs = [
        {"id": str(i), "owner_id": "alice", "url": "https://example.test/" + str(i),
         "created_at": f"2026-01-{(i % 28) + 1:02d}"}
        for i in range(160)
    ]
    result = merge_index("not-json", jobs, "alice")
    assert len(result) <= 100
    assert len(json.dumps(result)) <= 60000


def test_search_index_writes_via_user_preferences():
    class Pref:
        def __init__(self): self.values = {}
        async def get_value(self, key, default): return self.values.get(key, default)
        async def set_value(self, key, val): self.values[key] = val

    pref = Pref()
    nc = SimpleNamespace(preferences_ex=pref)
    asyncio.run(update_index(nc, "alice", [{
        "id": "123", "owner_id": "alice", "url": "https://example.test/media.mp4",
        "status": "queued", "engine": "yt-dlp",
    }]))
    assert json.loads(pref.values["download_search_index"])[0]["id"] == "123"
