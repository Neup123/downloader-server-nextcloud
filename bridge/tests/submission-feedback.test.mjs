import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DOWNLOAD_QUEUED_MESSAGE} from '../src/download-labels.mjs';

const dialog = readFileSync(new URL('../src/link-first-dialog.mjs', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../src/bridge.ts', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/dashboard.ts', import.meta.url), 'utf8');

test('one submitted-queue message across dialog, Dashboard, Viewer and Files', () => {
  assert.equal(DOWNLOAD_QUEUED_MESSAGE, 'Download queued. Follow progress in Downloads.');
  assert.match(dialog, /notify\(DOWNLOAD_QUEUED_MESSAGE\)/);
  // Dashboard now opens the same reviewed dialog; that dialog owns the queued message.
  assert.match(dashboard, /showLinkDialog\(\{/);
  assert.match(dashboard, /queued: \(\) =>/);
  assert.match(bridge, /notify\(DOWNLOAD_QUEUED_MESSAGE\)/);
  for (const source of [dialog, dashboard, bridge]) {
    assert.doesNotMatch(source, /Download added to your Nextcloud Files/);
    assert.doesNotMatch(source, /Download submitted to your Files/);
    assert.doesNotMatch(source, /Re-download queued to your Nextcloud Files/);
  }
});

test('API success is not delivery; only confirmed job creation produces queued toast and progress event', () => {
  assert.match(dialog, /const created=await api\('\/jobs','POST',body\)/);
  assert.match(dialog, /if \(!created \|\| !created\.id\) throw new Error/);
  assert.match(dialog, /queued\(created\);dialog\.close\(\)/);
  assert.match(bridge, /if \(!created\?\.id\) throw new Error/);
  assert.match(bridge, /window\.dispatchEvent\(new CustomEvent\('downloader:job-queued'/);
  assert.match(bridge, /announceQueued\(created\)/);
});

test('Files-ready completion is a separate verified terminal notification', () => {
  assert.match(bridge, /&& isTerminalJobState\(job\.status\)/);
  assert.match(bridge, /job\.status==='completed'/);
  assert.match(bridge, /Download complete\. Open it in Nextcloud Files\./);
  assert.match(bridge, /Download skipped: a file already exists in Nextcloud Files/);
  assert.doesNotMatch(DOWNLOAD_QUEUED_MESSAGE, /saved|completed|delivered|added to Files/i);
});
