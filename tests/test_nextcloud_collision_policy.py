"""#139: atomic per-user collisions never overwrite and report a visible skip."""
from __future__ import annotations

import asyncio
from pathlib import Path

import httpx
from app.db import Job, initialize_database, make_engine, make_session_factory
from app.delivery import deliver_files, encrypt_job_delivery
from app.schemas import DeliverySettingsIn


def setup(settings, policy, files=("source/film.webm",)):
    engine = make_engine(settings.database_url)
    initialize_database(engine)
    sessions = make_session_factory(engine)
    paths = []
    for name in files:
        source = settings.data_dir / "jobs" / "job-collision" / name
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(b"media payload for " + name.encode())
        paths.append(source)
    delivery = DeliverySettingsIn(
        mode="webdav",
        webdav_url="https://cloud.example.test/remote.php/dav/files/alice",
        username="alice", app_password="secret", folder="Movies",
        existing_file_behavior=policy,
    )
    with sessions() as session:
        session.add(Job(
            id="job-collision", owner_id="alice", url="https://media.example.org/Summer-Trip",
            engine="yt-dlp", status="queued",
            delivery_token=encrypt_job_delivery(delivery, "alice", settings),
        ))
        session.commit()
    return engine, sessions, paths


def multistatus(request, *, collection=False, size=0):
    part = ("<d:resourcetype><d:collection/></d:resourcetype>" if collection
            else f"<d:getcontentlength>{size}</d:getcontentlength>")
    return httpx.Response(207, content=(
        "<d:multistatus xmlns:d='DAV:'><d:response>"
        f"<d:href>{request.url.path}</d:href>"
        f"<d:propstat><d:prop>{part}</d:prop><d:status>HTTP/1.1 200 OK</d:status>"
        "</d:propstat></d:response></d:multistatus>"
    ).encode())


def test_rename_on_collision_preserves_old_file_and_uses_suffix(settings):
    engine, sessions, paths = setup(settings, "rename")
    writes = {}
    async def handler(request):
        target = str(request.url)
        if request.method == "PROPFIND":
            if target.endswith("/Movies/"):
                return multistatus(request, collection=True)
            return multistatus(request, size=len(writes[target]))
        if request.method == "PUT":
            assert request.headers["if-none-match"] == "*"
            if target.endswith("/film.webm"):
                return httpx.Response(412)
            writes[target] = await request.aread()
            return httpx.Response(201)
        return httpx.Response(405)
    try:
        result = asyncio.run(deliver_files(
            paths, "job-collision", sessions, settings,
            transport=httpx.MockTransport(handler),
        ))
        assert len(result) == 1
        assert result[0]["verified"] is True
        assert result[0]["filename"] == "film (1).webm"
        assert result[0].get("skipped") is not True
        assert len(writes) == 1
        assert not next(iter(writes)).endswith("/film.webm")
    finally:
        engine.dispose()


def test_skip_collision_keeps_destination_unchanged_and_emits_signal(settings):
    engine, sessions, paths = setup(settings, "skip")
    puts = []
    async def handler(request):
        target = str(request.url)
        if request.method == "PROPFIND":
            return multistatus(request, collection=target.endswith("/Movies/"))
        if request.method == "PUT":
            puts.append(target)
            assert request.headers["if-none-match"] == "*"
            return httpx.Response(412)
        return httpx.Response(405)
    try:
        result = asyncio.run(deliver_files(
            paths, "job-collision", sessions, settings,
            transport=httpx.MockTransport(handler),
        ))
        assert puts == [], "existing files must not receive another upload"
        assert len(result) == 1
        assert result[0]["skipped"] is True
        assert result[0]["verified"] is False
        assert result[0]["skip_reason"] == "exists"
    finally:
        engine.dispose()


def test_multi_file_collision_skips_existing_folder_without_writing(settings):
    engine, sessions, paths = setup(settings, "skip", files=("part-a/a.jpg","part-b/b.jpg"))
    seen = []
    async def handler(request):
        url = str(request.url)
        seen.append((request.method, url))
        if request.method == "PROPFIND":
            assert url.endswith("/Movies/") or url.endswith("/Summer-Trip/")
            return multistatus(request, collection=True)
        if request.method == "MKCOL":
            assert url.endswith("/Summer-Trip")
            return httpx.Response(405)
        raise AssertionError("A skipped collection may not PUT or create subfolders")
    try:
        result = asyncio.run(deliver_files(
            paths, "job-collision", sessions, settings,
            transport=httpx.MockTransport(handler),
        ))
        assert len(result) == 1 and result[0]["skipped"] is True
        assert result[0]["verified"] is False
        assert len([item for item in seen if item[0] == "MKCOL"]) == 1
        assert all(method != "PUT" for method, _ in seen)
    finally:
        engine.dispose()


