/**
 * Nextcloud-native UI adapter. All execution, secrets and WebDAV delivery
 * remain in the standalone core and authenticated ExApp. No server API token.
 */
import { registerFileAction, addNewFileMenuEntry, registerSidebarTab } from '@nextcloud/files';
import { getClient, getDefaultPropfind, getRootPath, resultToNode } from '@nextcloud/files/dav';
import { emit } from '@nextcloud/event-bus';
import { suggestTalkSource } from './talk-links.mjs';
import { filesJobRequest } from './files-dialog-payload.mjs';
import { ownDeliveredFilePaths } from './files-live.mjs';
import { downloadTitle, downloadStatus, deliveredFilesQuery } from './download-labels.mjs';

type Job = {
  id: string; url: string; status: string; owner_id?: string; engine?: string;
  progress?: {percent?: number}; error?: string | null;
  output_files?: {filename: string; path?: string; verified?: boolean; file_id?: string | number}[];
};
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
  // OC.Notification is Nextcloud's native toast. Never block the browser with
  // alert(); on older/embedded surfaces still provide non-modal feedback.
  if (oc()?.Notification?.showTemporary) {
    oc()!.Notification!.showTemporary!(message);
    return;
  }
  const toast = node('div', message, 'dl-toast');
  toast.setAttribute('role', 'status');
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 5000);
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
  // The Files folder action already supplies its destination. For Viewer/Talk,
  // omit it so the signed ExApp applies the user's own Files default.
  const presets = await api<Preset[]>('/presets').catch(() => []);
  const dialog = node('dialog', '', 'dl-dialog');
  const form = node('form');
  form.method = 'dialog';
  const title = node('h2', 'Download into my Files');
  title.id = 'dl-dialog-heading';
  dialog.setAttribute('aria-labelledby', title.id);
  dialog.setAttribute('aria-modal', 'true');

  const url = node('input', '', 'dl-input');
  url.type = 'url';
  url.required = true;
  url.placeholder = 'https://…';
  url.autocomplete = 'url';
  url.value = suggested;
  url.setAttribute('aria-label', 'Source URL');

  const engines = select(ENGINES.map(name => ({
    value: name, label: name === 'auto' ? 'Automatic' : name,
  })));
  engines.value = 'auto';
  const preset = select([
    {value: '', label: 'Use my default preset'},
    ...presets.map(item => ({value: item.id, label: item.name})),
  ]);
  const quality = select([
    {value: 'default', label: 'Use preset or automatic quality'},
    {value: 'best', label: 'Best quality'},
    {value: '1080', label: 'Up to 1080p'},
    {value: '720', label: 'Up to 720p'},
    {value: 'audio', label: 'Audio only'},
  ]);
  const format = select([
    {value: 'auto', label: 'Best available format'},
    {value: 'mp4', label: 'Prefer MP4 (M4A for audio)'},
    {value: 'webm', label: 'Prefer WebM'},
  ]);
  const options = node('details', '', 'dl-options');
  const summary = node('summary', 'Options');
  options.append(summary,
    node('p', 'Automatic chooses the right downloader. Change this only if a download fails.', 'dl-muted'),
    label('Engine', engines), label('Preset (optional)', preset),
    label('Quality (video or audio)', quality), label('Preferred format', format),
    node('p', 'These options apply to this download only. The engine chooses a compatible format when needed.', 'dl-muted'));

  const buttons = node('div', '', 'dl-buttons');
  const cancel = node('button', 'Cancel');
  cancel.type = 'button';
  const submit = node('button', 'Download', 'dl-primary');
  submit.type = 'submit';
  buttons.append(cancel, submit);
  form.append(title, label('Source URL', url), options, buttons);
  dialog.append(form);
  document.body.append(dialog);

  const close = () => {
    if (dialog.open) dialog.close();
    else dialog.remove();
  };
  cancel.addEventListener('click', close);
  dialog.addEventListener('close', () => dialog.remove(), {once: true});
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!sourceIsHttp(url.value)) {
      notify('Paste a valid HTTP or HTTPS source URL.');
      url.focus();
      return;
    }
    submit.disabled = true;
    try {
      await api('/jobs', 'POST', filesJobRequest(url.value.trim(), folder, engines.value, preset.value, quality.value, format.value));
      notify('Download added to your Nextcloud Files.');
      window.dispatchEvent(new Event('downloader:job-queued'));
      close();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Download submission failed');
      submit.disabled = false;
    }
  });
  dialog.showModal();
  url.focus();
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

