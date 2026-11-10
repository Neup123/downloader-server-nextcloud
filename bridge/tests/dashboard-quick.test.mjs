import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {classifyPreview} from '../src/link-first-dialog.mjs';

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
  assert.match(dashboard, /panelContent = element\.closest<HTMLElement>\('\.panel--content'\)/);
  assert.match(dashboard, /panelContent\.style\.display = 'flex'/);
  assert.match(dashboard, /panelContent\.style\.flex = '1 1 0'/);
  assert.match(dashboard, /panelContent\.style\.minHeight = '0'/);
  assert.match(dashboard, /panelContent\.style\.overflow = 'hidden'/);
  assert.match(dashboard, /element\.style\.flex = '1 1 0'/);
  assert.match(dashboard, /element\.style\.minHeight = '0'/);
  assert.match(dashboard, /element\.style\.boxSizing = 'border-box'/);
  assert.match(dashboard, /\.downloader-dashboard-content\{display:flex;flex-direction:column;flex:1 1 0;min-height:0/);
  assert.match(dashboard, /\.job-list\{display:grid;gap:0;flex:1 1 0;min-height:0;max-height:380px;overflow-y:auto/);
});


// Exercise actual browser layout. Text/CSS matching alone passed when the
// entire widget became 0px tall on Nextcloud 35.
test('Dashboard form is clickable and the job scroller has real, bounded height with 25 jobs', async t => {
  const candidates = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  const browser = candidates.find(name => {
    const result = spawnSync(name, ['--version'], {encoding: 'utf8'});
    return !result.error && result.status === 0;
  });
  if (!browser) {
    if (process.env.GITHUB_ACTIONS === 'true') {
      assert.fail('A Chromium-based browser is required for the CI dashboard geometry regression test');
    }
    t.skip('Install Chrome or Chromium to run the browser geometry assertion locally');
    return;
  }

  const {build} = await import('esbuild');
  const built = await build({
    entryPoints: [fileURLToPath(new URL('../src/dashboard.ts', import.meta.url))],
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022',
  });
  const bundle = built.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

  // The exact ancestor mismatch observed in QA: a fixed-height panel, an
  // intermediate .panel--content that starts as display:block, and the mount
  // div passed into the real renderDashboard() implementation.
  function setup() {
    window.OC = {generateUrl: path => path};
    window.OCA = {Dashboard: {register(id, render) { window.mountDashboard = render; }}};
    window.fetch = async () => ({
      ok: true,
      json: async () => Array.from({length: 25}, (_, i) => ({
        id: String(i + 1), url: 'https://example.org/video-' + i,
        status: 'completed', engine: 'generic', created_at: '2026-11-09T09:00:00Z',
      })),
    });
  }
  function measure() {
    document.addEventListener('DOMContentLoaded', () => {
      window.mountDashboard(document.getElementById('widget-mount'));
      setTimeout(() => {
        const panel = document.querySelector('.panel');
        const content = document.querySelector('.panel--content');
        const wrapper = document.getElementById('widget-mount');
        const area = document.querySelector('.downloader-dashboard-content');
        const input = area.querySelector('input');
        const button = area.querySelector('button[type="submit"]');
        const list = area.querySelector('.job-list');
        const panelRect = panel.getBoundingClientRect();
        const inputRect = input.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        const target = document.elementFromPoint(inputRect.x + inputRect.width / 2,
          inputRect.y + inputRect.height / 2);
        list.scrollTop = 120;
        document.body.setAttribute('data-layout-result', encodeURIComponent(JSON.stringify({
          rows: list.querySelectorAll('.job-row').length,
          panelHeight: panelRect.height,
          contentHeight: content.getBoundingClientRect().height,
          wrapperHeight: wrapper.getBoundingClientRect().height,
          areaHeight: area.getBoundingClientRect().height,
          inputHeight: inputRect.height,
          buttonHeight: buttonRect.height,
          inputClickable: target === input,
          inputInside: inputRect.top >= panelRect.top && inputRect.bottom <= panelRect.bottom,
          buttonInside: buttonRect.top >= panelRect.top && buttonRect.bottom <= panelRect.bottom,
          listHeight: list.clientHeight,
          listScrollable: list.scrollHeight > list.clientHeight && list.scrollTop > 0,
          listInside: listRect.top >= panelRect.top && listRect.bottom <= panelRect.bottom + 1,
          overflowY: getComputedStyle(list).overflowY,
        })));
      }, 350);
    });
  }

  const html = [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<style>body{margin:0;padding:16px}',
    '.panel{width:400px;height:528px;box-sizing:border-box;display:block;background:white}',
    '.panel--heading{height:88px;flex:0 0 88px}',
    '.panel--content{display:block;flex:1 1 auto;min-height:0;box-sizing:border-box;padding:16px}',
    '</style></head><body>',
    '<div class="panel"><div class="panel--heading">My downloads</div>',
    '<div class="panel--content"><div id="widget-mount"></div></div></div>',
    '<script>(', setup.toString(), ')()</script>',
    '<script>', bundle, '</script>',
    '<script>(', measure.toString(), ')()</script></body></html>',
  ].join('');
  const dir = mkdtempSync(join(tmpdir(), 'downloader-widget-layout-'));
  try {
    const fixture = join(dir, 'index.html');
    writeFileSync(fixture, html);
    const result = spawnSync(browser, [
      '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      '--virtual-time-budget=1800', '--dump-dom', 'file://' + fixture,
    ], {encoding: 'utf8', maxBuffer: 12 * 1024 * 1024, timeout: 20000});
    assert.equal(result.status, 0, 'Headless browser failed: ' + (result.stderr || result.error));
    const match = result.stdout.match(/data-layout-result="([^"]+)"/);
    assert.ok(match, 'Browser did not produce computed layout measurements');
    const layout = JSON.parse(decodeURIComponent(match[1]));
    assert.equal(layout.rows, 25, 'Jobs should be present before geometry is checked');
    for (const key of ['panelHeight', 'contentHeight', 'wrapperHeight',
      'areaHeight', 'inputHeight', 'buttonHeight', 'listHeight']) {
      assert.ok(layout[key] > 0, key + ' collapsed: ' + JSON.stringify(layout));
    }
    for (const key of ['inputClickable', 'inputInside', 'buttonInside',
      'listInside', 'listScrollable']) {
      assert.equal(layout[key], true, key + ' failed: ' + JSON.stringify(layout));
    }
    assert.equal(layout.overflowY, 'auto');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('dashboard blocks magnets and .torrent URLs before submitting any job',()=>{
  for (const value of ['magnet:?xt=urn:btih:012345', 'https://example.org/file.torrent?download=1']) {
    assert.equal(classifyPreview(value,null),'torrent',value);
  }
  assert.match(dashboard,/classifyPreview\(value, null\) === 'torrent'/);
  assert.match(dashboard,/submit.disabled = torrent/);
  assert.match(dashboard,/if \(isTorrent\(value\)\)/);
  assert.match(dashboard,/feedback.textContent = torrentNotice/);
  assert.match(dashboard,/field.type = 'text'/);
  assert.ok(dashboard.indexOf('if (isTorrent(value))') <
    dashboard.indexOf("api<Job>('/jobs', 'POST'"));
});
