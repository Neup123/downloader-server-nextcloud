import test from 'node:test';
import assert from 'node:assert/strict';
import {PersonalAutosave} from '../src/personal-autosave.ts';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('hydration never writes even if API and UI property order differs', async () => {
  const written = [], states = [];
  const queue = new PersonalAutosave(async value => written.push(value), state => states.push(state), 5);
  queue.hydrate({destination_folder: 'Downloads', default_preset: '', notify_finished: true});
  queue.change({notify_finished: true, default_preset: '', destination_folder: 'Downloads'});
  await sleep(25);
  assert.deepEqual(written, []);
  assert.equal(states.at(-1), 'saved');
  queue.dispose();
});

test('multiple new settings debounce to latest snapshot only', async () => {
  const writes = [];
  const queue = new PersonalAutosave(async x => writes.push(x), () => {}, 10);
  queue.hydrate({folder: 'Downloads', notifications: true});
  queue.change({folder: 'Movies', notifications: true});
  queue.change({folder: 'Music', notifications: false});
  await sleep(40);
  assert.deepEqual(writes, [{folder: 'Music', notifications: false}]);
  queue.dispose();
});

test('stale in-flight response does not win over a newer snapshot', async () => {
  const saved = [], states = [];
  let release;
  const queue = new PersonalAutosave(async value => {
    saved.push(value.folder);
    if (value.folder === 'Movies') await new Promise(resolve => {release = resolve});
  }, status => states.push(status), 5);
  queue.hydrate({folder: 'Downloads'});
  queue.change({folder: 'Movies'});
  await sleep(18);
  queue.change({folder: 'Music'});
  await sleep(14);
  assert.deepEqual(saved, ['Movies']);
  release();
  await sleep(35);
  assert.deepEqual(saved, ['Movies', 'Music']);
  assert.equal(states.at(-1), 'saved');
  queue.dispose();
});

test('failed writes offer retry; invalid draft pauses in-flight success', async () => {
  const states = [], writes = [];
  let fail = true, release;
  const queue = new PersonalAutosave(async value => {
    writes.push(value);
    if (value.destination_folder === 'Movies') await new Promise(resolve => {release = resolve});
    if (fail) throw Error('offline');
  }, status => states.push(status), 5);
  queue.hydrate({destination_folder: 'Downloads'});
  queue.change({destination_folder: 'Movies'});
  await sleep(15);
  queue.pause();
  release();
  await sleep(16);
  assert.equal(states.at(-1), 'error', 'stale HTTP completion must not show saved');
  fail = false;
  queue.change({destination_folder: 'Music'});
  await sleep(25);
  assert.equal(states.at(-1), 'saved');
  queue.dispose();
});
