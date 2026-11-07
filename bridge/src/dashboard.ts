/** Native Nextcloud Dashboard widget; fetches only current signed-in user's jobs. */
import { downloadTitle, downloadStatus, deliveredFilesQuery } from './download-labels.mjs';
type Oc = {generateUrl: (path: string) => string; requestToken?: string};
type Job = {
  id: string; url: string; status: string; created_at: string;
  owner_id?: string; engine?: string;
  progress?: {percent?: number}; error?: string | null;
  output_files?: {filename:string;path?:string;verified?:boolean;file_id?:string|number}[];
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
function renderDashboard(element: HTMLElement) {
  const area = elem('section');
  area.className = 'downloader-dashboard-content';
  const history = elem('a', 'Open downloads history');
  history.href = host.OC!.generateUrl('/apps/app_api/proxy/downloader-server-nextcloud/user/');
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
      // Deliberately no folder property: signed ExApp default Files setting
      // controls destination and may auto-create /Downloads on first use.
      await api('/jobs', 'POST', {url: value, engine: 'auto'});
      field.value = '';
      feedback.textContent = 'Download started. Follow its progress below.';
      await refresh();
    } catch (error) {
      feedback.textContent = error instanceof Error ? error.message : 'Could not start download.';
    } finally { submit.disabled = false; }
  });
  element.replaceChildren(area);
  let active = true;
  async function refresh() {
    if (!active || !element.isConnected) return;
    try {
      const jobs = await api<Job[]>('/jobs?limit=3');
      list.replaceChildren();
      if (!jobs.length) {
        list.append(elem('p', 'No downloads yet.'));
        return;
      }
      for (const job of jobs.slice(0, 3)) {
        const row = elem('article');
        row.className = 'downloader-dashboard-job';
        row.style.cssText = 'padding:10px 0;border-bottom:1px solid var(--color-border,#ddd);display:grid;gap:6px';
        const title = elem('a', downloadTitle(job));
        title.href = host.OC!.generateUrl('/apps/app_api/proxy/downloader-server-nextcloud/user/') +
          '?job=' + encodeURIComponent(job.id);
        title.style.cssText = 'font-size:14px;font-weight:600;overflow-wrap:anywhere';
        const status = elem('div', downloadStatus(job));
        status.style.cssText = 'font-size:12px;color:var(--color-text-maxcontrast,#777)';
        row.append(title, status);
        if (!TERMINAL.has(job.status)) {
          const progress = elem('progress');
          progress.max = 100;
          progress.value = Math.min(100, Math.max(0, Number(job.progress?.percent ?? 0)));
          progress.style.width = '100%';
          progress.setAttribute('aria-label', 'Progress: ' + downloadTitle(job));
          row.append(progress);
        }
        if (job.status === 'failed' && job.error) {
          const error = elem('p', job.error);
          error.style.color = 'var(--color-error,#c33)';
          row.append(error);
        }
        const actions = elem('div');
        actions.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
        const query = deliveredFilesQuery(job);
        if (query) {
          const files = elem('a', 'Open in Files');
          files.href = host.OC!.generateUrl('/apps/files/files') + query;
          files.target = '_blank'; files.rel = 'noopener noreferrer';
          actions.append(files);
        }
        const operation = job.status === 'completed' ? 'redeliver' : TERMINAL.has(job.status) ? 'retry' : 'cancel';
        const action = elem('button', operation === 'retry' ? 'Try again'
          : operation === 'redeliver' ? 'Re-deliver' : 'Cancel');
        action.type = 'button';
        action.style.cssText = 'margin:4px 0;padding:7px 10px;min-height:44px;cursor:pointer';
        action.addEventListener('click', async () => {
          action.disabled = true;
          try {
            await api('/jobs/' + encodeURIComponent(job.id) + '/' + operation, 'POST');
            await refresh();
          } catch {
            action.disabled = false;
          }
        });
        actions.append(action);
        row.append(actions);
        list.append(row);
      }
    } catch {
      // PHP entitlement additionally hides this widget before it is rendered.
      list.replaceChildren(elem('p', 'Downloader is unavailable.'));
      active = false;
    }
  }
  void refresh();
  const timer = window.setInterval(() => {
    if (!active || !element.isConnected) {
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
