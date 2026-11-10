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
  assert.match(section, /audioOnly\.checked = false/);
  assert.match(section, /mediaRow\.append\(audioToggle, label\('Quality', quality\)\)/);
  assert.ok(section.indexOf('mediaRow, options, buttons') < section.indexOf('dialog.append(form)'));
  assert.match(section, /userSettings\.default_audio_quality/);
  assert.match(section, /userSettings\.default_video_quality/);
  assert.match(section, /node\('summary', 'Options'\)/);
  assert.match(section, /engines\.value = 'auto'/);
  assert.ok(section.indexOf("label('Source URL', url)") < section.indexOf('options, buttons'));
  assert.doesNotMatch(section, /label\('Destination/);
  assert.match(source, /\.dl-dialog\[open\]\{position:fixed!important;inset:0!important;margin:auto!important/);
});
test('no download UI uses blocking browser alert, and submits via signed ExApp', () => {
  assert.doesNotMatch(source, /window\.alert\(/);
  assert.match(source, /Notification\?\.showTemporary/);
  assert.match(section, /filesJobRequest\(url\.value\.trim\(\), folder, engines\.value, preset\.value, quality\.value, format\.value, audioOnly\.checked\)/);
  assert.match(source, /registerFileAction/);
  assert.match(source, /addNewFileMenuEntry/);
});

test('human quality choices produce constrained format overrides', () => {
  assert.equal(selectedMediaFormat(), null);
  assert.equal(selectedMediaFormat('audio', 'auto'), 'bestaudio/best');
  assert.match(selectedMediaFormat('720','mp4'), /height<=720/);
  assert.deepEqual(filesJobRequest('https://example.com/movie', 'Films', 'auto', '', '720'), {
    url: 'https://example.com/movie', engine: 'yt-dlp', folder: 'Films',
    audio_only: false, quality: '720',
    overrides: {format: 'bestvideo[height<=720]+bestaudio/best[height<=720]'},
  });
});


test('dialog submits explicit audio-only flag, quality, and a real audio-only yt-dlp format',()=>{
  assert.equal(selectedMediaFormat('best','auto',true),'bestaudio');
  assert.equal(selectedMediaFormat('128','auto',true),'bestaudio[abr<=128]');
  assert.equal(selectedMediaFormat('small','auto',true),'worstaudio');
  assert.deepEqual(filesJobRequest('https://example.com/music','Music','auto','','128','auto',true),{
    url:'https://example.com/music',engine:'yt-dlp',folder:'Music',
    audio_only:true,quality:'128',overrides:{format:'bestaudio[abr<=128]'},
  });
  assert.match(selectedMediaFormat('480','auto',false),/height<=480/);
  assert.throws(()=>filesJobRequest('https://example.com/music','Music','generic','','best','auto',true),
    /require the yt-dlp engine/);
});

test('the only quality selector is in the main dialog beside Audio only',()=>{
  assert.match(section,/mediaRow\.append\(audioToggle, label\('Quality', quality\)\)/);
  assert.match(section,/audioOnly\.addEventListener\('change', updateQualityChoices\)/);
  assert.doesNotMatch(section,/label\('Quality \(video or audio\)', quality\)/);
  const settings=readFileSync(new URL('../src/settings.ts',import.meta.url),'utf8');
  assert.match(settings,/Default download quality/);
  assert.match(settings,/Default video quality/);
  assert.match(settings,/Default audio quality/);
  assert.match(settings,/changed\(field,input\.value\)/);
});
