from __future__ import annotations

import unittest
from pathlib import Path
from xml.etree import ElementTree

from nextcloud_exapp.proxy import (
    ProxySettings, RESPONSE_HEADERS, is_events_route, safe_upstream_headers,
    upstream_api_url,
)

ROOT = Path(__file__).resolve().parents[1]


class NextcloudBridgeConfigurationTests(unittest.TestCase):
    def test_origin_requires_secure_url_without_userinfo_or_path(self):
        value = ProxySettings.validate(
            "https://downloads.example.org:443/", "x" * 48
        )
        self.assertEqual(value.origin, "https://downloads.example.org:443")
        for origin in (
            "http://downloads.example.org", "https://u:p@downloads.example.org",
            "https://downloads.example.org/api", "https://downloads.example.org?a=1",
            "https://downloads.example.org/#fragment", "https://downloads.example.org:0",
            "https://downloads.example.org\\@evil.org",
        ):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                ProxySettings.validate(origin, "x" * 48)

    def test_trusted_http_opt_in_and_nonempty_secret(self):
        with self.assertRaises(ValueError):
            ProxySettings.validate("http://downloader-server:8080", "x" * 48)
        self.assertEqual(
            ProxySettings.validate(
                "http://downloader-server:8080", "x" * 48, allow_http=True
            ).origin,
            "http://downloader-server:8080",
        )
        with self.assertRaises(ValueError):
            ProxySettings.validate("https://downloads.example.org", "weak")

    def test_no_browser_authorization_cookie_or_nextcloud_secret_relay(self):
        headers = safe_upstream_headers("application/json", "x" * 48)
        self.assertEqual(headers, {"X-API-Key": "x" * 48, "Content-Type": "application/json"})
        self.assertEqual(safe_upstream_headers("text/html", "x" * 48), {"X-API-Key": "x" * 48})
        self.assertNotIn("location", RESPONSE_HEADERS)
        self.assertNotIn("set-cookie", RESPONSE_HEADERS)
        self.assertNotIn("authorization", RESPONSE_HEADERS)

    def test_proxy_target_is_always_under_fixed_api_root(self):
        self.assertEqual(
            upstream_api_url(
                "https://downloads.example.org:443", "jobs/f9a/events", "offset=4&last=abc"
            ),
            "https://downloads.example.org:443/api/v1/jobs/f9a/events?offset=4&last=abc",
        )
        self.assertEqual(
            upstream_api_url("https://downloads.example.org", "cookies/file name.json"),
            "https://downloads.example.org/api/v1/cookies/file%20name.json",
        )
        for unsafe in (
            "", "/", "//evil.example", "jobs//123", "jobs/../healthz",
            "../healthz", "jobs/%2e%2e/healthz", "jobs/%252e%252e/healthz",
            "jobs/%2fprivate", "jobs/%252fprivate", "jobs/\\\\private",
            "jobs/%3fexample", "jobs/%23fragment", "jobs/one?next=two",
        ):
            with self.subTest(unsafe=unsafe), self.assertRaises(ValueError):
                upstream_api_url("https://downloads.example.org", unsafe)
        for query in ("abc\nnext=evil", "foo#fragment", "x" * 8193):
            with self.subTest(query=query), self.assertRaises(ValueError):
                upstream_api_url("https://downloads.example.org", "jobs", query)

    def test_only_job_event_endpoints_receive_long_running_read_timeout(self):
        self.assertTrue(is_events_route("jobs/9c7c/events"))
        for path in ("jobs/9c7c", "jobs/9c7c/events/other", "jobs//events", "events"):
            self.assertFalse(is_events_route(path))

    def test_manifest_scopes_core_admin_and_user_routes_separately(self):
        xml = ElementTree.parse(ROOT / "appinfo/info.xml").getroot()
        self.assertEqual(xml.findtext("id"), "downloader-server-nextcloud")
        routes = xml.findall("./external-app/routes/route")
        self.assertGreaterEqual(len(routes), 8)
        for route in routes:
            path = route.findtext("url")
            level = route.findtext("access_level")
            self.assertIn(level, {"ADMIN", "USER"})
            if path.startswith("^/api/v1/") or path.startswith("^/admin/api/"):
                self.assertEqual(level, "ADMIN", "Generic core APIs must never become user APIs")
            if path.startswith("^/user/"):
                self.assertEqual(level, "USER")
        self.assertEqual(
            set(xml.findall("./external-app/environment-variables/variable")),
            set(xml.findall("./external-app/environment-variables/variable")),
        )
        names = [var.findtext("name") for var in xml.findall("./external-app/environment-variables/variable")]
        self.assertIn("DOWNLOADER_API_TOKEN", names)

    def test_frontend_build_uses_nextcloud_relative_path_and_session(self):
        root = (ROOT / "web/src/App.tsx").read_text()
        self.assertIn("IS_NEXTCLOUD_EXAPP", root)
        self.assertIn("'nextcloud-session'", root)
        self.assertIn("if (!IS_NEXTCLOUD_EXAPP) localStorage.setItem", root)
        self.assertIn("EXAPP_ROOT + '/api/v1'", root)
        self.assertIn("!IS_NEXTCLOUD_EXAPP && <section", root)
        docker = (ROOT / "nextcloud_exapp/Dockerfile").read_text()
        self.assertIn("npm run build -- --mode nextcloud", docker)
        self.assertIn("nc_py_api[app]==0.30.3", (ROOT / "nextcloud_exapp/requirements.txt").read_text())


if __name__ == "__main__":
    unittest.main()