type TalkMessageActionInput = {message?: {message?: unknown}};

/**
 * Nextcloud Talk 35's published OCA.Talk.registerMessageAction integration
 * adds a native action to the chat message menu. It is hidden by Talk itself
 * in classified conversations. Talk does not currently provide a per-message
 * visibility predicate, so a non-link message simply receives a no-op notice.
 */
let talkActionRegistered = false;
function registerTalkAction(): boolean {
  if (talkActionRegistered) return true;
  const talk = (window as unknown as {OCA?: {Talk?: {
    registerMessageAction?: (action: {
      label: string; icon: string; callback: (input: TalkMessageActionInput) => void
    }) => void
  }}}).OCA?.Talk;
  if (typeof talk?.registerMessageAction !== 'function') return false;
  talk.registerMessageAction({
    label: 'Download linked URL into my Files',
    icon: 'icon-download',
    callback: ({message}) => {
      const source = suggestTalkSource(message?.message);
      if (!source) {
        notify('Choose a Talk message containing exactly one HTTP(S) link.');
        return;
      }
      // Never auto-download; show the same user-owned destination and
      // engine/preset confirmation dialog as the native Files actions.
      void openDialog(null, source);
    },
  });
  talkActionRegistered = true;
  return true;
}

function installTalkAction() {
  // The Talk bundle may initialize after the native UI bridge. Bounded retry,
  // only on Talk routes; no polling of messages, DOM scraping or bot install.
  const segments = window.location.pathname.split('/');
  const inTalk = segments.some((part, index) => part === 'call'
    || (part === 'apps' && segments[index + 1] === 'spreed'));
  if (!inTalk) return;
  if (registerTalkAction()) return;
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts++;
    if (registerTalkAction() || attempts >= 30) window.clearInterval(timer);
  }, 1000);
}

