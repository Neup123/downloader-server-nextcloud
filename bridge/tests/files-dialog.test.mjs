import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {filesJobRequest, selectedMediaFormat} from '../src/files-dialog-payload.mjs';

const source = readFileSync(new URL('../src/bridge.ts', import.meta.url), 'utf8');
const section = source.slice(source.indexOf('async function openDialog('), source.indexOf('\nfunction registerActions()'));

test('folder action submits into exactly the clicked folder, with automatic engine by default', () => {
  assert.deepEqual(filesJobRequest('https://example.com/video', 'Movies'), {
    url: 'https://example.com/video', engine: 'auto', folder: 'Movies',
  });
  assert.deepEqual(filesJobRequest('https://example.com/video', ''), {
    url: 'https://example.com/video', engine: 'auto', folder: '',
  });
});
test('Viewer/Talk preserve implicit personal default and an optional preset', () => {
  assert.deepEqual(filesJobRequest('https://example.com/audio', null), {
    url: 'https://example.com/audio', engine: 'auto',
  });
  assert.deepEqual(filesJobRequest('https://example.com/audio', null, 'yt-dlp', 'preset-1'), {
    url: 'https://example.com/audio', engine: 'yt-dlp', preset_id: 'preset-1',
  });
});
test('dialog is modal, themed and accessible, with optional controls collapsed', () => {
  assert.match(section, /dialog\.showModal\(\)/);
  assert.match(section, /aria-labelledby/);
  assert.match(section, /node\('details'/);
  assert.match(section, /node\('summary', 'Options'\)/);
  assert.match(section, /engines\.value = 'auto'/);
  assert.ok(section.indexOf("label('Source URL', url)") < section.indexOf('options, buttons'));
  assert.doesNotMatch(section, /label\('Destination/);
  assert.match(source, /\.dl-dialog\[open\]\{position:fixed!important;inset:0!important;margin:auto!important/);
});
test('no download UI uses blocking browser alert, and submits via signed ExApp', () => {
  assert.doesNotMatch(source, /window\.alert\(/);
  assert.match(source, /Notification\?\.showTemporary/);
  assert.match(section, /filesJobRequest\(url\.value\.trim\(\), folder, engines\.value, preset\.value, quality\.value, format\.value\)/);
  assert.match(source, /registerFileAction/);
  assert.match(source, /addNewFileMenuEntry/);
});

test('human quality choices produce constrained format overrides', () => {
  assert.equal(selectedMediaFormat(), null);
  assert.equal(selectedMediaFormat('audio', 'auto'), 'bestaudio/best');
  assert.match(selectedMediaFormat('720','mp4'), /height<=720/);
  assert.deepEqual(filesJobRequest('https://example.com/movie', 'Films', 'auto', '', '720'), {
    url: 'https://example.com/movie', engine: 'auto', folder: 'Films',
    overrides: {format: 'bestvideo[height<=720]+bestaudio/best[height<=720]'},
  });
});
