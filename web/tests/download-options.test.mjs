import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedMediaFormat} from '../src/ui-options.ts';

test('quality/format choices use documented yt-dlp selectors without JSON input', () => {
  assert.equal(selectedMediaFormat(), null);
  assert.equal(selectedMediaFormat('best', 'auto'), 'bv*+ba/b');
  assert.equal(selectedMediaFormat('720', 'auto'), 'bestvideo[height<=720]+bestaudio/best[height<=720]');
  assert.equal(selectedMediaFormat('audio', 'mp4'), 'bestaudio[ext=m4a]/bestaudio');
  assert.match(selectedMediaFormat('1080', 'webm'), /height<=1080/);
  assert.match(selectedMediaFormat('1080', 'webm'), /ext=webm/);
});
