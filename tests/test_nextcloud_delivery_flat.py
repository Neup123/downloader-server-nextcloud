"""Nextcloud per-user outputs use human Files paths, never job UUID folders."""
from __future__ import annotations

import asyncio
from urllib.parse import quote

import httpx
from app.db import Job, initialize_database, make_engine, make_session_factory
from app.delivery import deliver_files, encrypt_job_delivery
from app.schemas import DeliverySettingsIn


def setup(settings, job_id, files):
    engine = make_engine(settings.database_url)
    initialize_database(engine)
    sessions = make_session_factory(engine)
    root = settings.data_dir / "jobs" / job_id
    paths = []
    for name in files:
        file = root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(name.encode())
        paths.append(file)
    payload = DeliverySettingsIn(mode="webdav",
        webdav_url="https://cloud.example.test/remote.php/dav/files/alice",
        username="alice", app_password="secret", folder="Movies")
    with sessions() as session:
        session.add(Job(id=job_id, owner_id="alice", url="https://example.com/Summer-Trip",
                        engine="generic", status="queued",
                        delivery_token=encrypt_job_delivery(payload, "alice", settings)))
        session.commit()
    return engine, sessions, paths


def response_with_props(request, uploaded):
    target = str(request.url)
    if target.endswith("/Movies/"):
        props = "<d:resourcetype><d:collection/></d:resourcetype>"
    else:
        props = f"<d:getcontentlength>{len(uploaded[target])}</d:getcontentlength>"
    return httpx.Response(207, content=(
        f"<d:multistatus xmlns:d='DAV:'><d:response><d:href>{request.url.path}</d:href>"
        f"<d:propstat><d:prop>{props}</d:prop><d:status>HTTP/1.1 200 OK"
        "</d:status></d:propstat></d:response></d:multistatus>").encode())


def test_single_files_are_flat_and_repeated_names_use_suffix(settings):
    engine, sessions, paths = setup(settings, "job-flat", ["temporary/film.webm"])
    uploaded = {}
    async def handler(request):
        target = str(request.url)
        if request.method == "PROPFIND":
            return response_with_props(request, uploaded)
        if request.method == "MKCOL":
            return httpx.Response(201)
        if request.method == "PUT":
            assert request.headers["if-none-match"] == "*"
            if target.endswith("/film.webm"):
                return httpx.Response(412)
            uploaded[target] = await request.aread()
            return httpx.Response(201)
        return httpx.Response(405)
    try:
        results = asyncio.run(deliver_files(paths, "job-flat", sessions, settings,
                                            transport=httpx.MockTransport(handler)))
        assert len(results) == 1 and results[0]["verified"]
        assert results[0]["filename"] == "film (1).webm"
        assert results[0]["path"].endswith("/Movies/film%20%281%29.webm")
        assert "/job-flat/" not in results[0]["path"]
    finally:
        engine.dispose()


def test_multiple_outputs_use_human_title_and_preserve_nested_album_paths(settings):
    engine, sessions, paths = setup(settings, "job-album", ["side-a/cover.jpg", "side-b/cover.jpg"])
    uploaded, collections = {}, []
    async def handler(request):
        target = str(request.url)
        if request.method == "PROPFIND":
            return response_with_props(request, uploaded)
        if request.method == "MKCOL":
            collections.append(target)
            return httpx.Response(201)
        if request.method == "PUT":
            assert request.headers["if-none-match"] == "*"
            uploaded[target] = await request.aread()
            return httpx.Response(201)
        return httpx.Response(405)
    try:
        results = asyncio.run(deliver_files(paths, "job-album", sessions, settings,
                                            transport=httpx.MockTransport(handler)))
        assert len(results) == 2
        assert all("/Movies/Summer-Trip/" in item["path"] for item in results)
        assert all("/job-album/" not in item["path"] for item in results)
        assert any("/Movies/Summer-Trip" in name for name in collections)
        assert uploaded
    finally:
        engine.dispose()