/** Ambient, owner-scoped progress: no Core tokens and no navigation away from Nextcloud. */
function headerProgress(ownerId: string) {
  const header = document.querySelector('#header-right');
  if (!header || document.getElementById('downloader-topbar-progress')) return;
  const container = node('div', '', 'dl-header');
  container.id = 'downloader-topbar-progress';
  const button = node('button', 'Downloads', 'dl-trigger');
  button.type = 'button';
  button.setAttribute('aria-label', 'Show download progress');
  button.setAttribute('aria-expanded', 'false');
  const bubble = node('progress', '', 'dl-header-meter');
  bubble.max = 100;
  bubble.hidden = true;
  bubble.setAttribute('aria-label', 'Current download progress');
  const panel = node('div', '', 'dl-popover');
  panel.hidden = true;
  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-expanded', String(!panel.hidden));
  });
  container.append(button, bubble, panel);
  header.append(container);

  let active = true;
  let refreshing = false;
  let initialized = false;
  const lastStatuses = new Map<string, string>();
  const publishedFiles = new Set<string>();
  const publishingFiles = new Set<string>();

  // Nextcloud Files 35 consumes files:node:created with a real Node, not a
  // fake reload event. STAT using the viewer's signed-in WebDAV session and
  // emit only paths confirmed to belong to this same signed-in owner.
  async function publishDeliveredFiles(job: Job) {
    if (publishedFiles.has(job.id) || publishingFiles.has(job.id)) return;
    const paths = ownDeliveredFilePaths(job, ownerId);
    if (!paths.length) return;
    publishingFiles.add(job.id);
    try {
      const client = getClient();
      let allReadable = true;
      for (const path of paths) {
        try {
          const result = await client.stat(getRootPath() + path, {
            details: true, data: getDefaultPropfind(),
          });
          emit('files:node:created', resultToNode(result.data));
        } catch {
          // DAV metadata may lag core completion. Retry on the next refresh.
          allReadable = false;
        }
      }
      if (allReadable) publishedFiles.add(job.id);
    } finally {
      publishingFiles.delete(job.id);
    }
  }

  async function refresh() {
    if (!active || !container.isConnected || refreshing) return;
    refreshing = true;
    try {
      const jobs = await api<Job[]>('/jobs?limit=15');
      const running = jobs.filter(job => !TERMINAL.has(job.status));
      const current = running[0];
      const percent = Math.min(100, Math.max(0, Number(current?.progress?.percent ?? 0)));
      const safePercent = Number.isFinite(percent) ? Math.round(percent) : 0;
      button.textContent = running.length
        ? 'Downloads (' + running.length + ') · ' + safePercent + '%'
        : 'Downloads';
      bubble.hidden = !running.length;
      bubble.value = safePercent;
      button.title = running.length ? 'Download progress: ' + safePercent + '%' : 'My downloads';

      panel.replaceChildren(node('h3', 'My downloads'));
      const fullLink = node('a', 'Open history', 'dl-link');
      fullLink.href = oc()!.generateUrl('/apps/downloader_bridge/library');
      panel.append(fullLink);
      if (!jobs.length) panel.append(node('p', 'No downloads yet.', 'dl-muted'));

      for (const job of jobs.slice(0, 10)) {
        const old = lastStatuses.get(job.id);
        if (initialized && old && old !== job.status && TERMINAL.has(job.status)) {
          notify(job.status === 'completed'
            ? 'Download complete. Open it in Nextcloud Files.'
            : job.status === 'failed' ? 'Download failed. Open Downloads for details.'
              : 'Download cancelled.');
          window.dispatchEvent(new Event('downloader:jobs-updated'));
        }
        lastStatuses.set(job.id, job.status);
        if (job.status === 'completed') void publishDeliveredFiles(job);

        const row = node('div', '', 'dl-job');
        const title = node('a', downloadTitle(job), 'dl-job-title');
        title.href = oc()!.generateUrl('/apps/downloader_bridge/library') +
          '?job=' + encodeURIComponent(job.id);
        row.append(title, node('div', downloadStatus(job), 'dl-job-state'));
        if (job.engine) row.append(node('small', job.engine, 'dl-muted'));
        if (!TERMINAL.has(job.status)) {
          const p = node('progress');
          p.max = 100;
          p.value = Math.min(100, Math.max(0, Number(job.progress?.percent ?? 0)));
          row.append(p);
        }
        if (job.status === 'failed' && job.error) row.append(node('small', job.error, 'dl-error'));
        const actions = node('div', '', 'dl-job-actions');
        const query = deliveredFilesQuery(job);
        if (query) {
          const fileLink = node('a', 'Open in Files', 'dl-small dl-link');
          fileLink.href = oc()!.generateUrl('/apps/files/files') + query;
          actions.append(fileLink);
        }
        const operation = job.status === 'completed' ? 'redeliver'
          : TERMINAL.has(job.status) ? 'retry' : 'cancel';
        const action = node('button', operation === 'retry' ? 'Try again'
          : operation === 'redeliver' ? 'Re-deliver' : 'Cancel', 'dl-small');
        action.type = 'button';
        action.addEventListener('click', async () => {
          action.disabled = true;
          try { await api('/jobs/' + encodeURIComponent(job.id) + '/' + operation, 'POST'); await refresh(); }
          catch (error) { notify(error instanceof Error ? error.message : 'Action failed'); action.disabled = false; }
        });
        actions.append(action);
        row.append(actions);
        panel.append(row);
      }
      initialized = true;
    } catch {
      // Keep the bubble and retry transient connectivity errors; the ExApp
      // independently checks entitlement before returning any user job data.
      button.title = 'Unable to refresh downloads. Retrying automatically.';
    } finally {
      refreshing = false;
    }
  }
  window.addEventListener('downloader:job-queued', () => { void refresh(); });
  void refresh();
  const timer = window.setInterval(() => {
    if (!active || !container.isConnected) {active = false; window.clearInterval(timer); return;}
    void refresh();
  }, 2500);
}

