import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {filesJobRequest, selectedMediaFormat} from '../src/files-dialog-payload.mjs';

const source = readFileSync(new URL('../src/bridge.ts', import.meta.url), 'utf8');
const section = source.slice(source.indexOf('async function openDialog('), source.indexOf('\nfunction registerActions()'));

test('folder, Viewer and Talk submission stay owner-scoped without preset identifiers', () => {
  assert.deepEqual(filesJobRequest('https://example.org/video', 'Movies'), {
    url: 'https://example.org/video', engine: 'auto', folder: 'Movies',
  });
  assert.deepEqual(filesJobRequest('https://example.org/direct', null), {
    url: 'https://example.org/direct', engine: 'auto',
  });
  assert.deepEqual(filesJobRequest('https://example.org/video', ''), {
    url: 'https://example.org/video', engine: 'auto', folder: '',
  });
  assert.doesNotMatch(JSON.stringify(filesJobRequest('https://example.org/video', null)), /preset_id/);
  assert.doesNotMatch(section, /preset/i);
});

test('quality and audio-only are the dialog download options', () => {
  assert.match(section, /dialog\.showModal\(\)/);
  assert.match(section, /aria-labelledby/);
  assert.match(section, /audioOnly\.checked = false/);
  assert.match(section, /mediaRow\.append\(audioToggle, label\('Quality', quality\)\)/);
  assert.match(section, /audioOnly\.addEventListener\('change', updateQualityChoices\)/);
  assert.match(section, /userSettings\.default_audio_quality/);
  assert.match(section, /userSettings\.default_video_quality/);
  assert.doesNotMatch(section, /label\('Engine'|label\('Preferred format'|node\('details'/);
  assert.match(section, /filesJobRequest\(\s*url\.value\.trim\(\), folder, quality\.value, audioOnly\.checked\)/);
  assert.match(source, /registerFileAction/);
  assert.match(source, /addNewFileMenuEntry/);
  assert.doesNotMatch(source, /window\.alert\(/);
  assert.match(source, /Notification\?\.showTemporary/);
});

test('quality becomes a Core format; best video leaves automatic engine detection', () => {
  assert.equal(selectedMediaFormat(), null);
  assert.equal(selectedMediaFormat('best', true), 'bestaudio');
  assert.equal(selectedMediaFormat('128', true), 'bestaudio[abr<=128]');
  assert.equal(selectedMediaFormat('small', true), 'worstaudio');
  assert.deepEqual(filesJobRequest('https://example.org/video', 'Movies', '720'), {
    url:'https://example.org/video', engine:'yt-dlp', folder:'Movies',
    overrides:{format:'bestvideo[height<=720]+bestaudio/best[height<=720]'},
    audio_only:false, quality:'720',
  });
  assert.deepEqual(filesJobRequest('https://example.org/audio', null, '128', true), {
    url:'https://example.org/audio', engine:'yt-dlp',
    overrides:{format:'bestaudio[abr<=128]'}, audio_only:true, quality:'128',
  });
  assert.throws(() => filesJobRequest('https://example.org/audio', null, '720', true), /Unsupported/);
});
