/** Native Nextcloud Dashboard widget; fetches only current signed-in user's jobs. */
import { downloadTitle, downloadStatus, deliveredFilesQuery, downloadSymbol, downloadAmount } from './download-labels.mjs';
import { filesJobRequest } from './files-dialog-payload.mjs';
type Oc = {generateUrl: (path: string) => string; requestToken?: string};
type Job = {
  id: string; url: string; status: string; created_at: string;
  owner_id?: string; engine?: string;
  progress?: {percent?: number; downloaded_bytes?: number; speed_bytes_per_second?: number};
  error?: string | null; log_text?: string;
  output_files?: {filename:string;size_bytes?:number;path?:string;verified?:boolean;file_id?:string|number}[];
};
type Dashboard = {register: (id: string, render: (el: HTMLElement) => void) => void};
const host = window as unknown as {OC?: Oc; OCA?: {Dashboard?: Dashboard}};
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const elem = <K extends keyof HTMLElementTagNameMap>(name: K, text = ''): HTMLElementTagNameMap[K] => {
  const n = document.createElement(name);
  n.textContent = text;
  return n;
};
function apiRoot(): string {
  const oc = host.OC;
  if (!oc?.generateUrl) throw new Error('Nextcloud routing unavailable');
  return oc.generateUrl('/apps/app_api/proxy/downloader-server-nextcloud/user/api');
}
async function api<T>(url: string, method = 'GET', data?: object): Promise<T> {
  const response = await fetch(apiRoot() + url, {
    method, credentials: 'same-origin', headers: {
      'OCS-APIRequest': 'true',
      ...(host.OC?.requestToken ? {requesttoken: host.OC.requestToken} : {}),
      ...(data === undefined ? {} : {'Content-Type': 'application/json'}),
    },
    ...(data === undefined ? {} : {body: JSON.stringify(data)}),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as {detail?: unknown} | null;
    const detail = typeof body?.detail === 'string' ? body.detail : 'Downloader unavailable';
    throw new Error(detail);
  }
  return await response.json() as T;
}
/** Core JobCard structure, styled with native Nextcloud colors and focus cues. */
const CARD_STYLE = `
.downloader-dashboard-content{min-width:0;max-width:100%;overflow:hidden;color:var(--color-main-text,#222)}
.downloader-dashboard-content .job-list{display:grid;gap:0;max-height:380px;overflow-y:auto;overflow-x:hidden;min-height:0;margin-top:8px}
.downloader-dashboard-content .job-row{display:flex;gap:10px;align-items:center;min-width:0;padding:8px 2px;border-bottom:1px solid var(--color-border,#ddd)}
.downloader-dashboard-content .job-card-icon{width:32px;height:32px;flex:0 0 32px;display:grid;place-items:center;border-radius:8px;background:var(--color-background-dark,#eee);font-size:18px}
.downloader-dashboard-content .job-card-icon img{display:block;max-width:100%;max-height:100%;object-fit:cover;border-radius:8px;position:absolute;inset:0;width:32px;height:32px}
.downloader-dashboard-content .job-card-icon{position:relative;overflow:hidden}
.downloader-dashboard-content .job-card-info{flex:1;min-width:0;display:grid;gap:2px}
.downloader-dashboard-content .job-card-title{display:block;max-width:100%;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.downloader-dashboard-content .job-card-state{display:block;max-width:100%;font-size:12px;color:var(--color-text-maxcontrast,#666);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.downloader-dashboard-content .job-actions{display:flex;align-items:center;gap:2px;flex:0 0 auto}
.downloader-dashboard-content .job-actions button,.downloader-dashboard-content .job-actions summary{width:32px;height:32px;display:grid;place-items:center;padding:0;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;list-style:none}
.downloader-dashboard-content .job-actions :is(button,summary):hover{background:var(--color-background-hover,#ddd)}
.downloader-dashboard-content .job-menu{position:relative}
.downloader-dashboard-content .job-menu summary::-webkit-details-marker{display:none}
.downloader-dashboard-content .job-menu-items{position:absolute;z-index:100;right:0;top:100%;width:max-content;min-width:160px;padding:5px;display:grid;gap:2px;border:1px solid var(--color-border,#aaa);border-radius:9px;background:var(--color-main-background,#fff);box-shadow:0 6px 24px #0003}
.downloader-dashboard-content .job-menu-items button{width:100%;min-height:34px;display:block;text-align:start;padding:6px 10px;font-size:12px}
.downloader-dashboard-content .mini-progress{width:100%;height:3px}
.downloader-dashboard-content :is(button,a,summary):focus-visible{outline:3px solid var(--color-primary,#377bd1);outline-offset:2px}
.downloader-widget-dialog[open]{position:fixed!important;inset:0!important;margin:auto!important;width:min(540px,calc(100vw - 32px));max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);overflow:auto;padding:22px;border:1px solid var(--color-border,#aaa);border-radius:12px;background:var(--color-main-background,#fff);color:var(--color-main-text,#222)}
.downloader-widget-dialog::backdrop{background:#0008}
.downloader-widget-dialog pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow-y:auto}
.downloader-widget-dialog .job-modal-actions{display:flex;justify-content:flex-end;gap:8px}
`;

function renderDashboard(element: HTMLElement) {
  const area = elem('section');
  area.className = 'downloader-dashboard-content';
  // CSS is scoped to the widget instead of mutating Nextcloud global styles.
  const cardStyle = elem('style');
  cardStyle.textContent = CARD_STYLE;
  area.append(cardStyle);
  const history = elem('a', 'Open downloads history');
  history.href = host.OC!.generateUrl('/apps/downloader_bridge/library');
  history.style.display = 'block';
  history.style.padding = '8px 0';
  const quick = elem('form');
  quick.style.cssText = 'display:grid;gap:8px;margin-bottom:15px';
  const label = elem('label', 'Quick download link');
  label.style.cssText = 'display:grid;gap:7px;font-size:13px';
  const field = elem('input');
  field.type = 'url'; field.required = true;
  field.placeholder = 'https://example.org/file';
  field.setAttribute('aria-label', 'Link to download into my Files');
  field.style.cssText = 'width:100%;min-height:44px;padding:9px;border:1px solid var(--color-border,#777);border-radius:8px';
  const submit = elem('button', 'Download');
  submit.type = 'submit';
  submit.style.cssText = 'padding:9px 12px;min-height:44px;cursor:pointer';
  const feedback = elem('p'); feedback.setAttribute('role', 'status');
  feedback.style.cssText = 'margin:0;font-size:12px';
  label.append(field); quick.append(label, submit, feedback);
  const list = elem('div');
  list.className = 'job-list';
  area.append(quick, history, list);
  quick.addEventListener('submit', async event => {
    event.preventDefault();
    let value = field.value.trim();
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname ||
          parsed.username || parsed.password) {
        throw new Error('Enter a public HTTP or HTTPS link without embedded credentials.');
      }
      value = parsed.href;
    } catch (error) {
      feedback.textContent = error instanceof Error ? error.message : 'Enter a complete HTTP or HTTPS link.';
      return;
    }
    submit.disabled = true; feedback.textContent = 'Submitting download…';
    try {
      // Use the same owner-scoped payload and ExApp submission path as the
      // working native Files dialog. A null folder retains the signed user's
      // own default, including first-use /Downloads creation.
      const files = await api<{app_password_configured:boolean}>('/settings');
      if (!files.app_password_configured) {
        throw new Error("Your Files aren't connected yet. Connect Files in Downloader settings, then retry.");
      }
      const created = await api<Job>('/jobs', 'POST', filesJobRequest(value, null));
      if (!created || !created.id) throw new Error('The download was not confirmed. Retry from Files.');
      field.value = '';
      feedback.textContent = 'Download queued. Follow its progress below.';
      window.dispatchEvent(new Event('downloader:job-queued'));
      await refresh();
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      feedback.textContent = /credentials unavailable|app password|reconnect files/i.test(reason)
        ? 'Your Files connection needs attention. Open Downloader settings, reconnect Files, and try again.'
        : /destination folder|cannot open destination/i.test(reason)
          ? 'Your download folder is unavailable. Choose a folder in Downloader settings and retry.'
          : /401|403|not authorized|unauthorized/i.test(reason)
            ? 'Downloader is not available for this account. Ask your Nextcloud administrator.'
            : reason || 'Could not start download. Try again from Files.';
    } finally { submit.disabled = false; }
  });
  element.replaceChildren(area);
  let active = true;
  let refreshing = false;
  async function runAction(job: Job, action: 'cancel'|'retry'|'redeliver') {
    try {
      await api('/jobs/' + encodeURIComponent(job.id) + '/' + action, 'POST');
      feedback.textContent = action === 'cancel' ? 'Download cancelled.' : 'Download queued.';
      await refresh();
    } catch (error) {
      feedback.textContent = error instanceof Error ? error.message : 'Could not update this download.';
    }
  }
  async function copySource(job: Job) {
    try {
      await navigator.clipboard.writeText(job.url);
      feedback.textContent = 'Source link copied.';
    } catch { feedback.textContent = 'Unable to copy source link in this browser.'; }
  }
  function showDetails(job: Job) {
    const dialog = elem('dialog');
    dialog.className = 'downloader-widget-dialog';
    const heading = elem('h2', downloadTitle(job));
    heading.id = 'downloader-widget-modal-heading';
    dialog.setAttribute('aria-labelledby', heading.id);
    const status = elem('p', downloadStatus(job));
    const source = elem('p', 'Source: ' + job.url);
    source.style.overflowWrap = 'anywhere';
    dialog.append(heading, status, source);
    if (job.error) dialog.append(elem('p', job.error));
    if (job.output_files?.length) {
      dialog.append(elem('h3', 'Delivered files'));
      for (const file of job.output_files) {
        dialog.append(elem('p', file.filename + ' · ' + downloadAmount(file.size_bytes) +
          (file.verified ? ' · Verified' : ' · Not verified')));
      }
    }
    const log = elem('details');
    log.append(elem('summary', 'Technical log (advanced)'), elem('pre', job.log_text || 'No log output yet.'));
    dialog.append(log);
    const actions = elem('div'); actions.className = 'job-modal-actions';
    const close = elem('button', 'Close'); close.type = 'button';
    close.addEventListener('click', () => dialog.close());
    actions.append(close); dialog.append(actions);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), {once: true});
    dialog.showModal();
  }
  function rowFor(job: Job) {
    const row = elem('article');
    row.className = 'job-row job-' + job.status;
    row.setAttribute('data-job-id', job.id);
    const icon = elem('span', downloadSymbol(job)); icon.className = 'job-card-icon';
    icon.setAttribute('aria-hidden', 'true');
    // A verified Nextcloud file ID is all that is needed for a signed-in
    // user's native preview. Do not use arbitrary remote thumbnail URLs.
    const verifiedFile = (job.output_files || []).find(file =>
      file.verified && file.file_id !== undefined
      && /^\d{1,32}$/.test(String(file.file_id)));
    if (verifiedFile) {
      const preview = elem('img');
      preview.alt = '';
      preview.loading = 'lazy';
      preview.width = 32;
      preview.height = 32;
      preview.src = host.OC!.generateUrl('/core/preview') + '?fileId='
        + encodeURIComponent(String(verifiedFile.file_id)) + '&x=96&y=96&a=true';
      preview.addEventListener('error', () => preview.remove(), {once: true});
      icon.append(preview);
    }

    const info = elem('div'); info.className = 'job-card-info';
    const title = elem('button', downloadTitle(job)); title.className = 'job-card-title';
    title.style.cssText = 'border:0;padding:0;background:transparent;color:inherit;text-align:start;cursor:pointer';
    title.title = downloadTitle(job);
    title.addEventListener('click', () => showDetails(job));
    const state = elem('span', downloadStatus(job)); state.className = 'job-card-state';
    state.title = downloadStatus(job);
    info.append(title, state);
    if (!TERMINAL.has(job.status)) {
      const progress = elem('progress'); progress.className = 'mini-progress';
      progress.max = 100;
      progress.value = Math.max(0, Math.min(100, Number(job.progress?.percent || 0)));
      progress.setAttribute('aria-label', 'Progress for ' + downloadTitle(job));
      info.append(progress);
    }
    const actions = elem('div'); actions.className = 'job-actions';
    const operation = job.status === 'completed' ? 'redeliver'
      : TERMINAL.has(job.status) ? 'retry' : 'cancel';
    const rerun = elem('button', operation === 'redeliver' ? '↻' : operation === 'retry' ? '⟳' : '×');
    rerun.type = 'button';
    rerun.title = operation === 'redeliver' ? 'Deliver again'
      : operation === 'retry' ? 'Try again' : 'Cancel download';
    rerun.setAttribute('aria-label', rerun.title);
    rerun.addEventListener('click', () => {void runAction(job, operation);});
    actions.append(rerun);
    const more = elem('details'); more.className = 'job-menu';
    const summary = elem('summary', '⋮');
    summary.title = 'More actions';
    summary.setAttribute('aria-label', 'More actions for ' + downloadTitle(job));
    const menu = elem('div'); menu.className = 'job-menu-items';
    function item(label: string, click: () => void) {
      const button = elem('button', label); button.type = 'button'; button.title = label;
      button.addEventListener('click', () => {more.open = false; click();});
      menu.append(button);
    }
    const query = deliveredFilesQuery(job);
    if (query) item('Open in Files', () => {
      window.location.href = host.OC!.generateUrl('/apps/files/files') + query;
    });
    item('View details', () => showDetails(job));
    item('Copy source link', () => {void copySource(job);});
    item('Remove from history', () => {void (async () => {
      try {
        await api('/jobs/' + encodeURIComponent(job.id) + '/hide', 'POST');
        feedback.textContent = 'Removed from your history. Files remain untouched.';
        await refresh();
      } catch (error) {feedback.textContent = error instanceof Error ? error.message : 'Could not remove history entry.';}
    })();});
    more.append(summary, menu); actions.append(more);
    row.append(icon, info, actions);
    return row;
  }

  async function refresh() {
    if (!active || !element.isConnected || refreshing) return;
    refreshing = true;
    try {
      const jobs = await api<Job[]>('/jobs?limit=50');
      // A refresh must update data without changing what the reader opened.
      // Capture the live DOM immediately before replacement, so even scroll
      // changes during an in-flight request are retained.
      const scroll = list.scrollTop;
      const menus = new Set([...list.querySelectorAll<HTMLElement>('.job-row')]
        .filter(row => row.querySelector<HTMLDetailsElement>('.job-menu')?.open)
        .map(row => row.dataset.jobId || ''));
      const focused = document.activeElement?.closest<HTMLElement>('.job-row');
      const focusId = focused?.dataset.jobId;
      const focusMenu = focused?.querySelector<HTMLDetailsElement>('.job-menu')?.contains(document.activeElement) ?? false;
      list.replaceChildren(...(jobs.length ? jobs.map(rowFor) : [elem('p', 'No downloads yet.')]));
      for (const row of list.querySelectorAll<HTMLElement>('.job-row')) {
        if (menus.has(row.dataset.jobId || '')) {
          const menu = row.querySelector<HTMLDetailsElement>('.job-menu');
          if (menu) menu.open = true;
        }
      }
      list.scrollTop = scroll;
      // Restore keyboard interaction to the same menu when it still exists.
      if (focusId && focusMenu) {
        for (const row of list.querySelectorAll<HTMLElement>('.job-row')) {
          if (row.dataset.jobId === focusId) {
            row.querySelector<HTMLElement>('.job-menu summary')?.focus({preventScroll: true});
            break;
          }
        }
      }
    } catch {
      list.replaceChildren(elem('p', 'Downloader is temporarily unavailable.'));
    } finally {
      refreshing = false;
    }
  }
  window.addEventListener('downloader:job-queued', () => {void refresh();});
  window.addEventListener('downloader:jobs-updated', () => {void refresh();});
  void refresh();
  const timer = window.setInterval(() => {
    if (!active || !element.isConnected) {
      active = false;
      window.clearInterval(timer);
      return;
    }
    void refresh();
  }, 5000);
}

function register() {
  host.OCA?.Dashboard?.register('downloader_bridge', renderDashboard);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', register, {once: true});
} else {
  register();
}
