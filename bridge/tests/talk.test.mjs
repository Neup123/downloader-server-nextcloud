import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { suggestTalkSource } from '../src/talk-links.mjs';

const bridge = readFileSync(new URL('../src/bridge.ts', import.meta.url), 'utf8');

test('Talk extracts exactly one explicit HTTPS/HTTP source without changing link contents', () => {
  assert.equal(suggestTalkSource('Try https://media.example/video?id=7&quality=high.'), 'https://media.example/video?id=7&quality=high');
  assert.equal(suggestTalkSource('See [video](https://media.example/watch/123)'), 'https://media.example/watch/123');
  assert.equal(suggestTalkSource('http://example.org/test'), 'http://example.org/test');
  assert.equal(suggestTalkSource('https://media.example/v https://media.example/v'), 'https://media.example/v');
});

test('Talk never guesses a source from ambiguous, invalid, credential-bearing or non-link text', () => {
  for (const message of [
    '', null, {}, 44, 'The document is at /remote.php/dav/files/alice/media.mp4',
    'ftp://example.org/test', 'https://example.org/one https://example.net/two',
    'https://user:password@example.org/media', 'https://[not-ipv6]/media',
    'x'.repeat(16385),
  ]) {
    assert.equal(suggestTalkSource(message), null, String(message).slice(0, 80));
  }
});

test('Native Talk action is registered only after signed entitlement, with confirmation', () => {
  assert.match(bridge, /registerMessageAction/);
  assert.match(bridge, /label: 'Download linked URL into my Files'/);
  assert.match(bridge, /suggestTalkSource\(message\?\.message\)/);
  assert.match(bridge, /void openDialog\(null, source\)/);
  assert.ok(bridge.indexOf("await api<{user_id: string; entitled: boolean}>('/me')") < bridge.lastIndexOf('installTalkAction();'));
  const callback = bridge.slice(bridge.indexOf('callback: ({message})'), bridge.indexOf('talkActionRegistered = true'));
  assert.doesNotMatch(callback, /api\('\/jobs', 'POST'/, 'Message clicks must never auto-submit jobs');
});

test('Unchanged implicit Files destination is omitted so first-use Downloads creation works', () => {
  assert.match(bridge, /folder === null \? settings!\.destination_folder : folder/);
  assert.match(bridge, /folder === null && destination\.value\.trim\(\) === originalDestination/);
  assert.match(bridge, /\? \{\} : \{folder: destination\.value\}/);
  assert.match(bridge, /api<\{destination_folder: string\}>\('\/settings'\)/);
});