def test_conflict_without_verified_existing_target_is_not_silently_skipped(settings):
    from app.delivery import DeliveryError
    import pytest
    engine, sessions, paths = setup(settings, "skip")
    async def handler(request):
        target = str(request.url)
        if request.method == "PROPFIND" and target.endswith("/Movies/"):
            return multistatus(request, collection=True)
        if request.method == "PROPFIND":
            # A 207 for a different resource does not prove this target exists.
            return httpx.Response(207, content=(
                "<d:multistatus xmlns:d='DAV:'><d:response>"
                "<d:href>/other-file.webm</d:href><d:propstat>"
                "<d:prop><d:getcontentlength>8</d:getcontentlength></d:prop>"
                "<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>"
                "</d:multistatus>"
            ).encode())
        if request.method == "PUT":
            return httpx.Response(409)
        return httpx.Response(405)
    try:
        with pytest.raises(DeliveryError, match="Existing file could not be verified"):
            asyncio.run(deliver_files(paths,"job-collision",sessions,settings,
                                      transport=httpx.MockTransport(handler)))
    finally:
        engine.dispose()


def test_skip_race_after_missing_preflight_still_uses_atomic_put(settings):
    engine, sessions, paths = setup(settings, "skip")
    writes = []
    async def handler(request):
        target = str(request.url)
        if request.method == "PROPFIND" and target.endswith("/Movies/"):
            return multistatus(request, collection=True)
        if request.method == "PROPFIND":
            return httpx.Response(404)
        if request.method == "PUT":
            writes.append(target)
            assert request.headers["if-none-match"] == "*"
            return httpx.Response(412)  # Concurrent writer won the race.
        raise AssertionError(request.method)
    try:
        items = asyncio.run(deliver_files(paths, "job-collision", sessions, settings,
                                          transport=httpx.MockTransport(handler)))
        assert len(writes) == 1 and writes[0].endswith("/film.webm")
        assert len(items) == 1 and items[0]["skipped"] is True
        assert items[0]["verified"] is False
    finally:
        engine.dispose()


def test_dialog_gateway_saved_skip_reaches_actual_delivery_and_notification(settings):
    """The signed dialog does not send collision policy: it comes from saved preferences."""
    from types import SimpleNamespace
    from nextcloud_exapp.user import UserContext, job_submission, delivery_notification
    from app.main import build_job
    from app.schemas import JobCreate

    class Prefs:
        async def get_value(self, key, default=None):
            return {"existing_file_behavior": "skip",
                    "dav_app_password": "secret"}.get(key, default)

    class Files:
        async def by_path(self, path):
            assert path == "/Movies"
            return SimpleNamespace(is_dir=True)

    nc = SimpleNamespace(
        preferences_ex=Prefs(), files=Files(),
        app_cfg=SimpleNamespace(dav_endpoint="https://cloud.example.test/remote.php/dav"),
    )
    request = asyncio.run(job_submission(UserContext("alice", nc), {
        "url": "https://media.example.org/Summer-Trip",
        "engine": "yt-dlp",
        "content_type": "video",
        "folder": "Movies",
    }))
    assert request["delivery"]["existing_file_behavior"] == "skip"
    assert request["delivery"]["folder"] == "Movies"
    engine = make_engine(settings.database_url)
    initialize_database(engine)
    sessions = make_session_factory(engine)
    source = settings.data_dir / "jobs" / "job-collision" / "source" / "film.webm"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_bytes(b"media content")
    try:
        with sessions() as session:
            job = build_job(JobCreate.model_validate(request), session, settings)
            job.id = "job-collision"
            session.add(job)
            session.commit()
        async def handler(request):
            if request.method == "PROPFIND":
                return multistatus(request, collection=str(request.url).endswith("/Movies/"))
            raise AssertionError("Skip must not upload or rename an existing file")
        items = asyncio.run(deliver_files([source], "job-collision", sessions, settings,
                                          transport=httpx.MockTransport(handler)))
        assert len(items) == 1
        assert items[0]["skipped"] is True and items[0]["verified"] is False
        assert items[0]["filename"] == "film.webm"
        assert "Download skipped" in delivery_notification({
            "status": "completed", "output_files": items,
        })[0]
    finally:
        engine.dispose()
