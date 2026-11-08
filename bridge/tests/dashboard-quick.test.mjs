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
  assert.match(dashboard, /\.slice\(0, 3\)/);
  assert.match(dashboard, /\?limit=3/);
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

test('Dashboard shows the Core-like job card structure and expanded details with signed actions', () => {
  for (const part of [
    'job-card job-', 'job-card-head', 'job-card-icon', 'job-card-info',
    'job-card-title', 'job-card-state', 'job-card-meta', 'progress-track',
    'progress-fill', 'job-actions', 'job-card-details', 'Technical log (advanced)',
    'Delivered files', '✓ Verified', 'Open in Files', 'aria-expanded',
    'downloadSymbol(job)', 'downloadAmount(', 'downloadStatus(job)',
  ]) {
    assert.ok(dashboard.includes(part), 'Missing matching card element: '+part);
  }
  assert.match(dashboard, /deliveredFilesQuery\(job\)/);
  assert.match(dashboard, /await api\('\/jobs\/'.*operation, 'POST'\)/s);
  assert.doesNotMatch(dashboard, /innerHTML\s*=/);
  assert.match(dashboard, /--color-main-background/);
});
