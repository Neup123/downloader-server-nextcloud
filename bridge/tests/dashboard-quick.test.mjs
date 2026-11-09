import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const dashboard = readFileSync(new URL('../src/dashboard.ts', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../src/bridge.ts', import.meta.url), 'utf8');

test('Dashboard allows opt-in quick download without credentials or changing own Files folder', () => {
  assert.match(dashboard, /Quick download link/);
  assert.match(dashboard, /quick\.addEventListener\('submit'/);
  assert.match(dashboard, /await api<Job>\('\/jobs', 'POST', filesJobRequest\(value, null\)\)/);
  assert.doesNotMatch(dashboard, /folder:.*destination|X-API-Key|DOWNLOADER_API_TOKEN/);
  assert.match(dashboard, /app_password_configured/);
  assert.match(dashboard, /downloader:job-queued/);
  assert.match(dashboard, /submit\.disabled = true/);
  assert.match(dashboard, /role', 'status'/);
  assert.match(dashboard, /\?limit=50/);
  assert.match(dashboard, /max-height:380px;overflow-y:auto/);
});

test('Provenance remains owner-scoped and readable with download date and engine', () => {
  for (const expected of [
    "['Filename', record.filename", "['Downloaded by', record.owner_id",
    "['Downloaded on',", "['Engine', record.engine",
    'new Date(record.created_at)', 'node(\'dl\'', 'node(\'dt\'', 'node(\'dd\'',
    "'/provenance?file_id='", '/redownload'
  ]) {
    assert.ok(bridge.includes(expected), expected);
  }
  assert.ok(!bridge.includes('window.localStorage.setItem("APP_API_TOKEN"'));
});

test('Dashboard uses compact scrolling rows, accessible icon actions and an in-place modal', () => {
  for (const part of [
    'job-row job-', 'job-card-icon', 'job-card-info', 'job-card-title',
    'job-card-state', 'mini-progress', 'job-actions', 'job-menu', 'job-menu-items',
    'downloader-widget-dialog', 'Technical log (advanced)', 'Delivered files',
    'Open in Files', 'View details', 'Copy source link', 'Remove from history',
    'Deliver again', 'More actions', "dialog.showModal()", "aria-label",
    'downloadSymbol(job)', 'downloadAmount(', 'downloadStatus(job)',
  ]) {
    assert.ok(dashboard.includes(part), 'Missing compact widget element: '+part);
  }
  assert.match(dashboard, /deliveredFilesQuery\(job\)/);
  assert.match(dashboard, /await api\('\/jobs\/' \+ encodeURIComponent\(job.id\) \+ '\/hide', 'POST'\)/);
  assert.doesNotMatch(dashboard, /innerHTML\s*=/);
  assert.match(dashboard, /--color-main-background/);

});

test('verified Nextcloud thumbnails use numeric file IDs and retain icon fallback', () => {
  assert.match(dashboard, /file\.verified/);
  assert.match(dashboard, /file\.file_id/);
  assert.match(dashboard, /\/core\/preview/);
  assert.match(dashboard, /preview\.addEventListener\('error', \(\) => preview\.remove\(\)/);
  assert.match(dashboard, /icon\.append\(preview\)/);
});

test('Nextcloud dashboard panel bounds the job scroller and clips overflow', () => {
  assert.match(dashboard, /element\.style\.overflow = 'hidden'/);
  assert.match(dashboard, /element\.style\.display = 'flex'/);
  assert.match(dashboard, /element\.closest<HTMLElement>\('\.panel'\)/);
  assert.match(dashboard, /panel\.style\.overflow = 'hidden'/);
  assert.match(dashboard, /panel\.style\.flexDirection = 'column'/);
  assert.match(dashboard, /element\.style\.flex = '1 1 0'/);
  assert.match(dashboard, /element\.style\.minHeight = '0'/);
  assert.match(dashboard, /element\.style\.boxSizing = 'border-box'/);
  assert.match(dashboard, /\.downloader-dashboard-content\{display:flex;flex-direction:column;flex:1 1 0;min-height:0/);
  assert.match(dashboard, /\.job-list\{display:grid;gap:0;flex:1 1 0;min-height:0;max-height:380px;overflow-y:auto/);
});
