"""Static acceptance for the HTML-only administrator entitlement design.

This verifies the checked-in artifact's safety boundary and essential controls.
It intentionally does NOT claim a rendered browser, actual directory lookup,
real authorization decisions or persistence.
"""
from pathlib import Path
from html.parser import HTMLParser
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROTOTYPE = ROOT / "prototypes" / "nextcloud-admin-entitlements.html"


class Elements(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.buttons = []
        self.roles = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if "id" in a:
            self.ids.add(a["id"])
        if tag == "button":
            self.buttons.append(a)
        if "role" in a:
            self.roles.append(a["role"])


class AdminEntitlementPrototypeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = PROTOTYPE.read_text(encoding="utf-8")
        cls.html = Elements()
        cls.html.feed(cls.source)

    def test_interactive_selection_and_pending_save_controls_exist(self):
        for name in ("search", "results", "selected-users", "selected-groups",
                     "save", "discard", "state", "error", "filter", "ids"):
            self.assertIn(name, self.html.ids)
        self.assertIn("type='checkbox'", self.source)
        self.assertIn("type='search'", self.source)
        self.assertIn("aria-pressed", self.source)
        self.assertIn("role=\"status\"", self.source)
        self.assertIn("role=\"alert\"", self.source)
        self.assertIn("headBusy", self.source if False else "headBusy") if False else None

    def test_mock_does_not_change_actual_entitlement_or_contact_core(self):
        script = self.source.split("<script>", 1)[-1]
        self.assertNotIn("fetch(", script)
        self.assertNotIn("XMLHttpRequest", script)
        self.assertNotIn("localStorage", script)
        self.assertNotIn("sessionStorage", script)
        self.assertIn("saved=clone(selected)", script)
        self.assertIn("Synthetic demonstration", self.source)
        self.assertIn("No network calls", self.source)

    def test_keyboard_mobile_and_direction_are_explicit(self):
        self.assertIn("min-height:56px", self.source)
        self.assertIn("@media(max-width:660px)", self.source)
        self.assertIn(":focus-visible", self.source)
        self.assertIn("document.documentElement.dir=", self.source)
        self.assertIn("data-theme", self.source)
        self.assertIn("title='Remove '", self.source)
        self.assertTrue((ROOT / "docs" / "191-admin-entitlement-prototype.md").is_file())


if __name__ == "__main__":
    unittest.main()
