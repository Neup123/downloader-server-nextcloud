/** Administrator-only presentation of Core-owned background-service settings. */
export const SERVICE_MODES = ['off', 'always', 'on-demand'];
const SERVICES = [
  {id: 'pyload', name: 'pyLoad', ram: '50–150 MB'},
  {id: 'cobalt', name: 'cobalt', ram: '100–150 MB'},
];

export function parseServiceSettings(reply) {
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) {
    throw new Error('Invalid service settings response');
  }
  const settings = reply.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('Invalid service settings response');
  }
  const mode = settings.mode === undefined || settings.mode === null ? 'off' : settings.mode;
  if (!SERVICE_MODES.includes(mode)) throw new Error('Unknown service mode returned by Core');
  return {
    mode,
    state: ['stopped', 'starting', 'running', 'stopping'].includes(reply.state)
      ? reply.state : 'unknown',
    serviceError: typeof reply.service_error === 'string' ? reply.service_error : '',
  };
}

export function createBackgroundServicePanel(doc, request) {
  const make = (tag, text = '') => {
    const node = doc.createElement(tag);
    node.textContent = text;
    return node;
  };
  const panel = make('section');
  panel.className = 'downloader-service-panel';
  panel.hidden = true; // Never show global settings before the admin gate succeeds.
  const title = make('h3', 'Enable with caution — background services');
  const explanation = make('p', 'Off prevents service use. On-demand starts a service when a job needs it, adding a few seconds of startup time. Always on keeps the service ready but uses memory even when idle.');
  const notice = make('p');
  notice.className = 'downloader-service-notice';
  notice.setAttribute('role', 'status');
  const retry = make('button', 'Retry loading services');
  retry.type = 'button';
  retry.hidden = true;
  const rows = new Map();
  panel.append(title, explanation, notice, retry);

  for (const service of SERVICES) {
    const group = make('fieldset');
    group.className = 'downloader-service-group';
    const legend = make('legend', service.name);
    const help = make('p', 'Always on uses approximately ' + service.ram + ' of idle RAM; on-demand releases it after the idle grace period.');
    const buttons = make('div');
    buttons.className = 'downloader-service-modes';
    buttons.setAttribute('role', 'group');
    buttons.setAttribute('aria-label', service.name + ' background mode');
    const choices = new Map();
    for (const [mode, text] of [['off', 'Off'], ['always', 'Always on'], ['on-demand', 'On-demand']]) {
      const button = make('button', text);
      button.type = 'button';
      button.disabled = true;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => { void save(service.id, mode); });
      choices.set(mode, button);
      buttons.append(button);
    }
    const state = make('p', 'State: unknown');
    state.className = 'downloader-service-state';
    state.setAttribute('role', 'status');
    const error = make('p');
    error.className = 'downloader-service-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    group.append(legend, help, buttons, state, error);
    panel.append(group);
    rows.set(service.id, {choices, state, error, busy: false, ready: false});
  }

  function display(engine, reply) {
    const row = rows.get(engine);
    const data = parseServiceSettings(reply);
    row.ready = true;
    for (const [mode, button] of row.choices) {
      button.disabled = row.busy;
      button.setAttribute('aria-pressed', String(data.mode === mode));
    }
    row.state.textContent = 'State: ' + data.state;
    row.error.textContent = data.serviceError ? 'Service error: ' + data.serviceError : '';
    row.error.hidden = !data.serviceError;
  }

  let loading = null;
  async function refresh() {
    if (loading) return loading;
    loading = (async () => {
      const results = await Promise.all(SERVICES.map(async service => {
        const row = rows.get(service.id);
        if (row.busy) return {skipped: true};
        try { return {reply: await request(service.id, 'GET')}; }
        catch (error) { return {error}; }
      }));
      if (results.some(result => result.error?.status === 403)) {
        panel.hidden = true;
        return; // Signed-in user is not a Nextcloud administrator.
      }
      panel.hidden = false;
      let failed = false;
      for (const [index, service] of SERVICES.entries()) {
        const result = results[index];
        if (result.skipped) continue;
        const row = rows.get(service.id);
        try {
          if (result.error) throw result.error;
          display(service.id, result.reply);
        } catch (error) {
          failed = true;
          row.state.textContent = service.name + ': unable to load settings';
          row.error.textContent = error instanceof Error ? error.message : 'Service unavailable';
          row.error.hidden = false;
          if (!row.ready) for (const button of row.choices.values()) button.disabled = true;
        }
      }
      notice.textContent = failed ? 'Some services could not be refreshed.' : 'Changes take effect immediately.';
      retry.hidden = !failed;
    })().finally(() => { loading = null; });
    return loading;
  }

  async function save(engine, mode) {
    const row = rows.get(engine);
    if (row.busy || !row.ready || !SERVICE_MODES.includes(mode)) return;
    row.busy = true;
    for (const button of row.choices.values()) button.disabled = true;
    row.state.textContent = 'Saving ' + engine + ' mode…';
    try {
      const result = await request(engine, 'PUT', {settings: {mode}});
      display(engine, result);
      notice.textContent = 'Saved. Changes take effect immediately.';
    } catch (error) {
      row.error.textContent = error instanceof Error ? error.message : 'Could not save service mode';
      row.error.hidden = false;
      row.state.textContent = 'Save failed — refresh to check current service state.';
      retry.hidden = false;
    } finally {
      row.busy = false;
      for (const button of row.choices.values()) button.disabled = !row.ready;
    }
  }
  retry.addEventListener('click', () => { void refresh(); });
  return {element: panel, refresh};
}
