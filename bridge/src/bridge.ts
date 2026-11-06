/**
 * Nextcloud-native UI adapter. All execution, secrets and WebDAV delivery
 * remain in the standalone core and authenticated ExApp. No server API token.
 */
import { registerFileAction, addNewFileMenuEntry } from '@nextcloud/files';

type Job = {id: string; url: string; status: string; progress?: {percent?: number}; error?: string | null};
type Preset = {id: string; name: string; engine: string};
type Oc = {generateUrl: (path: string) => string; requestToken?: string;
  Notification?: {showTemporary?: (message: string) => void}};
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0-5-5m5 5 5-5M4 17v3h16v-3"/></svg>';
const ENGINES = ['auto', 'yt-dlp', 'aria2c', 'gallery-dl', 'generic', 'you-get', 'svtplay-dl', 'get-sauce'];
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const oc = () => (window as unknown as {OC?: Oc}).OC;
const root = () => {
  if (!oc()?.generateUrl) throw new Error('Nextcloud routing unavailable');
  return oc()!.generateUrl('/apps/app_api/proxy/downloader-server-nextcloud/user/api');
};

async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const res = await fetch(root() + path, {
    method, credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'OCS-APIRequest': 'true',
      ...(oc()?.requestToken ? {requesttoken: oc()!.requestToken!} : {}),
    },
    ...(data === undefined ? {} : {body: JSON.stringify(data)}),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (body as {detail?: string} | null)?.detail;
    throw new Error(detail || 'Downloader request failed (' + res.status + ')');
  }
  return body as T;
}

function notify(message: string) {
  if (oc()?.Notification?.showTemporary) oc()!.Notification!.showTemporary!(message);
  else window.alert(message);
}
function sourceIsHttp(value: string): boolean {
  try { return ['https:', 'http:'].includes(new URL(value).protocol); }
  catch { return false; }
}
function node<K extends keyof HTMLElementTagNameMap>(name: K, text = '', cls = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(name);
  if (text) element.textContent = text;
  if (cls) element.className = cls;
  return element;
}
function label(name: string, input: HTMLElement) {
  const element = node('label', name, 'dl-label');
  element.append(input);
  return element;
}
function select(options: Array<{value: string; label: string}>) {
  const input = node('select', '', 'dl-input');
  options.forEach(item => {
    const option = node('option', item.label);
    option.value = item.value;
    input.append(option);
  });
  return input;
}
function cleanFolder(path?: string): string {
  return (path || '/').replace(/^\/+|\/+$/g, '');
}

async function openDialog(folder: string | null, suggested = '') {
  const presets = await api<Preset[]>('/presets').catch(() => []);
  const dialog = node('dialog', '', 'dl-dialog');
  const form = node('form');
  form.method = 'dialog';
  const title = node('h2', 'Download into my Files');
  const url = node('input', '', 'dl-input');
  url.type = 'url'; url.required = true; url.placeholder = 'https://…'; url.value = suggested;
  const engines = select(ENGINES.map(name => ({value: name, label: name === 'auto' ? 'Automatic' : name})));
  const preset = select([
    {value: '', label: 'Use my default preset'},
    ...presets.map(item => ({value: item.id, label: item.name})),
  ]);
  const destination = node('input', '', 'dl-input');
  destination.value = folder === null ? 'Downloads' : folder;
  destination.placeholder = 'Folder in my Files';
  const buttons = node('div', '', 'dl-buttons');
  const cancel = node('button', 'Cancel');
  cancel.type = 'button';
  const submit = node('button', 'Download', 'dl-primary');
  submit.type = 'submit';
  buttons.append(cancel, submit);
  form.append(title, label('Source URL', url), label('Engine', engines),
    label('Preset (optional)', preset), label('Destination in my Files', destination),
    node('p', 'Download execution is server-side. Files are delivered to your own account.', 'dl-muted'),
    buttons);
  dialog.append(form); document.body.append(dialog);
  const close = () => {dialog.close(); dialog.remove();};
  cancel.addEventListener('click', close);
  dialog.addEventListener('close', () => dialog.remove(), {once:true});
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!sourceIsHttp(url.value)) return notify('Paste a valid HTTP or HTTPS source URL.');
    submit.disabled = true;
    try {
      await api('/jobs', 'POST', {
        url: url.value,
        engine: engines.value,
        ...(preset.value ? {preset_id: preset.value} : {}),
        ...(destination.value ? {folder: destination.value} : {folder: ''}),
      });
      notify('Download submitted to your Nextcloud Files.');
      close();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Download submission failed');
      submit.disabled = false;
    }
  });
  dialog.showModal(); url.focus();
}

