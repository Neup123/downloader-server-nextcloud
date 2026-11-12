import assert from 'node:assert/strict';
import test from 'node:test';
import {createBackgroundServicePanel, parseServiceSettings, SERVICE_MODES} from '../src/background-services.mjs';
import {downloadStatus, downloadBubbleStatus} from '../src/download-labels.mjs';

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.events = {}; this.textContent = ''; this.hidden = false; this.disabled = false; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(name, value) { this.attrs[name] = value; }
  addEventListener(name, listener) { this.events[name] = listener; }
  click() { this.events.click?.(); }
}
const document = {createElement: tag => new Element(tag)};
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
const response = (mode, state = 'running', service_error = null) => ({settings: {mode}, state, service_error});
const tick = () => new Promise(resolve => setImmediate(resolve));

test('all three modes render per service, missing mode is Off regardless of old opt-in', async () => {
  const panel = createBackgroundServicePanel(document, async engine => engine === 'pyload'
    ? {settings: {enabled: true}, state: 'stopped', service_error: null}
    : response('on-demand'));
  await panel.refresh();
  assert.equal(panel.element.hidden, false);
  assert.deepEqual(SERVICE_MODES, ['off', 'always', 'on-demand']);
  const buttons = descendants(panel.element).filter(node => node.tagName === 'button' && node.attrs['aria-pressed'] !== undefined);
  assert.equal(buttons.length, 6);
  assert.deepEqual(buttons.slice(0, 3).map(button => button.textContent), ['Off', 'Always on', 'On-demand']);
  assert.deepEqual(buttons.slice(0, 3).map(button => button.attrs['aria-pressed']), ['true', 'false', 'false']);
  assert.deepEqual(buttons.slice(3).map(button => button.attrs['aria-pressed']), ['false', 'false', 'true']);
});

test('selection autosaves exact mode object; state and upstream error are visible', async () => {
  const requests = [];
  const panel = createBackgroundServicePanel(document, async (engine, method, body) => {
    requests.push({engine, method, body});
    return method === 'PUT' ? response(body.settings.mode, 'starting', 'Cannot bind port') : response('off', 'stopped');
  });
  await panel.refresh();
  const buttons = descendants(panel.element).filter(node => node.attrs['aria-pressed'] !== undefined);
  buttons[2].click();
  await tick();
  assert.deepEqual(requests[2], {engine: 'pyload', method: 'PUT', body: {settings: {mode: 'on-demand'}}});
  assert.equal(buttons[2].attrs['aria-pressed'], 'true');
  const text = descendants(panel.element).map(node => node.textContent).join(' ');
  assert.match(text, /State: starting/);
  assert.match(text, /Service error: Cannot bind port/);
});

test('failed start retains selected mode, and selecting the same mode retries', async () => {
  let put = 0;
  const panel = createBackgroundServicePanel(document, async (engine, method, body) => {
    if (method === 'PUT') { put++; return response(body.settings.mode, 'stopped', 'Start failed'); }
    return response('always', 'stopped', 'Start failed');
  });
  await panel.refresh();
  const first = descendants(panel.element).filter(node => node.attrs['aria-pressed'] !== undefined)[1];
  first.click(); await tick(); first.click(); await tick();
  assert.equal(put, 2);
  assert.equal(first.attrs['aria-pressed'], 'true');
});

test('non-admin cannot see global controls, malformed mode is rejected', async () => {
  const panel = createBackgroundServicePanel(document, async () => { throw Object.assign(new Error('Forbidden'), {status: 403}); });
  await panel.refresh();
  assert.equal(panel.element.hidden, true);
  assert.equal(parseServiceSettings({settings: {enabled: true}, state: 'stopped'}).mode, 'off');
  assert.throws(() => parseServiceSettings({settings: {mode: 'enabled'}}), /Unknown service mode/);
});

test('job phase appears in existing status labels, even for a completed idle-stop job', () => {
  const job = {status: 'starting', progress: {phase: 'starting_service', service: 'pyload'}};
  assert.match(downloadStatus(job), /Starting pyLoad service/);
  assert.match(downloadBubbleStatus(job), /Starting pyLoad service/);
  job.status = 'downloading';
  job.progress.phase = 'downloading';
  job.progress.percent = 42;
  assert.match(downloadStatus(job), /Downloading 42%/);
  job.status = 'completed';
  job.progress.phase = 'stopping_service';
  job.progress.service = 'cobalt';
  assert.match(downloadStatus(job), /Stopping cobalt service/);
  delete job.progress.phase;
  assert.match(downloadStatus(job), /Completed/);
});
