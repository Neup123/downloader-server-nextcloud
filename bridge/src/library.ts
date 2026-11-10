/** Native Nextcloud Library view; API always uses signed AppAPI identity. */
import { downloadTitle, downloadStatus, downloadStatusDetail, deliveredFilesQuery, downloadSymbol } from './download-labels.mjs';

type Job = {
  id:string;url:string;status:string;owner_id?:string;engine?:string;
  progress?:{percent?:number};error?:string|null;log_text?:string;
  output_files?:Array<{filename:string;path?:string;verified?:boolean;skipped?:boolean;file_id?:string|number}>;
};
type Page = {jobs: Job[]; next_offset: number|null};
type Oc = {generateUrl: (path:string)=>string;requestToken?:string;
  Notification?:{showTemporary?:(message:string)=>void}};
const oc = () => (window as unknown as {OC?: Oc}).OC;
const base = () => oc()!.generateUrl('/apps/app_api/proxy/downloader-server-nextcloud/user/api');
const el = <K extends keyof HTMLElementTagNameMap>(tag:K, value=''):HTMLElementTagNameMap[K] => {
  const result = document.createElement(tag);
  result.textContent = value;
  return result;
};
async function api<T>(url:string,method='GET',data?:unknown):Promise<T> {
  const res = await fetch(base()+url,{
    method,credentials:'same-origin',
    headers:{'OCS-APIRequest':'true',
      ...(oc()?.requestToken?{requesttoken:oc()!.requestToken!}:{}),
      ...(data===undefined?{}:{'Content-Type':'application/json'})},
    ...(data===undefined?{}:{body:JSON.stringify(data)}),
  });
  const body = await res.json().catch(()=>null);
  if(!res.ok){
    const error = body as {detail?:string}|null;
    throw new Error(error?.detail||'Downloader is unavailable. Retry in a moment.');
  }
  return body as T;
}
const STYLES = `
#downloader-library-app{max-width:1100px;margin:0 auto;padding:22px 22px 60px;color:var(--color-main-text,#222)}
#downloader-library-app h1{margin:0 0 6px;font-size:27px}
#downloader-library-app .library-help{color:var(--color-text-maxcontrast,#666);margin:0 0 22px}
#downloader-library-app .library-controls{display:flex;gap:12px;flex-wrap:wrap;align-items:end}
#downloader-library-app .library-controls label{display:grid;gap:6px;font-weight:600;flex:1 1 200px}
#downloader-library-app :is(input,select){width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--color-border,#bbb);border-radius:8px;background:var(--color-main-background,#fff);color:inherit;min-height:42px}
#downloader-library-app .library-actions{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}
#downloader-library-app button{cursor:pointer;color:inherit;border:1px solid var(--color-border,#bbb);border-radius:8px;background:var(--color-main-background,#fff);padding:9px 12px;min-height:40px}
#downloader-library-app .library-primary{background:var(--color-primary,#377bd1);color:var(--color-primary-text,#fff)}
#downloader-library-app .library-message{min-height:20px;font-size:13px;color:var(--color-text-maxcontrast,#666)}
#downloader-library-app .library-list{display:grid;border-top:1px solid var(--color-border,#ddd);max-width:100%;min-width:0}
#downloader-library-app .library-row{display:flex;gap:6px;align-items:center;min-width:0;border-bottom:1px solid var(--color-border,#ddd);padding:2px 0}
#downloader-library-app .library-icon{width:24px;height:24px;flex:0 0 24px;display:grid;place-items:center;background:var(--color-background-dark,#eee);border-radius:5px}
#downloader-library-app .library-row-main{min-width:0;flex:1;display:grid;gap:1px}
#downloader-library-app .library-title{width:100%;min-width:0;min-height:0;height:auto;line-height:1.1;font-size:12px;text-align:start;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:0;background:transparent;padding:0;font-weight:600}
#downloader-library-app .library-status{font-size:11px;line-height:1.1;color:var(--color-text-maxcontrast,#666);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#downloader-library-app .library-progress{width:100%;height:2px}
#downloader-library-app .library-row-actions{display:flex;align-items:center;gap:0;flex-shrink:0;margin-inline-end:0}
#downloader-library-app .library-overflow{position:relative;flex:0 0 20px}
#downloader-library-app .library-overflow summary{list-style:none;width:20px;height:24px;display:grid;place-items:center;font-size:21px;font-weight:800;line-height:1;border:0;border-radius:0;background:transparent;cursor:pointer}
#downloader-library-app .library-overflow summary::-webkit-details-marker{display:none}
#downloader-library-app .library-overflow summary:hover{color:var(--color-primary,#377bd1)}
#downloader-library-app .library-overflow-list{position:absolute;inset-inline-end:0;top:100%;z-index:30;width:max-content;min-width:160px;padding:4px;display:grid;gap:2px;background:var(--color-main-background,#fff);border:1px solid var(--color-border,#ddd);border-radius:8px;box-shadow:0 6px 18px #0003}
#downloader-library-app .library-overflow-list button{width:100%;min-height:30px;padding:5px 9px;border:0;background:transparent;text-align:start;font-size:12px}
#downloader-library-app .library-overflow-list button:hover{background:var(--color-background-hover,#eee)}
#downloader-library-app .library-row-actions .library-overflow-list button{min-width:0}
#downloader-library-app .library-empty{padding:32px 12px;color:var(--color-text-maxcontrast,#666)}
#downloader-library-app .library-more{margin-top:18px}
.downloader-library-modal[open]{position:fixed!important;inset:0!important;margin:auto!important;width:min(560px,calc(100vw - 30px));max-width:calc(100vw - 30px);max-height:calc(100dvh - 30px);padding:22px;overflow:auto;border:1px solid var(--color-border,#bbb);border-radius:14px;background:var(--color-main-background,#fff);color:var(--color-main-text,#222)}
.downloader-library-modal::backdrop{background:#0008}
.downloader-library-modal pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow-y:auto}
.downloader-library-modal .modal-actions{display:flex;justify-content:flex-end;gap:8px}
#downloader-library-app :is(button,a,summary):focus-visible,.downloader-library-modal :is(button,summary):focus-visible{outline:3px solid var(--color-primary,#377bd1);outline-offset:3px}
@media(max-width:520px){#downloader-library-app{padding:15px}#downloader-library-app .library-row{gap:6px}}
`;