function registerActions() {
  // Nextcloud 35 officially uses @nextcloud/files v4 to register contextual actions.
  registerFileAction({
    id: 'downloader-folder-action',
    displayName: () => 'Download into this folder',
    iconSvgInline: () => ICON,
    enabled: context => context.nodes.length === 1
      && context.nodes[0].mime === 'httpd/unix-directory',
    exec: async context => { await openDialog(cleanFolder(context.nodes[0].path)); return true; },
    order: 60,
  });
  addNewFileMenuEntry({
    id: 'downloader-new-action',
    displayName: 'Download into this folder',
    iconSvgInline: ICON,
    order: 65,
    handler: folder => {void openDialog(cleanFolder(folder.path));},
  });
  registerFileAction({
    id: 'downloader-viewer-action',
    displayName: () => 'Download with Downloader',
    iconSvgInline: () => ICON,
    enabled: context => context.nodes.length === 1
      && /^(video|audio|image)\//.test(context.nodes[0].mime),
    exec: async context => {
      // Never treat a private Nextcloud WebDAV source as public original media.
      const attributes = context.nodes[0].attributes as Record<string, unknown> | undefined;
      const original = attributes && typeof attributes.download_source_url === 'string'
        && sourceIsHttp(attributes.download_source_url) ? attributes.download_source_url : '';
      if (original) {
        try {
          await api('/jobs', 'POST', {url: original});
          notify('Download submitted to your Files.');
          return true;
        } catch (error) {
          notify(error instanceof Error ? error.message : 'Download failed');
          return false;
        }
      }
      await openDialog(null);
      return true;
    },
    order: 90,
  });
}

/**
 * Nextcloud 35's legacy OCA.Viewer does not consume @nextcloud/files v4 menu
 * actions in its own modal toolbar. This is a UI-only compatibility affordance:
 * never infer a source URL from a private Nextcloud DAV path.
 */
function attachLegacyViewerAction() {
  const viewer = document.querySelector<HTMLElement>('#viewer.viewer');
  if (!viewer || viewer.querySelector('#downloader-viewer-action')) return;
  const legacy = (window as unknown as {OCA?: {Viewer?: {
    fileInfo?: {mime?: string; mimetype?: string; download_source_url?: string};
  }}}).OCA?.Viewer;
  const info = legacy?.fileInfo;
  const mime = info?.mimetype || info?.mime || '';
  if (!/^(video|audio|image)\//.test(mime) && !viewer.querySelector('video, audio, img')) return;
  const target = viewer.querySelector<HTMLElement>('.modal-header, .modal__header, [class*="modal-header"]') || viewer;
  const button = node('button', 'Download with Downloader', 'dl-viewer-trigger');
  button.id = 'downloader-viewer-action';
  button.type = 'button';
  button.addEventListener('click', () => {
    const current = (window as unknown as {OCA?: {Viewer?: {
      fileInfo?: {download_source_url?: string};
    }}}).OCA?.Viewer?.fileInfo;
    const source = current?.download_source_url;
    if (source && sourceIsHttp(source)) {
      void api('/jobs', 'POST', {url: source}).then(
        () => notify('Download submitted to your Files.'),
        error => notify(error instanceof Error ? error.message : 'Download failed'),
      );
    } else {
      void openDialog(null);
    }
  });
  target.append(button);
}

function installLegacyViewerHook() {
  let pending = false;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      attachLegacyViewerAction();
    });
  });
  observer.observe(document.body, {childList: true, subtree: true});
  attachLegacyViewerAction();
}

