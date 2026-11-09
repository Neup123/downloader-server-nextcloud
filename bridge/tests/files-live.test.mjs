import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ownDeliveredFilePaths} from '../src/files-live.mjs';

const bridge = readFileSync(new URL('../src/bridge.ts', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/dashboard.ts', import.meta.url), 'utf8');

test('only owner-verified DAV output files update Files without a page reload', () => {
  const job = {output_files: [
    {verified:true,path:'https://cloud.test/remote.php/dav/files/alice/Downloads/demo%20file.webm'},
    {verified:false,path:'https://cloud.test/remote.php/dav/files/alice/Downloads/partial.webm'},
    {verified:true,path:'https://cloud.test/remote.php/dav/files/bob/Downloads/private.webm'},
    {verified:true,path:'https://cloud.test/remote.php/dav/files/alice/%2e%2e/bad'},
  ]};
  assert.deepEqual(ownDeliveredFilePaths(job,'alice'), ['/Downloads/demo file.webm']);
  assert.deepEqual(ownDeliveredFilePaths({output_files:[]},'alice'), []);
});
test('Nextcloud receives real authenticated DAV node-created events on completion', () => {
  assert.match(bridge, /getClient\(\)/);
  assert.match(bridge, /getRootPath\(\) \+ path/);
  assert.match(bridge, /resultToNode\(result\.data\)/);
  assert.match(bridge, /emit\('files:node:created'/);
  assert.match(bridge, /publishDeliveredFiles\(job\)/);
  assert.doesNotMatch(bridge, /location\.reload\(/);
});
test('progress bubble is live and accessible, and both widgets refresh on submit', () => {
  assert.match(bridge, /dl-header-meter/);
  assert.match(bridge, /Current download progress/);
  assert.match(bridge, /2500/);
  assert.match(bridge, /downloader:job-queued/);
  assert.match(dashboard, /downloader:jobs-updated/);
  assert.match(bridge, /notify\(job\.status === 'completed'/);
});


test('Nextcloud 35 topbar mounts into header-end, with legacy fallback', () => {
  const progress = bridge.slice(bridge.indexOf('function headerProgress('), bridge.indexOf('\ntype Provenance'));
  assert.match(progress, /document\.querySelector\('#header \.header-end'\)/);
  assert.match(progress, /document\.querySelector\('\.header-end'\)/);
  assert.match(progress, /document\.querySelector\('#header-right'\)/);
  assert.ok(progress.indexOf("'.header-end'") < progress.indexOf("'#header-right'"));
});
