import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../src/bridge.ts', import.meta.url), 'utf8');
const exappPresent = existsSync(new URL('../../nextcloud_exapp/', import.meta.url));
const readExapp = file => readFileSync(new URL('../../nextcloud_exapp/' + file, import.meta.url), 'utf8');

test('personal settings retain quality defaults and header preferences', () => {
  for (const key of ['header_indicator_visibility','dropdown_content','Default download quality',
    'Default audio quality','Default video quality', 'changed(', "'/settings','PUT',patch"]) {
    assert.ok(settings.includes(key), key);
  }
});

test('no native personal or download dialog manages named presets', () => {
  assert.doesNotMatch(settings, /preset/i);
  assert.doesNotMatch(bridge, /preset/i);
});

test('ExApp exposes no preset endpoints or catalog', {skip: !exappPresent}, () => {
  const main = readExapp('main.py');
  assert.doesNotMatch(main, /api\/presets|preset-catalog|preset-permissions|presets\/shared/);
  assert.match(main, /await job_submission\(context, data\)/);
});