function headerProgress() {
  const header = document.querySelector('#header-right');
  if (!header || document.getElementById('downloader-topbar-progress')) return;
  const container = node('div', '', 'dl-header');
  container.id = 'downloader-topbar-progress';
  const button = node('button', 'Downloads', 'dl-trigger');
  button.type = 'button'; button.setAttribute('aria-expanded', 'false');
  const panel = node('div', '', 'dl-popover');
  panel.hidden = true;
  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-expanded', String(!panel.hidden));
  });
  container.append(button, panel); header.append(container);
  let active = true;
  async function refresh() {
    if (!active || !container.isConnected) return;
    try {
      const jobs = await api<Job[]>('/jobs?limit=15');
      const count = jobs.filter(job => !TERMINAL.has(job.status)).length;
      button.textContent = 'Downloads (' + count + ')';
      panel.replaceChildren(node('h3', 'My downloads'));
      const fullLink = node('a', 'Open history', 'dl-link');
      fullLink.href = oc()!.generateUrl('/apps/app_api/proxy/downloader-server-nextcloud/user/');
      panel.append(fullLink);
      if (!jobs.length) panel.append(node('p', 'No downloads yet.', 'dl-muted'));
      for (const job of jobs.slice(0, 10)) {
        const row = node('div', '', 'dl-job');
        const title = node('span', job.status + ': ' + job.url);
        title.title = job.url; row.append(title);
        if (!TERMINAL.has(job.status)) {
          const p = node('progress');
          p.max = 100;
          p.value = Math.min(100, Math.max(0, Number(job.progress?.percent ?? 0)));
          row.append(p);
        }
        if (job.status === 'failed' && job.error) row.append(node('small', job.error, 'dl-error'));
        if (job.status !== 'completed') {
          const operation = TERMINAL.has(job.status) ? 'retry' : 'cancel';
          const action = node('button', operation === 'retry' ? 'Retry' : 'Cancel', 'dl-small');
          action.type = 'button';
          action.addEventListener('click', async () => {
            action.disabled = true;
            try { await api('/jobs/' + encodeURIComponent(job.id) + '/' + operation, 'POST'); await refresh(); }
            catch (error) { notify(error instanceof Error ? error.message : 'Action failed'); action.disabled = false; }
          });
          row.append(action);
        }
        panel.append(row);
      }
    } catch {
      // Revoked entitlement removes ambient controls rather than leaving stale UI.
      active = false; container.remove();
    }
  }
  void refresh();
  const timer = window.setInterval(() => {
    if (!active || !container.isConnected) {window.clearInterval(timer);return;}
    void refresh();
  }, 4000);
}

function styles() {
  const style = node('style');
  style.textContent = [
    '.dl-dialog{color:var(--color-main-text,#222);background:var(--color-main-background,#fff);',
    'border:1px solid var(--color-border,#bbb);border-radius:12px;padding:24px;',
    'width:min(420px,92vw);max-width:92vw}.dl-dialog::backdrop{background:#0008}',
    '.dl-dialog form{display:grid;gap:12px}.dl-dialog h2{margin:0;font-size:19px}',
    '.dl-label{display:grid;gap:6px;font-size:13px}.dl-input{padding:8px;width:100%;',
    'color:var(--color-main-text,#222);background:var(--color-main-background,#fff);',
    'border:1px solid var(--color-border,#ccc);border-radius:6px}',
    '.dl-buttons{display:flex;justify-content:flex-end;gap:8px}',
    '.dl-buttons button,.dl-trigger,.dl-small{cursor:pointer;padding:7px 10px;',
    'color:var(--color-main-text,#222);background:var(--color-main-background,#fff);',
    'border:1px solid var(--color-border,#ddd);border-radius:6px}',
    '.dl-primary{background:var(--color-primary,#3a7dde)!important;color:#fff!important}',
    '.dl-muted{font-size:12px;color:var(--color-text-maxcontrast,#777)}',
    '.dl-header{position:relative}.dl-popover{position:absolute;top:100%;right:0;',
    'z-index:10000;width:min(350px,92vw);max-height:65vh;overflow-y:auto;padding:12px;',
    'border:1px solid var(--color-border,#ddd);border-radius:8px;',
    'background:var(--color-main-background,#fff);box-shadow:0 5px 24px #0003}',
    '.dl-popover[hidden]{display:none}.dl-job{display:grid;gap:5px;padding:9px 0;',
    'border-bottom:1px solid var(--color-border,#ddd);font-size:12px}',
    '.dl-job span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.dl-job progress{width:100%}.dl-error{color:var(--color-error,#c33)}',
    '.dl-small{justify-self:end;padding:3px 6px}',
    '.dl-viewer-trigger{position:absolute;top:18px;right:108px;z-index:10050;',
    'padding:7px 10px;border-radius:6px;border:1px solid var(--color-border,#ccc);',
    'background:var(--color-main-background,#222);color:var(--color-main-text,#fff);cursor:pointer}',
  ].join('');
  document.head.append(style);
}

async function start() {
  // No UI for users without server-side entitlement. The ExApp enforces
  // this independently for every authenticated call.
  try { await api<{user_id: string; entitled: boolean}>('/me'); }
  catch { return; }
  styles(); registerActions(); headerProgress(); installLegacyViewerHook();
}
void start();
