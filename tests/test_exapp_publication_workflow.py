"""Static CI contract: only accepted main source can publish GHCR ExApp images."""
from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/publish-exapp-commit-image.yml"


class ExAppPublicationWorkflowTests(unittest.TestCase):
    def test_publisher_requires_green_real_main_appapi_acceptance(self):
        workflow = WORKFLOW.read_text()
        for required in (
            "workflow_run:",
            "Disposable AppAPI Docker ExApp deployment acceptance",
            "types: [completed]",
            "branches: [main]",
            "github.event.workflow_run.conclusion == 'success'",
            "github.event.workflow_run.event == 'push'",
            "github.event.workflow_run.event == 'workflow_dispatch'",
            "github.event.workflow_run.head_branch == 'main'",
            "github.event.workflow_run.head_repository.full_name == github.repository",
            "github.event.workflow_run.head_sha",
            "git merge-base --is-ancestor",
        ):
            with self.subTest(required=required):
                self.assertIn(required, workflow)
        self.assertNotIn("pull_request:", workflow)
        self.assertIn("contents: write", workflow)
        self.assertIn("packages: write", workflow)
        self.assertIn("persist-credentials: false", workflow)

    def test_tag_replacement_is_blocked_and_pulled_digest_is_verified(self):
        workflow = WORKFLOW.read_text()
        for required in (
            'tag="sha-$SOURCE_SHA"',
            "docker manifest inspect",
            "refusing to overwrite it",
            'docker push "$IMAGE_REPO:$IMAGE_TAG"',
            'docker pull "$IMAGE_REPO:$IMAGE_TAG"',
            'docker pull "$digest_ref"',
            'IMAGE_REPO"] + "@" + os.environ["PUBLISHED_DIGEST"]',
            "org.opencontainers.image.revision",
            "--source-sha",
            "scripts/exapp_build_inputs.py",
            "exapp-release/build-inputs.json",
            "io.github.neup123.exapp.python-lock-sha256",
            "io.github.neup123.exapp.npm-lock-sha256",
            "--digest",
            "actions/upload-artifact@v4",
        ):
            with self.subTest(required=required):
                self.assertIn(required, workflow)

    def test_synchronized_main_requires_successful_explicit_appapi_gate(self):
        publisher = WORKFLOW.read_text()
        sync = (ROOT / ".github/workflows/bootstrap-upstream.yml").read_text()
        self.assertIn("github.event.workflow_run.conclusion == 'success'", publisher)
        self.assertIn("github.event.workflow_run.head_repository.full_name == github.repository", publisher)
        self.assertIn("github.event.workflow_run.head_branch == 'main'", publisher)
        self.assertIn("github.event.workflow_run.event == 'workflow_dispatch'", publisher)
        self.assertIn("git merge-base --is-ancestor", publisher)
        self.assertIn('gh workflow run appapi-docker-deploy-e2e.yml --repo "$GITHUB_REPOSITORY" --ref main', sync)
        self.assertIn('gh workflow view appapi-docker-deploy-e2e.yml --repo "$GITHUB_REPOSITORY"', sync)
        self.assertIn('if [[ "${GITHUB_REPOSITORY:-}" != "Neup123/downloader-server-nextcloud" ]]', sync)
        self.assertNotIn("gh workflow run appapi-docker-deploy-e2e.yml --ref main", sync)
        self.assertIn("git ls-remote origin refs/heads/main", sync)
        self.assertNotIn("pull_request:", publisher)

    def test_release_changes_retrigger_disposable_ci_acceptance(self):
        workflow = (ROOT / ".github/workflows/appapi-docker-deploy-e2e.yml").read_text()
        build = (ROOT / ".github/workflows/nextcloud-exapp-build.yml").read_text()
        for source in (workflow, build):
            self.assertIn('"scripts/exapp_build_inputs.py"', source)
            self.assertIn('"tests/test_exapp_build_inputs.py"', source)
            self.assertIn('".github/workflows/publish-exapp-commit-image.yml"', source)
            self.assertIn('"scripts/exapp_release_manifest.py"', source)
            self.assertIn('"tests/test_exapp_publication_workflow.py"', source)


if __name__ == "__main__":
    unittest.main()
