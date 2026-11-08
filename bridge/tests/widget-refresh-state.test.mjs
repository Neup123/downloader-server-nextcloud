import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../src/dashboard.ts', import.meta.url), 'utf8');

test('periodic refresh preserves list scroll, opened menus and keyboard focus', () => {
  assert.match(source, /const scroll = list\.scrollTop/);
  assert.match(source, /menus = new Set/);
  assert.match(source, /menu\.open = true/);
  assert.match(source, /list\.scrollTop = scroll/);
  assert.match(source, /\.focus\(\{preventScroll: true\}\)/);
  assert.match(source, /refresh\(\)/);
});
test('technical log is in an independent dialog, never mounted in replaced list', () => {
  assert.match(source, /document\.body\.append\(dialog\)/);
  assert.match(source, /dialog\.showModal\(\)/);
  assert.match(source, /Technical log \(advanced\)/);
  assert.doesNotMatch(source, /list\.append\(dialog\)/);
});
