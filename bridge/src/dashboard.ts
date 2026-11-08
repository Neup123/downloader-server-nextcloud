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
.downloader-dashboard-content .job-list{display:grid;gap:12px;margin-top:12px}
.downloader-dashboard-content .job-card{background:var(--color-main-background,#fff);color:var(--color-main-text,#222);
  border:1px solid var(--color-border,#aaa);border-radius:13px;padding:16px;min-width:0}
.downloader-dashboard-content .job-card-head{display:flex;gap:13px;align-items:flex-start}
.downloader-dashboard-content .job-card-icon{width:38px;height:38px;flex:0 0 38px;display:grid;place-items:center;
  border-radius:10px;background:var(--color-background-dark,#eee);font-size:20px}
.downloader-dashboard-content .job-card-info{flex:1;min-width:0}
.downloader-dashboard-content .job-card-title{font-size:15px;font-weight:600;overflow-wrap:anywhere}
.downloader-dashboard-content .job-card-state{font-size:13px;line-height:1.5;margin-top:3px;overflow-wrap:anywhere}
.downloader-dashboard-content .job-card-meta{color:var(--color-text-maxcontrast,#666);font-size:12px;margin-top:5px}
.downloader-dashboard-content .progress-track{height:6px;margin-top:13px;background:var(--color-background-dark,#ddd);border-radius:10px;overflow:hidden}
.downloader-dashboard-content .progress-fill{height:100%;background:var(--color-primary,#377bd1);border-radius:10px}
.downloader-dashboard-content .job-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;align-items:center}
.downloader-dashboard-content .job-actions :is(button,a){display:inline-flex;align-items:center;min-height:44px;padding:7px 10px}
.downloader-dashboard-content .job-card-details{border-top:1px solid var(--color-border,#aaa);margin-top:13px;padding-top:13px;font-size:13px}
.downloader-dashboard-content .job-card-details .output-row{display:flex;gap:12px;flex-wrap:wrap;margin:7px 0}
.downloader-dashboard-content .job-card-details details{margin-top:10px}
.downloader-dashboard-content .job-card-details pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:200px;overflow:auto}
.downloader-dashboard-content :is(button,a,summary):focus-visible{outline:3px solid var(--color-primary,#377bd1);outline-offset:2px}
@media(max-width:480px){.downloader-dashboard-content .job-card{padding:12px}.downloader-dashboard-content .job-actions :is(button,a){flex:1 1 auto}}
`;

function renderDashboard(element: HTMLElement) {
  const area = elem('section');
  area.className = 'downloader-dashboard-content';
  // CSS is scoped to the widget instead of mutating Nextcloud global styles.
  const cardStyle = elem('style');
  cardStyle.textContent = CARD_STYLE;
  area.append(cardStyle);
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
        // Identical semantics and class structure to the Core Download/Library
        // JobCard; native Nextcloud styling preserves its theme.
        const row = elem('article');
        row.className = 'job-card job-' + job.status;
        row.setAttribute('data-job-id', job.id);
        const head = elem('div'); head.className = 'job-card-head';
        const icon = elem('span', downloadSymbol(job)); icon.className = 'job-card-icon';
        icon.setAttribute('aria-hidden', 'true');
        const info = elem('div'); info.className = 'job-card-info';
        const title = elem('a', downloadTitle(job));
        title.className = 'job-card-title';
        title.href = host.OC!.generateUrl('/apps/app_api/proxy/downloader-server-nextcloud/user/') +
          '?job=' + encodeURIComponent(job.id);
        title.setAttribute('aria-label', 'Details for ' + downloadTitle(job));
        const state = elem('div', downloadStatus(job)); state.className = 'job-card-state';
        const metadata = elem('div', job.engine || 'Automatic'); metadata.className = 'job-card-meta';
        if (!TERMINAL.has(job.status) && job.progress?.downloaded_bytes !== undefined) {
          metadata.append(elem('span', ' · ' + downloadAmount(job.progress.downloaded_bytes) + ' downloaded'));
        }
        info.append(title, state, metadata);
        head.append(icon, info); row.append(head);

        if (!TERMINAL.has(job.status)) {
          const track = elem('div'); track.className = 'progress-track';
          track.setAttribute('role', 'progressbar');
          track.setAttribute('aria-label', 'Download progress for ' + downloadTitle(job));
          const percent = Number(job.progress?.percent);
          if (Number.isFinite(percent)) {
            track.setAttribute('aria-valuenow', String(Math.max(0, Math.min(100, percent))));
          }
          track.setAttribute('aria-valuemin', '0');
          track.setAttribute('aria-valuemax', '100');
          const fill = elem('div'); fill.className = 'progress-fill';
          fill.style.width = String(Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0) + '%';
          track.append(fill); row.append(track);
        }
        const actions = elem('div'); actions.className = 'job-actions';
        const query = deliveredFilesQuery(job);
        if (query) {
          const files = elem('a', 'Open in Files');
          files.className = 'job-card-file-link';
          files.href = host.OC!.generateUrl('/apps/files/files') + query;
          files.target = '_blank'; files.rel = 'noopener noreferrer';
          actions.append(files);
        }
        const operation = job.status === 'completed' ? 'redeliver'
          : TERMINAL.has(job.status) ? 'retry' : 'cancel';
        const action = elem('button', operation === 'retry' ? 'Try again'
          : operation === 'redeliver' ? 'Re-deliver' : 'Cancel');
        action.type = 'button';
        action.addEventListener('click', async () => {
          action.disabled = true;
          try {
            await api('/jobs/' + encodeURIComponent(job.id) + '/' + operation, 'POST');
            await refresh();
          } catch (error) {
            action.disabled = false;
            feedback.textContent = error instanceof Error ? error.message : 'Download action failed.';
          }
        });
        actions.append(action);
        const detailsToggle = elem('button', 'Details');
        detailsToggle.type = 'button';
        detailsToggle.setAttribute('aria-expanded', 'false');
        const details = elem('div'); details.className = 'job-card-details'; details.hidden = true;
        if (job.output_files?.length) {
          details.append(elem('strong', 'Delivered files'));
          for (const file of job.output_files) {
            const item = elem('div'); item.className = 'output-row';
            item.append(elem('span', file.filename),
              elem('span', downloadAmount(file.size_bytes)),
              elem('span', file.verified ? '✓ Verified' : 'Not verified'));
            details.append(item);
          }
        }
        if (job.error) details.append(elem('p', job.error));
        const log = elem('details');
        const label = elem('summary', 'Technical log (advanced)');
        const raw = elem('pre', job.log_text || 'No log output yet.');
        log.append(label, raw); details.append(log);
        detailsToggle.addEventListener('click', () => {
          details.hidden = !details.hidden;
          detailsToggle.textContent = details.hidden ? 'Details' : 'Hide details';
          detailsToggle.setAttribute('aria-expanded', String(!details.hidden));
        });
        actions.append(detailsToggle);
        row.append(actions, details);
        list.append(row);
      }
    } catch {
      // PHP entitlement additionally hides this widget before it is rendered.
      list.replaceChildren(elem('p', 'Downloader is unavailable.'));
      active = false;
    }
  }
  window.addEventListener('downloader:job-queued', () => { void refresh(); });
  window.addEventListener('downloader:jobs-updated', () => { void refresh(); });
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
