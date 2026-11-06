import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../src/bridge.ts', import.meta.url), 'utf8');

test('Actions depend on Nextcloud signed user entitlement', () => {
  assert.ok(source.indexOf("await api<{user_id: string; entitled: boolean}>('/me')") < source.indexOf('registerActions();'));
  assert.match(source, /catch \{ return; \}/);
});
test('All download submissions go through per-user ExApp routes', () => {
  assert.match(source, /app_api\/proxy\/downloader-server-nextcloud\/user\/api/);
  assert.match(source, /api\('\/jobs', 'POST'/);
  for (const forbidden of ['DOWNLOADER_API_TOKEN', 'APP_API_TOKEN', 'X-API-Key', 'WebDAV PUT', 'fs.writeFile']) {
    assert.ok(!source.includes(forbidden), forbidden);
  }
});
test('The Files context, New menu and media action are registered', () => {
  assert.match(source, /registerFileAction/);
  assert.match(source, /addNewFileMenuEntry/);
  assert.match(source, /downloader-folder-action/);
  assert.match(source, /downloader-viewer-action/);
});

test('Nextcloud 35 legacy Viewer has a dedicated UI-only action without private DAV re-download', () => {
  assert.match(source, /installLegacyViewerHook/);
  assert.match(source, /#viewer\\.viewer/);
  assert.match(source, /downloader-viewer-action/);
  assert.match(source, /download_source_url/);
  assert.doesNotMatch(source, /url: *currentFile\\.davPath/);
});