type Provenance = {
  file_id: string; owner_id: string; job_id: string; source_url: string;
  engine: string; created_at: string; filename: string;
};

/** Nextcloud Files 35 supported custom-element details sidebar. */
function registerProvenanceSidebar() {
  const tagName = 'downloader_bridge-provenance-tab';
  registerSidebarTab({
    id: 'downloader_bridge-provenance',
    displayName: 'Downloads',
    iconSvgInline: ICON,
    order: 70,
    tagName,
    enabled: context => context.node.mime !== 'httpd/unix-directory',
    onInit: async () => {
      if (customElements.get(tagName)) return;
      class ProvenanceTab extends HTMLElement {
        private version = 0;
        private _node?: {id?: string | number};
        get node() { return this._node; }
        set node(value: {id?: string | number} | undefined) {
          this._node = value;
          void this.renderRecord();
        }
        private async renderRecord() {
          const call = ++this.version;
          this.replaceChildren(node('p', 'Checking download source…', 'dl-muted'));
          const id = String(this._node?.id ?? '');
          if (!/^\d{1,32}$/.test(id)) {
            this.replaceChildren(node('p', 'No Downloader source is associated with this file.', 'dl-muted'));
            return;
          }
          try {
            const record = await api<Provenance>('/provenance?file_id=' + encodeURIComponent(id));
            if (this.version !== call) return;
            const heading = node('h3', 'Original download source');
            const url = node('a', record.source_url, 'dl-provenance-source');
            url.href = record.source_url;
            url.target = '_blank'; url.rel = 'noopener noreferrer';
            const info = node('dl', '', 'dl-provenance-details');
            const when = new Date(record.created_at);
            const entries: Array<[string, string]> = [
              ['Filename', record.filename || 'Unknown'],
              ['Downloaded by', record.owner_id || 'Unknown'],
              ['Downloaded on', Number.isFinite(when.getTime()) ? when.toLocaleString() : 'Date unavailable'],
              ['Engine', record.engine || 'Unknown'],
            ];
            for (const [key, value] of entries) {
              info.append(node('dt', key), node('dd', value));
            }
            const redownload = node('button', 'Re-download from source', 'dl-primary');
            redownload.type = 'button';
            redownload.addEventListener('click', async () => {
              redownload.disabled = true;
              try {
                await api('/provenance/' + encodeURIComponent(record.file_id) + '/redownload', 'POST');
                notify('Re-download queued to your Nextcloud Files.');
              } catch (error) {
                notify(error instanceof Error ? error.message : 'Could not re-download source');
              } finally {
                redownload.disabled = false;
              }
            });
            this.replaceChildren(heading, url, info, redownload);
          } catch (error) {
            if (this.version !== call) return;
            const message = error instanceof Error && /404|not found/i.test(error.message)
              ? 'No Downloader source is associated with this file.'
              : 'Unable to check download source. Open Downloads to retry.';
            this.replaceChildren(node('p', message, 'dl-muted'));
          }
        }
      }
      customElements.define(tagName, ProvenanceTab);
    },
  });
}