function main() {
  const root = document.getElementById('downloader-library-app');
  if (!root) return;
  document.head.append(Object.assign(el('style'), {textContent:STYLES}));
  root.replaceChildren();
  const h = el('h1','My downloads');
  const description = el('p','Search, review and manage your own downloads. Your downloaded Files stay in Nextcloud.');
  description.className = 'library-help';
  const controls = el('div');controls.className = 'library-controls';
  const nameLabel = el('label','Search downloads');
  const search = el('input');search.type = 'search';
  search.placeholder = 'Name or source link';
  search.setAttribute('aria-label','Search by filename or source link');
  nameLabel.append(search);
  const stateLabel = el('label','Status');
  const state = el('select');
  for (const [value,label] of [['all','All downloads'],['active','Active'],['delivered','Delivered'],['failed','Failed or cancelled']]) {
    const option = el('option',label); option.value = value; state.append(option);
  }
  stateLabel.append(state);controls.append(nameLabel,stateLabel);
  const actions = el('div');actions.className = 'library-actions';
  const settingsLink = el('a','My settings');
  settingsLink.href = oc()!.generateUrl('/settings/user/downloader');
  settingsLink.style.cssText = 'display:inline-flex;align-items:center;padding:8px;';
  actions.append(settingsLink);
  const retryAll = el('button','Retry all failed');
  const clearAll = el('button','Clear history');
  actions.append(retryAll,clearAll);
  const feedback = el('p');feedback.className = 'library-message';
  feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
  const list = el('section');list.className = 'library-list';
  list.setAttribute('aria-label','My downloads');
  const more = el('button','Show more downloads');more.className = 'library-more';
  root.append(h,description,controls,actions,feedback,list,more);
  let generation = 0;
  let offset:number|null = 0;
  let busy = false;

  function showModal(job:Job) {
    const dlg = el('dialog');dlg.className = 'downloader-library-modal';
    const heading = el('h2',downloadTitle(job));heading.id='library-job-title';
    dlg.setAttribute('aria-labelledby',heading.id);
    const source=el('p','Source: '+job.url);source.style.overflowWrap='anywhere';
    dlg.append(heading,el('p',downloadStatusDetail(job)),source);
    if (job.error) dlg.append(el('p',job.error));
    for (const file of job.output_files||[]) {
      dlg.append(el('p',file.filename+(file.verified?' · Verified':file.skipped?' · Skipped':' · Awaiting verification')));
    }
    const technical=el('details');
    technical.append(el('summary','Technical log (advanced)'),el('pre',job.log_text||'No log output.'));
    const buttons=el('div');buttons.className='modal-actions';
    const close=el('button','Close');close.type='button';
    close.addEventListener('click',()=>dlg.close());
    buttons.append(close);dlg.append(technical,buttons);
    document.body.append(dlg);
    dlg.addEventListener('close',()=>dlg.remove(),{once:true});
    dlg.showModal();
  }
  function showConfirmation() {
    const dlg=el('dialog');dlg.className='downloader-library-modal';
    dlg.append(el('h2','Clear download history'),
      el('p','Remove finished and failed downloads from your visible history? Files and provenance will remain available.'));
    const buttons=el('div');buttons.className='modal-actions';
    const cancel=el('button','Cancel'), confirm=el('button','Clear history');
    confirm.className='library-primary';
    cancel.addEventListener('click',()=>dlg.close());
    confirm.addEventListener('click',()=>{dlg.close();void (async()=>{
      try { const result=await api<{hidden:number}>('/jobs/clear-history','POST',{confirm:true});
        feedback.textContent=result.hidden+' history entries hidden. Files were not deleted.';
        await load(true);
      }catch(e){feedback.textContent=e instanceof Error?e.message:'Could not clear history.';}
    })();});
    buttons.append(cancel,confirm);dlg.append(buttons);
    document.body.append(dlg);
    dlg.addEventListener('close',()=>dlg.remove(),{once:true});
    dlg.showModal();
  }
  async function runAction(job:Job,operation:'retry'|'redeliver'|'cancel') {
    try {
      await api('/jobs/'+encodeURIComponent(job.id)+'/'+operation,'POST');
      feedback.textContent='Download updated.';
      await load(true);
    }catch(e){feedback.textContent=e instanceof Error?e.message:'Could not update download.';}
  }
  async function hide(job:Job){
    try {
      await api('/jobs/'+encodeURIComponent(job.id)+'/hide','POST');
      feedback.textContent='Removed from your history. Files were not deleted.';
      await load(true);
    }catch(e){feedback.textContent=e instanceof Error?e.message:'Could not remove entry.';}
  }
  function renderJob(job:Job) {
    const row=el('article');row.className='library-row';row.dataset.jobId=job.id;
    const icon=el('span',downloadSymbol(job));icon.className='library-icon';icon.setAttribute('aria-hidden','true');
    const info=el('div');info.className='library-row-main';
    const title=el('button',downloadTitle(job));title.className='library-title';
    title.title=downloadTitle(job);
    title.addEventListener('click',()=>showModal(job));
    const status=el('span',downloadStatus(job));status.className='library-status';
    status.title=downloadStatusDetail(job);
    info.append(title,status);
    if (!['completed','skipped','failed','cancelled'].includes(job.status)){
      const bar=el('progress');bar.className='library-progress';bar.max=100;
      bar.value=Math.max(0,Math.min(100,Number(job.progress?.percent||0)));
      bar.setAttribute('aria-label','Download progress');
      info.append(bar);
    }

    const controls=el('div');controls.className='library-row-actions';
    const overflow=el('details');overflow.className='library-overflow';
    const trigger=el('summary','⋮');
    trigger.title='More actions';trigger.setAttribute('aria-label','More actions for '+downloadTitle(job));
    const menu=el('div');menu.className='library-overflow-list';
    function control(label:string,fn:()=>void){
      const button=el('button',label);button.type='button';
      button.addEventListener('click',()=>{overflow.open=false;fn();});
      menu.append(button);
    }
    const query=deliveredFilesQuery(job);
    if(query)control('Open in Files',()=>{
      window.location.href=oc()!.generateUrl('/apps/files/files')+query;
    });
    const op=['completed','skipped'].includes(job.status)?'redeliver':(['failed','cancelled'].includes(job.status)?'retry':'cancel');
    control(op==='redeliver'?'Deliver again':op==='retry'?'Try again':'Cancel download',
      ()=>{void runAction(job,op);});
    control('View details',()=>showModal(job));
    control('Remove from history',()=>{void hide(job);});
    overflow.append(trigger,menu);controls.append(overflow);
    row.append(icon,info,controls);
    return row;
  }
  async function load(reset=false){
    if (reset) {generation++;offset=0;}
    const current=generation;
    if (busy && !reset) return;
    if (offset===null) return;
    const at=offset;
    busy=true;more.disabled=true;
    feedback.textContent='Loading downloads…';
    try {
      const params=new URLSearchParams({limit:'50',offset:String(at),state:state.value,q:search.value.trim()});
      const page=await api<Page>('/library?'+params.toString());
      if (current!==generation) return;
      const scroll = reset ? list.scrollTop : 0;
      if (reset) list.replaceChildren(...page.jobs.map(renderJob));
      else list.append(...page.jobs.map(renderJob));
      if (reset) list.scrollTop = scroll;
      offset=page.next_offset;
      more.hidden=offset===null;
      if (!list.children.length && offset===null) list.append(el('p','Nothing here yet. Your downloads will appear here.'));
      feedback.textContent='';
    }catch(e){
      if(current===generation)feedback.textContent=e instanceof Error?e.message:'Could not load downloads.';
    }finally{busy=false;more.disabled=false;}
  }
  const selectedJob=new URLSearchParams(window.location.search).get('job');
  if (selectedJob && /^[a-zA-Z0-9_-]{1,100}$/.test(selectedJob)) {
    // Verified job lookup uses the signed ExApp owner gate; this is not a
    // generic Core UI link or a guessed file path.
    void api<Job>('/jobs/'+encodeURIComponent(selectedJob)).then(showModal).catch(()=>{
      feedback.textContent='That download is unavailable for this account.';
    });
  }
  let searchDebounce:number|undefined;
  search.addEventListener('input',()=>{
    window.clearTimeout(searchDebounce);
    searchDebounce=window.setTimeout(()=>{void load(true);},300);
  });
  state.addEventListener('change',()=>{void load(true);});
  more.addEventListener('click',()=>{void load();});
  retryAll.addEventListener('click',()=>{
    void (async()=>{
      retryAll.disabled=true;
      try {
        const result=await api<{retried:number}>('/jobs/retry-failed','POST');
        feedback.textContent=result.retried+' downloads queued to retry.';
        await load(true);
      }catch(e){feedback.textContent=e instanceof Error?e.message:'Unable to retry failed downloads.';}
      finally{retryAll.disabled=false;}
    })();
  });
  clearAll.addEventListener('click',showConfirmation);
  window.addEventListener('downloader:jobs-updated',()=>{void load(true);});
  void load(true);
  // Current active jobs update without requiring a manual refresh.
  const timer=window.setInterval(()=>{
    if(!root.isConnected){window.clearInterval(timer);return;}
    if(!busy){void load(true);}
  },5000);
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',main,{once:true});
else main();
