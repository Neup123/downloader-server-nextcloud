"""Contract checks for the admin-only pyLoad/cobalt settings gateway."""
import asyncio
import json

import pytest
from fastapi import HTTPException, Request
from fastapi.routing import APIRoute

pytest.importorskip('nc_py_api')
from nextcloud_exapp import main as gateway
from nextcloud_exapp import user as identity


def body_request(payload):
    body = json.dumps(payload).encode('utf-8')

    async def receive():
        return {'type': 'http.request', 'body': body, 'more_body': False}

    return Request({'type': 'http', 'method': 'PUT', 'path': '/', 'headers': []}, receive)


@pytest.mark.parametrize('engine', ('pyload', 'cobalt'))
def test_get_settings_normalizes_missing_mode_without_old_boolean_opt_in(monkeypatch, engine):
    calls = []

    async def forward(method, path, **kwargs):
        calls.append((method, path, kwargs))
        return {'engine': engine, 'settings': {'enabled': True},
                'state': 'stopped', 'service_error': None}

    monkeypatch.setattr(gateway, 'core_json', forward)
    result = asyncio.run(gateway.admin_get_service_settings(engine, admin=None))
    assert result['settings']['mode'] == 'off'
    assert result['state'] == 'stopped'
    assert calls == [('GET', f'engines/{engine}/settings', {})]


@pytest.mark.parametrize('engine', ('pyload', 'cobalt'))
@pytest.mark.parametrize('mode', ('off', 'always', 'on-demand'))
def test_put_forwards_only_exact_mode_payload(monkeypatch, engine, mode):
    calls = []

    async def forward(method, path, **kwargs):
        calls.append((method, path, kwargs))
        return {'engine': engine, 'settings': {'mode': mode},
                'state': 'starting', 'service_error': 'Readiness failed'}

    monkeypatch.setattr(gateway, 'core_json', forward)
    result = asyncio.run(gateway.admin_put_service_settings(
        engine, body_request({'settings': {'mode': mode}}), admin=None))
    assert result['settings']['mode'] == mode
    assert result['state'] == 'starting'
    assert result['service_error'] == 'Readiness failed'
    assert calls == [('PUT', f'engines/{engine}/settings',
                      {'payload': {'settings': {'mode': mode}}})]


@pytest.mark.parametrize('payload', [
    {'settings': {'mode': True}}, {'settings': {'mode': None}},
    {'settings': {'mode': 'enabled'}}, {'settings': {'mode': 'automatic'}},
    {'settings': {'enabled': True}}, {'settings': {'mode': 'off', 'token': 'secret'}},
    {'settings': {'mode': 'always'}, 'extra': True}, [], None,
])
def test_invalid_body_never_reaches_core(monkeypatch, payload):
    async def forbidden(*args, **kwargs):
        pytest.fail('Invalid body was forwarded')

    monkeypatch.setattr(gateway, 'core_json', forbidden)
    with pytest.raises(HTTPException) as raised:
        asyncio.run(gateway.admin_put_service_settings(
            'pyload', body_request(payload), admin=None))
    assert raised.value.status_code == 422


def test_unknown_engine_is_not_a_core_path(monkeypatch):
    async def forbidden(*args, **kwargs):
        pytest.fail('Unknown engine was forwarded')

    monkeypatch.setattr(gateway, 'core_json', forbidden)
    with pytest.raises(HTTPException) as raised:
        asyncio.run(gateway.admin_get_service_settings('../settings', admin=None))
    assert raised.value.status_code == 404


def test_upstream_error_status_and_detail_are_preserved(monkeypatch):
    async def forward(*args, **kwargs):
        raise HTTPException(status_code=409, detail='Cannot start pyLoad')

    monkeypatch.setattr(gateway, 'core_json', forward)
    with pytest.raises(HTTPException) as raised:
        asyncio.run(gateway.admin_put_service_settings(
            'pyload', body_request({'settings': {'mode': 'always'}}), admin=None))
    assert raised.value.status_code == 409
    assert raised.value.detail == 'Cannot start pyLoad'


def test_both_routes_require_admin_and_have_no_user_equivalent():
    routes = [route for route in gateway.APP.routes if isinstance(route, APIRoute)]
    for method in ('GET', 'PUT'):
        matching = [route for route in routes
                    if route.path == '/admin/api/engines/{engine}/settings'
                    and method in route.methods]
        assert len(matching) == 1
        assert any(dep.call is identity.require_admin for dep in matching[0].dependant.dependencies)
    assert not any(route.path == '/user/api/engines/{engine}/settings' for route in routes)


def test_non_admin_is_denied_by_signed_identity_dependency(monkeypatch):
    class Users:
        async def get_user(self, user_id):
            return type('User', (), {'groups': ['users']})()

    class Nextcloud:
        def __init__(self, user):
            self.users = Users()

    monkeypatch.setattr(identity, 'AsyncNextcloudApp', Nextcloud)
    request = Request({'type': 'http', 'username': 'ordinary-user',
                       'path': '/', 'method': 'GET', 'headers': []})
    with pytest.raises(HTTPException) as raised:
        asyncio.run(identity.require_admin(request))
    assert raised.value.status_code == 403