function styles() {
  const style = node('style');
  style.textContent = [
    '.dl-dialog[open]{position:fixed!important;inset:0!important;margin:auto!important;',
    'box-sizing:border-box;width:min(460px,calc(100vw - 32px));max-width:calc(100vw - 32px);',
    'max-height:calc(100dvh - 32px);overflow-y:auto;padding:24px;',
    'color:var(--color-main-text,#222);background:var(--color-main-background,#fff);',
    'border:1px solid var(--color-border,#bbb);border-radius:var(--border-radius-large,12px);',
    'box-shadow:0 16px 48px #0004;z-index:11000}',
    '.dl-dialog::backdrop{background:#0008}',
    '.dl-dialog form{display:grid;gap:16px}.dl-dialog h2{margin:0;font-size:19px}',
    '.dl-options{border-top:1px solid var(--color-border,#ddd);padding-top:12px}',
    '.dl-options summary{cursor:pointer;font-weight:600;list-style-position:inside}',
    '.dl-options[open]{display:grid;gap:10px}.dl-options[open] summary{margin-bottom:6px}',
    '.dl-toast{position:fixed;z-index:12000;top:70px;right:16px;',
    'padding:12px 18px;border-radius:var(--border-radius-large,12px);',
    'background:var(--color-main-background,#fff);color:var(--color-main-text,#222);',
    'border:1px solid var(--color-border,#ddd);box-shadow:0 8px 24px #0003}',
    '.dl-label{display:grid;gap:6px;font-size:13px}.dl-input{padding:8px;width:100%;',
    'color:var(--color-main-text,#222);background:var(--color-main-background,#fff);',
    'border:1px solid var(--color-border,#ccc);border-radius:6px}',
    '.dl-buttons{display:flex;justify-content:flex-end;gap:8px}',
    '.dl-buttons button,.dl-trigger,.dl-small{cursor:pointer;padding:7px 10px;',
    'color:var(--color-main-text,#222);background:var(--color-main-background,#fff);',
    'border:1px solid var(--color-border,#ddd);border-radius:6px}',
    '.dl-primary{background:var(--color-primary,#3a7dde)!important;color:#fff!important}',
    '.dl-muted{font-size:12px;color:var(--color-text-maxcontrast,#777)}',
    '.dl-header{position:relative;display:grid;align-items:center}.dl-header-meter{width:100%;height:4px}',
    '.dl-header-meter[hidden]{display:none}.dl-popover{position:absolute;top:100%;right:0;',
    'z-index:10000;width:min(350px,92vw);max-height:65vh;overflow-y:auto;padding:12px;',
    'border:1px solid var(--color-border,#ddd);border-radius:8px;',
    'background:var(--color-main-background,#fff);box-shadow:0 5px 24px #0003}',
    '.dl-popover[hidden]{display:none}.dl-job{display:grid;gap:5px;padding:9px 0;',
    'border-bottom:1px solid var(--color-border,#ddd);font-size:12px}',
    '.dl-job-title{display:block;font-weight:600;overflow-wrap:anywhere}', 
    '.dl-job-state{font-size:13px;color:var(--color-text-maxcontrast,#777)}',
    '.dl-job-actions{display:flex;gap:8px;flex-wrap:wrap}',
    '.dl-job progress{width:100%}.dl-error{color:var(--color-error,#c33)}',
    '.dl-small{justify-self:end;padding:3px 6px}',
    '.dl-provenance-source{display:block;overflow-wrap:anywhere;margin:10px 0}',
    '.dl-provenance-details{display:grid;grid-template-columns:auto minmax(0,1fr);gap:7px 12px;font-size:13px}',
    '.dl-provenance-details dt{color:var(--color-text-maxcontrast,#777)}',
    '.dl-provenance-details dd{margin:0;overflow-wrap:anywhere}',
    '.dl-viewer-trigger{position:absolute;top:18px;right:108px;z-index:10050;',
    'padding:7px 10px;border-radius:6px;border:1px solid var(--color-border,#ccc);',
    'background:var(--color-main-background,#222);color:var(--color-main-text,#fff);cursor:pointer}',
  ].join('');
  document.head.append(style);
}

async function start() {
  // No UI for users without server-side entitlement. The ExApp enforces
  // this independently for every authenticated call.
  let identity: {user_id: string; entitled: boolean};
  try { identity = await api<{user_id: string; entitled: boolean}>('/me'); }
  catch { return; }
  styles(); registerActions(); registerProvenanceSidebar(); headerProgress(identity.user_id); installLegacyViewerHook(); installTalkAction();
}
void start();
