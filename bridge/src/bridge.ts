/**
 * Nextcloud-native UI adapter. All execution, secrets and WebDAV delivery
 * remain in the standalone core and authenticated ExApp. No server API token.
 */
import { registerFileAction, addNewFileMenuEntry, registerSidebarTab } from '@nextcloud/files';
import { getClient, getDefaultPropfind, getRootPath, resultToNode } from '@nextcloud/files/dav';
import { emit } from '@nextcloud/event-bus';
import { suggestTalkSource } from './talk-links.mjs';
import { showLinkDialog } from './link-first-dialog.mjs';
import { ownDeliveredFilePaths } from './files-live.mjs';
import { downloadTitle, downloadBubbleStatus, deliveredFilesQuery, downloadSymbol } from './download-labels.mjs';

type Job = {
  id: string; url: string; status: string; owner_id?: string; engine?: string;
  progress?: {percent?: number; speed_bytes_per_second?: number}; error?: string | null;
  pause_capability?: {can_pause?:boolean;can_resume?:boolean;reason?:string|null};
  finished_at?:string;completed_at?:string;updated_at?:string;created_at?:string;
  output_files?: {filename: string; path?: string; verified?: boolean; skipped?: boolean; file_id?: string | number}[];
};
type Oc = {generateUrl: (path: string) => string; requestToken?: string;
  Notification?: {showTemporary?: (message: string) => void}};
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0-5-5m5 5 5-5M4 17v3h16v-3"/></svg>';
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
function contentTypeFromMime(mime: string): 'video'|'audio'|'images'|'direct' {
  if(mime.startsWith('video/')) return 'video';
  if(mime.startsWith('audio/')) return 'audio';
  if(mime.startsWith('image/')) return 'images';
  return 'direct';
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
  // One Nextcloud-native dialog shared by Files, Viewer, Talk and the bubble.
  showLinkDialog({folder, suggested, api, notify,
    queued: (job?: {id?: string}) => window.dispatchEvent(
      new CustomEvent('downloader:job-queued', {detail: {id: job?.id}}))});
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
          await api('/jobs', 'POST', {
            url: original, content_type: contentTypeFromMime(context.nodes[0].mime),
          });
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
      fileInfo?: {download_source_url?: string; mime?: string; mimetype?: string};
    }}}).OCA?.Viewer?.fileInfo;
    const source = current?.download_source_url;
    if (source && sourceIsHttp(source)) {
      void api('/jobs', 'POST', {
        url: source, content_type: contentTypeFromMime(current?.mimetype||current?.mime||''),
      }).then(
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
      // quality/audio confirmation dialog as the native Files actions.
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
  // Nextcloud 35 uses .header-end. Keep the legacy selector as a fallback.
  const header = document.querySelector('#header .header-end')
    ?? document.querySelector('header .header-end')
    ?? document.querySelector('.header-end')
    ?? document.querySelector('#header-right');
  if (!header || document.getElementById('downloader-topbar-progress')) return;

  // Reserve a fixed-size icon slot to avoid moving neighbouring header icons.
  // When the default active-only preference is idle, the slot is visually empty.
  const container = node('div', '', 'dl-header');
  container.id = 'downloader-topbar-progress';
  const button = node('button', '', 'dl-trigger');
  button.type = 'button';
  button.setAttribute('aria-label', 'Downloads');
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 44 44');
  svg.setAttribute('width', '44');
  svg.setAttribute('height', '44');
  svg.classList.add('dl-indicator-svg');
  const arrow = document.createElementNS(ns, 'path');
  arrow.setAttribute('d', 'M22 13.5v12m0 0-5-5m5 5 5-5M14 27.5v3h16v-3');
  arrow.classList.add('dl-arrow');
  const frame = document.createElementNS(ns, 'path');
  // Start at bottom-centre and sweep around the rounded square clockwise.
  const square = 'M22 39 H14 Q5 39 5 30 V14 Q5 5 14 5 H30 Q39 5 39 14 V30 Q39 39 30 39 H22';
  frame.setAttribute('d',square);
  frame.classList.add('dl-frame-progress');
  const length = 134;
  frame.style.strokeDasharray = String(length);
  frame.style.strokeDashoffset = String(length);
  svg.append(frame,arrow);
  const badge = node('span','', 'dl-count');
  badge.hidden = true;
  button.append(svg,badge);
  const panel = node('section', '', 'dl-popover');
  panel.hidden = true;
  panel.id = 'downloader-header-popover';
  panel.setAttribute('aria-label', 'My downloads');
  button.setAttribute('aria-controls', panel.id);
  const panelHeader = node('div', '', 'dl-popover-head');
  const title = node('h3', 'My downloads');
  const add = node('button', '+', 'dl-popover-add');
  add.type = 'button';
  add.title = 'Add download';
  add.setAttribute('aria-label', 'Add a download');
  add.addEventListener('click', () => { panel.hidden = true; button.setAttribute('aria-expanded','false'); void openDialog(null); });
  panelHeader.append(title,add);
  const list = node('div', '', 'dl-popover-list');
  const fullLink = node('a', 'Open history', 'dl-link dl-history-link');
  fullLink.href = oc()!.generateUrl('/apps/downloader_bridge/library');
  panel.append(panelHeader,list,fullLink);
  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-expanded', String(!panel.hidden));
  });
  document.addEventListener('pointerdown', event => {
    if(!panel.hidden && !container.contains(event.target as Node)){
      panel.hidden = true; button.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', event => {
    if(event.key === 'Escape' && !panel.hidden){
      panel.hidden = true;button.setAttribute('aria-expanded','false');button.focus();
    }
  });
  container.append(button,panel);
  // Position in the native icon cluster, immediately BEFORE the bell rather
  // than appending at the far (trailing) end of the header.
  const bell=header.querySelector<HTMLElement>(
    '#notifications, [id^="notifications"], [data-id="notifications"], .notifications, [aria-label*="Notifications"]');
  const bellSlot=bell?.closest<HTMLElement>('.header-menu') || bell;
  if(bellSlot?.parentElement && header.contains(bellSlot)){
    bellSlot.parentElement.insertBefore(container,bellSlot);
  }else{
    // The bell may not be installed by this Nextcloud configuration; keep
    // our slot in the icon cluster's leading edge, never at the far end.
    header.insertBefore(container,header.firstChild);
  }

  let active = true;
  let refreshing = false;
  let initialized = false;
  const lastStatuses = new Map<string, string>();
  const justQueued = new Set<string>();
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


  type DisplayPrefs={header_indicator_visibility?:'active'|'always';dropdown_content?:'active'|'all'};
  let displayPrefs:DisplayPrefs={header_indicator_visibility:'active',dropdown_content:'active'};
  let lastPreferences=0;
  const jobProgress=(job:Job)=>{
    const raw=Number(job.progress?.percent??0);
    const percent=Number.isFinite(raw)?Math.max(0,Math.min(100,raw)):0;
    switch(job.status){
      case 'queued':return 0;
      case 'starting':return 3;
      case 'extracting':return 8;
      case 'downloading':return 8+percent*.74;
      case 'post-processing':return 82+percent*.1;
      case 'delivering':return 92+percent*.08;
      default:return percent;
    }
  };
  // The progress ring is aggregate stage work, never a numeric header label.
  function updateIndicator(running:Job[]){
    const show = running.length>0 || displayPrefs.header_indicator_visibility==='always';
    button.hidden=!show;
    const total = running.length
      ? running.reduce((sum,job)=>sum+jobProgress(job),0)/running.length : 0;
    const bounded=Math.max(0,Math.min(100,total));
    const activeRing=running.length>0;
    frame.style.strokeDashoffset=String(length*(1-bounded/100));
    frame.style.display=activeRing?'':'none';
    badge.hidden=!running.length;
    badge.textContent=String(running.length);
    button.setAttribute('aria-label',running.length
      ? 'Downloads: '+running.length+' unfinished' : 'My downloads');
    // If a user hides the indicator while the panel is open, close it too.
    if(!show){panel.hidden=true;button.setAttribute('aria-expanded','false');}
  }
  const finishTimestamp=(job:Job)=>{
    const value=job.finished_at||job.completed_at||job.updated_at||job.created_at||'';
    const parsed=Date.parse(value);
    return Number.isFinite(parsed)?parsed:0;
  };
  function renderRow(job:Job){
    const row=node('article','','dl-job');
    row.dataset.jobId=job.id;
    const percent=Math.max(0,Math.min(100,Number(job.progress?.percent||0)));
    const safePercent=Number.isFinite(percent)?Math.round(percent):0;
    row.style.setProperty('--dl-row-fill', (TERMINAL.has(job.status)?100:safePercent)+'%');
    const thumbnail=node('span',downloadSymbol(job),'dl-thumbnail');
    thumbnail.setAttribute('aria-hidden','true');
    const file=(job.output_files||[]).find(file=>file.verified && file.file_id!==undefined
      && /^\d{1,32}$/.test(String(file.file_id)));
    if(file){
      const image=node('img');
      image.alt='';image.loading='lazy';image.width=24;image.height=24;
      image.src=oc()!.generateUrl('/core/preview')+'?fileId='
        +encodeURIComponent(String(file.file_id))+'&x=96&y=96&a=true';
      image.addEventListener('error',()=>image.remove(),{once:true});
      thumbnail.append(image);
    }
    const info=node('div','','dl-job-info');
    const name=node('a',downloadTitle(job),'dl-job-title');
    name.href=oc()!.generateUrl('/apps/downloader_bridge/library')
      +'?job='+encodeURIComponent(job.id);
    name.dir='auto';
    const subtitle=node('span',downloadBubbleStatus(job),'dl-job-state');
    subtitle.dir='auto';
    info.append(name,subtitle);
    const pct=node('span',TERMINAL.has(job.status)?'':safePercent+'%','dl-job-pct');
    if(TERMINAL.has(job.status)){
      pct.textContent=job.status==='completed'?'✓':'—';
    }
    const action=node('button',TERMINAL.has(job.status)?'↻':job.status==='paused'?'▶':'Ⅱ','dl-job-pause');
    action.type='button';
    if(TERMINAL.has(job.status)){
      const operation=job.status==='completed'?'redeliver':'retry';
      action.title=operation==='redeliver'?'Deliver again':'Retry download';
      action.setAttribute('aria-label',action.title);
      action.addEventListener('click',()=>{
        action.disabled=true;
        void api('/jobs/'+encodeURIComponent(job.id)+'/'+operation,'POST')
          .then(()=>{window.dispatchEvent(new Event('downloader:job-queued'));})
          .catch(error=>{notify(error instanceof Error?error.message:'Download action failed');})
          .finally(()=>{action.disabled=false;});
      });
    }else{
      const resume=job.status==='paused';
      const operation=resume?'resume':'pause';
      const supported=resume?job.pause_capability?.can_resume:job.pause_capability?.can_pause;
      action.title=supported?(resume?'Resume this download':'Pause this download')
        :(job.pause_capability?.reason || 'Pause capability is unavailable for this job');
      action.setAttribute('aria-label',action.title);
      if(!supported){
        action.disabled=true;
      }else{
        action.addEventListener('click',()=>{
          action.disabled=true;
          void api('/jobs/'+encodeURIComponent(job.id)+'/'+operation,'POST')
            .then(()=>{
              window.dispatchEvent(new Event('downloader:jobs-updated'));
              void refresh();
            })
            .catch(error=>{notify(error instanceof Error?error.message:'Unable to '+operation+' this download');})
            .finally(()=>{action.disabled=false;});
        });
      }
    }
    row.append(thumbnail,info,pct,action);
    return row;
  }
  async function refresh() {
    if (!active || !container.isConnected || refreshing) return;
    refreshing = true;
    try {
      const now=Date.now();
      if(now-lastPreferences>20000){
        const saved=await api<DisplayPrefs>('/settings').catch(()=>displayPrefs);
        displayPrefs={
          header_indicator_visibility:saved.header_indicator_visibility==='always'?'always':'active',
          dropdown_content:saved.dropdown_content==='all'?'all':'active',
        };
        lastPreferences=now;
      }
      const running=await api<Job[]>('/jobs?limit=200&state=active');
      // Keep polling terminal transitions even when the visible list is active-only.
      // Delivery refresh and notifications must not disappear with finished rows.
      const jobs=await api<Job[]>('/jobs?limit=200');
      updateIndicator(running);
      let displayed=[...running];
      if(displayPrefs.dropdown_content==='all'){
        const known=new Set(displayed.map(job=>job.id));
        const finished=jobs.filter(job=>TERMINAL.has(job.status)&&!known.has(job.id))
          .sort((a,b)=>finishTimestamp(b)-finishTimestamp(a));
        displayed=[...displayed,...finished];
      }
      // Preserve the browser's scroll when jobs are updated while open.
      const scroll=list.scrollTop;
      list.replaceChildren(...(displayed.length
        ?displayed.slice(0,75).map(renderRow)
        :[node('p','No active downloads.','dl-empty')]));
      list.scrollTop=scroll;
      for(const job of jobs){
        const old=lastStatuses.get(job.id);
        // A short download can finish before the first poll after submission.
        // An explicit queued job ID still gets its one skip/completion toast.
        if(((initialized && old && old!==job.status) || justQueued.has(job.id))
          && TERMINAL.has(job.status)){
          const skipped=job.output_files?.some(file=>file.skipped===true);
          notify(job.status==='completed'
            ?(skipped
              ?'Download skipped: a file already exists in Nextcloud Files. The existing file was kept.'
              :'Download complete. Open it in Nextcloud Files.')
            :job.status==='failed'?'Download failed. Open Downloads for details.'
             :'Download cancelled.');
          window.dispatchEvent(new Event('downloader:jobs-updated'));
        }
        lastStatuses.set(job.id,job.status);
        if(old || TERMINAL.has(job.status))justQueued.delete(job.id);
        if(job.status==='completed')void publishDeliveredFiles(job);
      }
      initialized=true;
    }catch {
      button.title='Unable to refresh downloads. Retrying automatically.';
    }finally{
      refreshing=false;
    }
  }
  window.addEventListener('downloader:job-queued', event => {
    const id=(event as CustomEvent<{id?: string}>).detail?.id;
    if(typeof id==='string' && id)justQueued.add(id);
    void refresh();
  });
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
    'box-sizing:border-box;width:min(700px,calc(100vw - 32px));max-width:calc(100vw - 32px);',
    'max-height:calc(100dvh - 32px);overflow-y:auto;padding:24px;',
    'color:var(--color-main-text,#222);background:var(--color-main-background,#fff);',
    'border:1px solid var(--color-border,#bbb);border-radius:var(--border-radius-large,12px);',
    'box-shadow:0 16px 48px #0004;z-index:11000}',
    '.dl-dialog::backdrop{background:#0008}',
    '.dl-dialog form{display:grid;gap:16px}.dl-dialog h2{margin:0;font-size:19px}',
    '.dl-media-row{display:flex;align-items:center;gap:10px;flex-wrap:nowrap}',
    '.dl-media-row .dl-audio-toggle{display:flex;align-items:center;gap:6px;white-space:nowrap;',
    'cursor:pointer;font-size:13px;font-weight:600;flex:0 0 auto}',
    '.dl-media-row .dl-audio-toggle input{width:18px;height:18px;margin:0}',
    '.dl-media-row select.dl-input{flex:0 1 auto;width:max-content;max-width:100%}',
    '.dl-link-dialog .dl-media-row{width:max-content;max-width:100%;flex-wrap:wrap}',
    '.dl-options{border-top:1px solid var(--color-border,#ddd);padding-top:12px}',
    '.dl-options summary{cursor:pointer;font-weight:600;list-style-position:inside}',
    '.dl-options[open]{display:grid;gap:10px}.dl-options[open] summary{margin-bottom:6px}',
    '.dl-advanced-filters{display:grid;gap:10px;box-sizing:border-box;',
    'min-width:0;max-width:100%;margin:8px 0 0;padding:10px 12px 12px;',
    'border:1px solid var(--color-border,#ddd);border-radius:var(--border-radius,6px)}',
    '.dl-advanced-filters legend{padding:0 6px;margin-inline-start:4px;font-size:12px;font-weight:600}',
    '.dl-toast{position:fixed;z-index:12000;top:70px;right:16px;',
    'padding:12px 18px;border-radius:var(--border-radius-large,12px);',
    'background:var(--color-main-background,#fff);color:var(--color-main-text,#222);',
    'border:1px solid var(--color-border,#ddd);box-shadow:0 8px 24px #0003}',
    '.dl-label{display:grid;gap:6px;font-size:13px}.dl-input{padding:8px;width:100%;',
    'color:var(--color-main-text,#222);background:var(--color-main-background,#fff);',
    'border:1px solid var(--color-border,#ccc);border-radius:6px}',
    '.dl-link-dialog .dl-label{width:max-content;max-width:100%;justify-self:start}',
    '.dl-link-dialog select.dl-input{width:max-content;field-sizing:content;max-width:100%;',
    'min-width:0;justify-self:start}',
    '.dl-link-dialog .dl-options{width:max-content;max-width:100%;justify-self:start}',
    '.dl-link-dialog .dl-options[open]{justify-items:start}',
    '.dl-link-dialog .dl-options input:not([type=checkbox]){width:max-content;',
    'field-sizing:content;max-width:100%;min-width:0}',
    '.dl-link-dialog .dl-options .dl-audio-toggle{width:max-content;max-width:100%;justify-self:start}',
    '.dl-link-dialog .dl-picker-controls{width:max-content;max-width:100%}',
    '.dl-buttons{display:flex;justify-content:flex-end;gap:8px}',
    '.dl-buttons button,.dl-trigger,.dl-small{cursor:pointer;padding:7px 10px;',
    'color:var(--color-main-text,#222);background:var(--color-main-background,#fff);',
    'border:1px solid var(--color-border,#ddd);border-radius:6px}',
    '.dl-primary{background:var(--color-primary,#3a7dde)!important;color:#fff!important}',
    '.dl-muted{font-size:12px;color:var(--color-text-maxcontrast,#777)}',

    '.dl-link-line{display:flex;align-items:center;gap:10px}',
    '.dl-link-line input{flex:1;min-width:0}',
    '.dl-detect-spinner{width:16px;height:16px;border:2px solid var(--color-border,#ccc);',
    'border-top-color:var(--color-primary,#377bd1);border-radius:50%;animation:dl-spin .7s linear infinite}',
    '.dl-detect-spinner[hidden],.dl-detected[hidden],.dl-buttons[hidden]{display:none!important}',
    '@keyframes dl-spin{to{transform:rotate(360deg)}}',
    '.dl-detect-status{min-height:0;margin:0}.dl-detected{display:grid;gap:10px}',
    '.dl-link-dialog .dl-detected{justify-items:start}',
    '.dl-link-dialog .dl-picker{width:100%;max-width:100%;min-width:0;justify-self:stretch}',
    '.dl-detected h3{font-size:15px;margin:0}.dl-detected p{margin:0}',
    '.dl-playlist-list{display:grid;gap:5px;max-height:390px;overflow-y:auto}',
    '.dl-playlist-item{display:grid;grid-template-columns:20px 60px 1fr;align-items:center;',
    'gap:10px;padding:4px;border-bottom:1px solid var(--color-border,#ddd);cursor:pointer}',
    '.dl-gallery-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;',
    'max-height:470px;overflow-y:auto;align-content:start}',
    '.dl-grid-item{position:relative;min-width:0;aspect-ratio:1/1;overflow:hidden;',
    'border:1px solid var(--color-border,#ccc);border-radius:5px;cursor:pointer}',
    '.dl-grid-item>input{position:absolute;top:6px;left:6px;z-index:2;',
    'width:18px;height:18px;accent-color:var(--color-primary,#377bd1)}',
    '.dl-entry-media{position:relative;display:grid;place-items:center;min-width:0;min-height:60px;',
    'width:100%;height:100%;background:var(--color-background-dark,#444);color:var(--color-main-text,#eee)}',
    '.dl-entry-media img{width:100%;height:100%;object-fit:cover}',
    '.dl-entry-placeholder{font-size:11px;text-align:center;opacity:.7}',
    '.dl-entry-caption{position:absolute;inset:auto 0 0 0;display:grid;gap:2px;',
    'background:linear-gradient(transparent,#000d);color:white;padding:22px 8px 7px;',
    'font-size:12px;font-weight:650;line-height:1.2;overflow-wrap:anywhere}',
    '.dl-entry-caption small{font-weight:400;font-size:10px}',
    '.dl-playlist-item .dl-entry-media{width:60px;height:48px}',
    '.dl-playlist-item .dl-entry-caption{position:static;background:none;color:inherit;padding:0}',
    '.dl-entry-details{display:grid;gap:2px;font-size:12px}',
    '.dl-load-sentinel{grid-column:1/-1;text-align:center;padding:8px;font-size:12px}',
    '.dl-live-badge{display:inline-block;margin-inline-start:7px;color:var(--color-primary,#377bd1);',
    'font-size:11px;font-weight:700;text-transform:uppercase}',
    '.dl-entry-live-badge{position:absolute;top:5px;right:5px;z-index:2;padding:2px 5px;',
    'border-radius:4px;background:#b91c1c;color:#fff;font-size:10px;font-weight:700}',
    '.dl-torrent-files{display:block;max-height:380px;overflow-y:auto;overflow-x:hidden}',
    '.dl-torrent-folder{box-sizing:border-box;max-width:100%;min-width:0}',
    '.dl-torrent-folder>summary{display:flex;align-items:center;gap:7px;cursor:pointer;',
    'list-style:none;font-size:12px;padding:4px 0;min-width:0}',
    '.dl-torrent-folder>summary::marker{content:""}',
    '.dl-torrent-folder>summary::-webkit-details-marker{display:none}',
    '.dl-torrent-expander{box-sizing:border-box;display:block;flex:0 0 9px;width:9px;height:9px;',
    'border-right:2px solid currentColor;border-bottom:2px solid currentColor;',
    'transform:rotate(-45deg);transition:transform .15s ease}',
    '.dl-torrent-folder[open]>summary .dl-torrent-expander{transform:rotate(45deg)}',
    '.dl-torrent-folder-name{min-width:0;overflow-wrap:anywhere}',
    '.dl-torrent-children{box-sizing:border-box;min-width:0;max-width:100%;',
    'margin-inline-start:8px;padding-inline-start:20px;',
    'border-inline-start:1px solid var(--color-border,#ccc)}',
    '.dl-torrent-file{display:flex;align-items:center;gap:8px;',
    'box-sizing:border-box;min-width:0;max-width:100%;padding:5px;font-size:12px;cursor:pointer}',
    '.dl-torrent-name{min-width:0;overflow-wrap:anywhere}',
    '.dl-picker-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
    '.dl-picker-controls .dl-audio-toggle{display:flex;align-items:center;gap:6px}',
    '.dl-options .dl-audio-toggle{display:flex;align-items:center;gap:6px}',
    '.dl-options .dl-subtitle-toggle input{width:18px;height:18px;margin:0}',
    '.dl-detected button:disabled{opacity:.5}',

    // Keep the action accessible while dialog content scrolls.
    '.dl-link-dialog[open]{display:flex;flex-direction:column;overflow:hidden;padding:16px}',
    '.dl-link-dialog.dl-torrent-dialog[open]{width:min(840px,calc(100vw - 32px))}',
    '.dl-link-dialog form{display:flex;flex-direction:column;gap:10px;',
    'min-height:0;max-height:calc(100dvh - 64px);width:100%}',
    '.dl-link-dialog .dl-detected{min-height:0;flex:0 1 auto;',
    'max-width:100%;overflow-y:auto;overscroll-behavior:contain;align-content:start}',
    '.dl-link-dialog .dl-buttons{position:sticky;bottom:0;z-index:1;',
    'flex:0 0 auto;padding:10px 0 0;',
    'border-top:1px solid var(--color-border,#ddd);',
    'background:var(--color-main-background,#fff)}',

    // Torrent controls are always visible; only the three-part funnel panel toggles.
    '.dl-link-dialog .dl-torrent-picker{display:grid;gap:10px;width:100%;justify-self:stretch;min-width:0}',
    '.dl-torrent-controls{display:flex;align-items:center;gap:10px;',
    'flex-wrap:wrap;width:100%;max-width:100%}',
    '.dl-torrent-control{display:inline-flex;align-items:center;gap:7px;',
    'min-width:0;font-size:13px}',
    '.dl-torrent-control-label{white-space:nowrap;font-weight:600}',
    '.dl-torrent-icon-button{display:grid;place-items:center;',
    'box-sizing:border-box;width:34px;height:34px;flex:0 0 34px;',
    'padding:0;border:1px solid var(--color-border,#ccc);',
    'border-radius:6px;color:inherit;background:transparent;',
    'appearance:none;cursor:pointer}',
    '.dl-torrent-icon{display:block;width:18px;height:18px;',
    'fill:none;stroke:currentColor;stroke-width:1.8;',
    'stroke-linecap:round;stroke-linejoin:round;pointer-events:none}',
    '.dl-torrent-icon-button:hover{background:var(--color-background-hover,#eee)}',
    '.dl-torrent-icon-button:focus-visible{outline:2px solid var(--color-primary,#377bd1);outline-offset:2px}',

    // Theme-aware segmented view toggle: a single dark indicator slides beneath the icons.
    '.dl-segmented-toggle{position:relative;display:grid;',
    'grid-template-columns:repeat(2,minmax(0,1fr));',
    'box-sizing:border-box;width:76px;height:38px;padding:2px;',
    'direction:ltr;border:1px solid var(--color-border,#ccc);',
    'border-radius:var(--border-radius-large,8px);',
    'background:var(--color-background-dark,#e9e9e9)}',
    '.dl-segmented-slider{position:absolute;inset:2px auto 2px 2px;',
    'width:calc(50% - 2px);border-radius:var(--border-radius,6px);',
    'background:var(--color-main-text,#222);',
    'box-shadow:0 1px 3px #0002;transition:transform .18s ease;pointer-events:none}',
    '.dl-segmented-toggle[data-view=flat] .dl-segmented-slider{transform:translateX(100%)}',
    '.dl-segmented-button{position:relative;z-index:1;',
    'width:100%;height:100%;min-width:0;padding:0;',
    'border:0;border-radius:var(--border-radius,6px);background:transparent;flex:none;',
    'transition:color .18s ease;color:var(--color-main-text,#222)}',
    '.dl-segmented-button[aria-pressed=true]{color:var(--color-main-background,#fff)}',
    '.dl-segmented-button:hover{background:transparent}',
    '@media (prefers-reduced-motion:reduce){',
    '.dl-segmented-slider,.dl-segmented-button{transition:none}}',

    '.dl-torrent-filter{max-width:100%;min-width:0}',
    '.dl-link-dialog .dl-torrent-filter input[type=search]{',
    'box-sizing:border-box;width:190px;field-sizing:fixed;',
    'max-width:min(230px,calc(100vw - 120px));padding:6px 8px}',
    '.dl-torrent-filter-panel{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));',
    'gap:10px;box-sizing:border-box;width:100%;min-width:0;',
    'padding:10px;border:1px solid var(--color-border,#ddd);',
    'border-radius:var(--border-radius-large,10px);background:var(--color-main-background,#fff)}',
    '.dl-torrent-filter-panel[hidden]{display:none!important}',
    '.dl-torrent-filter-panel fieldset{min-width:0;margin:0;padding:7px 9px 9px;',
    'border:1px solid var(--color-border,#ddd);border-radius:var(--border-radius,6px)}',
    '.dl-torrent-filter-panel legend{padding:0 4px;font-weight:600;font-size:12px}',
    '.dl-torrent-type-options{display:flex;align-items:center;gap:7px 11px;flex-wrap:wrap;',
    'max-height:130px;overflow-y:auto}',
    '.dl-torrent-type-option{display:inline-flex;align-items:center;gap:5px;font-size:12px;cursor:pointer}',
    '.dl-torrent-type-option input{margin:0;accent-color:var(--color-primary,#377bd1)}',
    '.dl-torrent-size-bounds{display:flex;gap:8px;flex-wrap:wrap}',
    '.dl-torrent-size-bounds .dl-label{flex:1 1 65px;min-width:0}',
    '.dl-torrent-size-bounds input{box-sizing:border-box;width:100%;min-width:0}',
    '.dl-torrent-path-filter input{box-sizing:border-box;width:100%;min-width:0}',

    // Both root and folder checkboxes derive their state from the filtered file set.
    '.dl-torrent-selection{display:flex;align-items:center;',
    'gap:8px 12px;flex-wrap:wrap;font-size:13px}',
    '.dl-torrent-root{display:inline-flex;align-items:center;',
    'gap:6px;white-space:nowrap;cursor:pointer;font-weight:600}',
    '.dl-torrent-file input,.dl-torrent-root input,',
    '.dl-torrent-folder>summary input{width:16px;height:16px;margin:0;',
    'flex:0 0 16px;accent-color:var(--color-primary,#377bd1);vertical-align:middle}',
    '.dl-torrent-selection .dl-picker-count{font-size:12px}',

    // Repeat the same 28px step at every folder level; wrap long names, never pan sideways.
    '.dl-link-dialog .dl-torrent-files{display:block;',
    'box-sizing:border-box;width:100%;max-width:100%;max-height:min(340px,42dvh);',
    'overflow-y:auto;overflow-x:hidden}',
    '.dl-link-dialog .dl-torrent-folder{width:100%;max-width:100%;padding:0}',
    '.dl-link-dialog .dl-torrent-folder>summary{font-size:12px;line-height:20px;padding:3px 0}',
    '.dl-link-dialog .dl-torrent-file{width:fit-content;max-width:100%;',
    'padding:3px 4px;line-height:20px;font-size:12px}',
    '.dl-link-dialog .dl-torrent-name{min-width:0;max-width:min(560px,calc(100vw - 180px));',
    'overflow-wrap:anywhere}',
    '.dl-link-dialog .dl-torrent-file small{flex:0 0 auto;white-space:nowrap}',
    '.dl-torrent-file:hover{background:var(--color-background-hover,#eee)}',

    // Native-header-sized ghost glyph: the arrow geometry itself remains unchanged.
    '.dl-header{position:relative;display:flex;flex:0 0 44px;width:44px;height:44px;align-items:center}',
    '.dl-trigger{display:grid;place-items:center;width:44px;height:44px;min-width:44px;',
    'padding:0!important;margin:0!important;background:transparent!important;',
    'color:var(--color-primary-text,#fff)!important;',
    'border:0!important;box-shadow:none!important;',
    'border-radius:var(--border-radius-large,12px)!important;position:relative;cursor:pointer}',
    '.dl-trigger[hidden]{display:none!important}',
    '.dl-trigger:is(:hover,:focus,:focus-visible){',
    'background:color-mix(in srgb,var(--color-primary-text,#fff) 10%,transparent)!important}',
    '.dl-trigger:is(:active,[aria-expanded=true]){',
    'background:color-mix(in srgb,var(--color-primary-text,#fff) 16%,transparent)!important;',
    'color:var(--color-primary-text,#fff)!important;box-shadow:none!important}',
    '.dl-trigger:focus-visible{outline:2px solid currentColor;outline-offset:-3px}',
    '.dl-indicator-svg{display:block;width:44px;height:44px;overflow:visible;fill:none;',
    'stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;opacity:.76}',
    '.dl-arrow{stroke-width:3}',
    '.dl-frame-progress{stroke-width:2.6;transition:stroke-dashoffset .5s ease}',
    '.dl-count{position:absolute;top:2px;right:2px;box-sizing:border-box;',
    'min-width:13px;height:13px;border-radius:9px;',
    'background:var(--color-primary-text,#fff);color:var(--color-primary,#2066ae);',
    'border:0;font-size:9px;font-weight:700;line-height:13px;text-align:center;padding:0 3px}',
    '.dl-count[hidden]{display:none}',
    // Match the avatar/user menu, not the translucent notifications panel.
    '.dl-popover{position:absolute;top:100%;inset-inline-end:0;z-index:10000;box-sizing:border-box;',
    'width:max-content;min-width:280px;max-width:min(380px,92vw);max-height:70vh;',
    'display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--color-border,#ddd);',
    'border-radius:var(--border-radius-large,12px);',
    'background:var(--color-main-background,#fff)!important;',
    'color:var(--color-main-text,#222)!important;',
    'opacity:1!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;',
    'box-shadow:var(--shadow-header,0 8px 30px #0003)}',
    '.dl-popover[hidden]{display:none!important}',
    '.dl-popover-head{display:flex;align-items:center;gap:8px;padding:10px 12px;',
    'border-bottom:1px solid var(--color-border,#ddd)}',
    '.dl-popover-head h3{font-size:14px;margin:0;flex:1;font-weight:600;color:inherit}',
    '.dl-popover-add{display:grid;place-items:center;box-sizing:border-box;',
    'width:28px;height:28px;min-width:28px;',
    'border:1px solid var(--color-border,#ddd)!important;',
    'background:transparent!important;border-radius:50%!important;',
    'padding:0!important;font-size:18px;line-height:1;color:inherit!important;cursor:pointer}',
    '.dl-popover-add:hover{background:var(--color-background-hover,#f1f1f1)!important}',
    '.dl-popover-add:active{background:var(--color-background-dark,#e7e7e7)!important}',
    '.dl-popover-list{overflow-y:auto;max-height:55vh;min-height:0}',
    '.dl-history-link{display:block;padding:11px 12px;font-size:12px;',
    'color:var(--color-main-text,#222)!important}',
    '.dl-history-link:hover{background:var(--color-background-hover,#f1f1f1)!important}',
    '.dl-empty{margin:0;padding:14px;font-size:12px;color:var(--color-text-maxcontrast,#666)}',
    '.dl-job{position:relative;display:grid;grid-template-columns:24px minmax(0,1fr) 32px 22px;',
    'align-items:center;gap:8px;min-height:38px;padding:7px 10px;',
    'border-bottom:1px solid var(--color-border,#ddd);isolation:isolate;font-size:12px;',
    'color:var(--color-main-text,#222)}',
    '.dl-job:hover{background:var(--color-background-hover,#f1f1f1)}',
    '.dl-job::before{content:"";position:absolute;inset:0 auto 0 0;width:var(--dl-row-fill,0%);',
    'background:var(--color-primary,#377bd1);opacity:.095;z-index:-1;pointer-events:none}',
    '.dl-thumbnail{width:24px;height:24px;display:grid;place-items:center;',
    'background:var(--color-background-dark,#eee);color:var(--color-main-text,#222);',
    'border-radius:5px;overflow:hidden;font-size:15px}',
    '.dl-thumbnail img{width:24px;height:24px;object-fit:cover}',
    '.dl-job-info{min-width:0;display:grid;gap:1px}',
    '.dl-job-title{font-weight:600;font-size:12px;line-height:1.1;overflow:hidden;',
    'text-overflow:ellipsis;white-space:nowrap;color:inherit!important}',
    '.dl-job-state{font-size:11px;line-height:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
    'color:var(--color-text-maxcontrast,#777)}',
    '.dl-job-pct{font-size:11px;text-align:end;font-variant-numeric:tabular-nums}',
    '.dl-job-pause{border:0!important;background:transparent!important;color:inherit!important;',
    'width:22px;height:24px;padding:0!important;font-size:16px;font-weight:700;cursor:pointer}',
    '.dl-job-pause:hover{background:var(--color-background-hover,#eee)!important}',
    '.dl-job-pause:disabled{opacity:.5;cursor:not-allowed}',
    '.dl-popover :is(a,button):focus-visible{outline:2px solid var(--color-primary,#377bd1);outline-offset:2px}',
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
