import {filesJobRequest, validGalleryIdentity, galleryIdentityList, MAX_GALLERY_SELECTION} from './files-dialog-payload.mjs';
import {DOWNLOAD_QUEUED_MESSAGE, t} from './download-labels.mjs';

const PAGE = 24;
const MAX = 100;
const MAX_OFFSET = 100000;
const MAX_GALLERY_OFFSET = 1000;
const DIRECT = /\.(?:zip|7z|rar|pdf|epub|cbz|iso|exe|dmg|apk|tar|gz|csv|json|dat|bin|txt|mp3|flac|wav|m4a|mp4|mkv|webm|png|jpe?g|gif|webp)$/i;
const TORRENT = /\.torrent$/i;
const CHANNEL = /\/(?:channels?|series|shows|seasons|users?|@[^/]+\/(?:videos|streams))(?:\/|$)/i;
const GALLERY = /\/(?:albums?|galleries|photos)(?:\/|$)/i;
const MANGA = /\/(?:manga|comics?|chapters?)(?:\/|$)/i;

export function looksLikeDirectFile(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && DIRECT.test(parsed.pathname);
  } catch { return false; }
}
export function classifyPreview(url, preview) {
  const input = url.trim();
  if (/^magnet:\?/i.test(input) || (() => {
    try { return TORRENT.test(new URL(input).pathname); } catch { return false; }
  })()) return 'torrent';
  // A file-shaped URL remains a direct file even if a generic preview guesses video.
  if (looksLikeDirectFile(input)) return 'direct';
  if (!preview || typeof preview !== 'object') return 'unsupported';
  if (preview.kind === 'direct') return 'direct';
  if (preview.kind === 'playlist' && Array.isArray(preview.entries)) {
    if(preview.extractor==='gallery-dl')return galleryPreviewIsSelectable(preview)?'gallery':'unsupported';
    const path = new URL(input).pathname;
    if (MANGA.test(path)) return 'manga';
    if (GALLERY.test(path)) return 'gallery';
    if (CHANNEL.test(path)) return 'channel';
    return 'playlist';
  }
  if (preview.kind === 'video') {
    const formats = Array.isArray(preview.formats) ? preview.formats : [];
    // A missing or blank codec field is unknown, never proof of video/audio.
    // Check every format: modern split streams have separate video-only formats.
    const realCodec = codec => typeof codec === 'string' && codec.trim() !== ''
      && codec.toLowerCase() !== 'none';
    if (formats.some(item => item && realCodec(item.vcodec))) return 'video';
    if (formats.some(item => item && realCodec(item.acodec))) return 'audio';
    // No usable format identified: a generic video guess is not sufficient.
    return 'direct';
  }
  return 'unsupported';
}
// Core returns the same 422 for different failures. Classify only with a
// stable preview reason code; free-text errors and HTTP status cannot prove why.
export function isValidSourceLink(input) {
  const value = input.trim();
  if (/^magnet:\?/i.test(value)) return true;
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && Boolean(parsed.hostname)
      && !parsed.username && !parsed.password;
  } catch { return false; }
}
export function classifyLinkFailure(input, failure = null) {
  if (!isValidSourceLink(input)) return 'malformed';
  switch (failure?.reasonCode) {
    case 'malformed_link': return 'malformed';
    case 'unsupported_domain':
    case 'item_not_found':
    case 'not_media':
    case 'could_not_check':
      return failure.reasonCode;
    default: return 'could_not_check';
  }
}
export function linkFailureMessage(cause) {
  switch (cause) {
    case 'malformed': return t('downloader_bridge', 'Paste a valid HTTP(S) link or magnet URI.');
    case 'unsupported_domain':
      return t('downloader_bridge', 'This link is not supported. Try a direct file link or another media link.');
    case 'item_not_found':
      return t('downloader_bridge', 'This link no longer exists. It may have been deleted or made private.');
    case 'not_media':
      return t('downloader_bridge', 'Nothing downloadable was found at this link. Ordinary web pages cannot be downloaded here.');
    default: return t('downloader_bridge', 'Could not check this link. Try again.');
  }
}

export function chooseFiltered(indices, matching, checked) {
  const next = new Set(indices);
  for (const item of matching) {
    if (checked) next.add(item.index);
    else next.delete(item.index);
  }
  return next;
}
export function galleryPreviewIsSelectable(preview, allowEmpty=false) {
  return preview?.extractor==='gallery-dl'&&preview.kind==='playlist'&&
    Array.isArray(preview.entries)&&(allowEmpty||preview.entries.length>0)&&
    preview.entries.every(row=>Number.isInteger(row?.index)&&row.index>=1&&
      row.index<=MAX_GALLERY_OFFSET+MAX&&validGalleryIdentity(row.selection_id));
}
export function selectedGalleryIdentities(rows, selected) {
  const matches=rows.filter(row=>selected.has(row.index));
  if(matches.length!==selected.size)throw new Error('Gallery selection is no longer available.');
  return galleryIdentityList(matches.map(row=>row.selection_id));
}
export function previewRows(preview) {
  if (!preview || !Array.isArray(preview.entries)) return [];
  // Each Core page carries its absolute, one-based extractor indices. Its
  // original source order is authoritative; timestamps must never re-sort it.
  return preview.entries.filter(item => Number.isInteger(item.index) && item.index >= 1 && item.index <= MAX_OFFSET+MAX)
    .map(item => ({
      index: item.index,
      ...(validGalleryIdentity(item.selection_id)?{selection_id:item.selection_id}:{}),
      title: typeof item.title === 'string' ? item.title.slice(0,500) : t('downloader_bridge', 'Untitled'),
      subtitle: typeof item.subtitle === 'string' ? item.subtitle.slice(0,200) : '',
      thumbnail: safeThumbnail(item.thumbnail),
      size_bytes: Number.isSafeInteger(item.size_bytes) && item.size_bytes >= 0 ? item.size_bytes : null,
      size_estimate_bytes: Number.isSafeInteger(item.size_estimate_bytes) && item.size_estimate_bytes >= 0 ? item.size_estimate_bytes : null,
      duration: typeof item.duration === 'number' && Number.isFinite(item.duration) && item.duration >= 0 ? item.duration : null,
      timestamp: typeof item.timestamp === 'number' && Number.isFinite(item.timestamp) && item.timestamp >= 0 ? item.timestamp : null,
      upload_date: typeof item.upload_date === 'string' && /^\d{8}$/.test(item.upload_date) ? item.upload_date : null,
      is_live: (item.is_live === true || item.live_status === 'is_live') ? true
        : item.is_live === false ? false : null,
    }));
}
function safeThumbnail(value) {
  if(typeof value!=='string' || value.length>4096)return null;
  try {
    const parsed=new URL(value);
    return ['http:','https:'].includes(parsed.protocol) && parsed.hostname && !parsed.username && !parsed.password
      ? value : null;
  } catch {return null;}
}
export function appendPreviewPage(current, response, offset) {
  const existing=new Set(current.map(row=>row.index));
  const gallery=response?.extractor==='gallery-dl';
  const identities=new Set(current.map(row=>row.selection_id).filter(Boolean));
  const fresh=previewRows(response).filter(row=>{
    if(existing.has(row.index))return false;
    if(gallery){
      if(!validGalleryIdentity(row.selection_id)||identities.has(row.selection_id))return false;
      identities.add(row.selection_id);
    }
    existing.add(row.index);
    return true;
  });
  const maxOffset=gallery?MAX_GALLERY_OFFSET:MAX_OFFSET;
  const nextOffset=response?.has_more===true && Number.isInteger(response.next_offset) &&
    response.next_offset>offset && response.next_offset<=maxOffset ? response.next_offset : null;
  return {rows:[...current,...fresh],fresh,nextOffset};
}
export function previewMeta(row) {
  const meta=[];
  if(row.upload_date){
    const date=row.upload_date;
    meta.push(date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6,8));
  }else if(row.timestamp!==null){
    const date=new Date(row.timestamp*1000);
    if(Number.isFinite(date.getTime()))meta.push(date.toISOString().slice(0,10));
  }
  if(row.size_bytes!==null)meta.push(sizeLabel(row.size_bytes));
  else if(row.size_estimate_bytes!==null)meta.push(t('downloader_bridge', 'About {size}', {size:sizeLabel(row.size_estimate_bytes)}));
  if(row.duration!==null){
    const seconds=Math.round(row.duration);
    const minutes=Math.floor(seconds/60);
    meta.push(minutes+':'+String(seconds%60).padStart(2,'0'));
  }
  return meta.join(' · ');
}
/** Core returns already validated relative paths and one-based aria2 file indices. */
export function torrentRows(manifest) {
  if(!manifest || !Array.isArray(manifest.files))return [];
  const seen=new Set();
  return manifest.files.filter(item=>{
    if(!Number.isInteger(item?.index) || item.index<1 || seen.has(item.index) ||
       !Number.isSafeInteger(item.size_bytes) || item.size_bytes<0 ||
       typeof item.path!=='string' || !item.path || item.path.startsWith('/') ||
       item.path.split('/').some(piece=>!piece || piece==='.' || piece==='..'))return false;
    seen.add(item.index);return true;
  }).map(item=>({
    index:item.index,path:item.path,
    name:typeof item.name==='string' && item.name ? item.name : item.path.split('/').at(-1),
    size_bytes:item.size_bytes,
  }));
}
function torrentExtension(item){
  const dot=item.name.lastIndexOf('.');
  return dot>0 && dot<item.name.length-1 ? item.name.slice(dot).toLowerCase() : '';
}
export function torrentMatches(files, query='', order='name', criteria={}, direction='asc') {
  const q=query.trim().toLowerCase();
  const pathTerm=(criteria.path||'').trim().toLowerCase();
  // An omitted type criterion is unrestricted; an explicitly empty set matches nothing.
  const extensions=criteria.extensions;
  const minBytes=Number.isFinite(criteria.minBytes) ? criteria.minBytes : 0;
  const maxBytes=Number.isFinite(criteria.maxBytes) ? criteria.maxBytes : Infinity;
  const sign=direction==='desc' ? -1 : 1;
  return files.filter(item=>item.name.toLowerCase().includes(q)
    && (!(extensions instanceof Set) || extensions.has(torrentExtension(item)))
    && item.size_bytes>=minBytes && item.size_bytes<=maxBytes
    && (!pathTerm || item.path.split('/').slice(0,-1)
      .some(segment=>segment.toLowerCase().includes(pathTerm))))
    .sort((a,b)=>sign*(order==='size'
      ? a.size_bytes-b.size_bytes || a.name.localeCompare(b.name) || a.path.localeCompare(b.path)
      : a.name.localeCompare(b.name) || a.path.localeCompare(b.path)));
}
/** Selected bytes are computed against the full folder manifest, not the visible filter result. */
export function torrentSelectedBytes(files, selected) {
  return files.reduce((sum,item)=>sum+(selected.has(item.index)?item.size_bytes:0),0);
}
export function torrentTree(files) {
  const root={folders:new Map(),files:[]};
  for(const file of files){
    const parts=file.path.split('/');
    let current=root;
    for(const part of parts.slice(0,-1)){
      if(!current.folders.has(part))current.folders.set(part,{folders:new Map(),files:[]});
      current=current.folders.get(part);
    }
    current.files.push(file);
  }
  return root;
}

const e = (tag, text='', cls='') => {
  const item = document.createElement(tag);
  if (text) item.textContent = text;
  if (cls) item.className = cls;
  return item;
};
function labeled(name, input) {
  const result = e('label', name, 'dl-label');
  result.append(input);
  return result;
}
function pick(choices, value) {
  const select = e('select', '', 'dl-input');
  for (const [id, text] of choices) {
    const item = e('option', text); item.value = id; select.append(item);
  }
  select.value = value;
  return select;
}
export function shouldDisableSubtitleLanguage(checked, audioOnly, languagesAvailable) {
  return !checked || audioOnly || !languagesAvailable;
}
function sizeLabel(value) {
  if (!Number.isSafeInteger(value) || value < 0) return t('downloader_bridge', 'Size not available');
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KiB';
  return (value / (1024 * 1024)).toFixed(1) + ' MiB';
}

/** Honest count and byte summary for selectable non-torrent media entries. */
export function previewSelectionSummary(rows, selected) {
  let count=0, withSize=0, approximate=0, missing=0, bytes=0;
  for(const row of rows){
    if(!selected.has(row.index))continue;
    count++;
    const exact=Number.isSafeInteger(row.size_bytes) && row.size_bytes>=0;
    const estimate=!exact && Number.isSafeInteger(row.size_estimate_bytes) && row.size_estimate_bytes>=0;
    const amount=exact?row.size_bytes:estimate?row.size_estimate_bytes:null;
    if(amount===null || !Number.isSafeInteger(bytes+amount)){missing++;continue;}
    bytes+=amount;withSize++;
    if(estimate)approximate++;
  }
  const parts=[t('downloader_bridge', '{selected} of {total} selected', {selected:count,total:rows.length})];
  if(!count)return parts[0]+' · '+t('downloader_bridge', '0 B selected');
  if(withSize){
    const values={size:sizeLabel(bytes),count:withSize};
    parts.push(approximate
      ? (withSize===1?t('downloader_bridge', 'About {size} for {count} sized item', values):t('downloader_bridge', 'About {size} for {count} sized items', values))
      : (withSize===1?t('downloader_bridge', '{size} for {count} sized item', values):t('downloader_bridge', '{size} for {count} sized items', values)));
  }
  if(missing)parts.push(missing===1?t('downloader_bridge', 'size unknown for {count} item', {count:missing}):t('downloader_bridge', 'size unknown for {count} items', {count:missing}));
  return parts.join(' · ');
}

export function showLinkDialog({folder, suggested = '', api, notify, queued}) {
  const dialog = e('dialog', '', 'dl-dialog dl-link-dialog');
  // Use the real Nextcloud document locale when the host CSS direction differs.
  dialog.dir = /^(ar|fa|he|iw|ur|ps|sd|ug|yi|dv|ckb)(?:[-_]|$)/i.test(document.documentElement.lang)
    || getComputedStyle(document.body).direction === 'rtl' ? 'rtl' : 'ltr';
  dialog.setAttribute('aria-modal','true');
  const form = e('form');
  form.method='dialog';
  dialog.setAttribute('aria-label',t('downloader_bridge', 'Download link'));
  const line = e('div', '', 'dl-link-line');
  const url = e('input', '', 'dl-input');
  url.type='text'; url.inputMode='url'; url.autocomplete='url'; url.spellcheck=false;
  url.placeholder=t('downloader_bridge', 'Paste a link…'); url.value=suggested;
  url.setAttribute('aria-label',t('downloader_bridge', 'Source link'));
  const spinner=e('span','', 'dl-detect-spinner');spinner.hidden=true;
  spinner.setAttribute('role','status');spinner.setAttribute('aria-label',t('downloader_bridge', 'Detecting link content'));
  line.append(url,spinner);
  const status=e('p','', 'dl-muted dl-detect-status');
  status.setAttribute('aria-live','polite');
  status.hidden=true;
  const connectionHelp=e('div','','dl-connection-help');
  connectionHelp.setAttribute('role','status');
  connectionHelp.setAttribute('aria-live','polite');
  const details=e('section', '', 'dl-detected');
  details.hidden=true;
  const buttons=e('div','','dl-buttons');
  const download=e('button',t('downloader_bridge', 'Download'),'dl-primary');
  download.type='submit';
  buttons.append(download);buttons.hidden=true;
  form.append(line,status,connectionHelp,details,buttons);
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  url.focus();

  let closed=false, generation=0, timer=0;
  let kind='unsupported', preview=null, choices=[], selected=new Set(), limit=Infinity;
  let previewNextOffset=null, playlistAutoSelect=true, torrentSource='none', manifestFiles=[];
  let quality=null, audioOnly=null, subtitles=null, subtitleLanguage=null, container=null;
  let subtitleLanguagesAvailable=false;
  let cbz=null, pageChoice=null, filter=null;
  let observation=null, currentUrl='', busy=false, headBusy=false;
  let lastSubmissionPayload=null, lastSubmissionId=null;
  let filesConnection='checking';
  function explainFilesConnection(text){
    connectionHelp.replaceChildren(e('p',text));
    const link=e('a',t('downloader_bridge', 'Open Downloader settings'));
    link.href=(typeof window === 'object' && window.OC?.generateUrl
      ? window.OC.generateUrl('/settings/user/downloader') : '/settings/user/downloader');
    connectionHelp.append(link);
  }
  const settings=api('/settings').then(value=>{
    if(closed)return value;
    if(value?.app_password_configured===true){
      filesConnection='ready';
      connectionHelp.replaceChildren();
    }else{
      filesConnection='missing';
      explainFilesConnection(t('downloader_bridge', 'Connect your Nextcloud Files in Downloader settings before starting a download.'));
    }
    refreshSubmit();
    return value;
  }).catch(()=>{
    if(!closed){
      filesConnection='unavailable';
      explainFilesConnection(t('downloader_bridge', 'Could not check your Files connection. Open Downloader settings to reconnect or retry.'));
      refreshSubmit();
    }
    return {default_video_quality:'best',default_audio_quality:'best'};
  });
  const close=()=>{closed=true;generation++;clearTimeout(timer);observation?.disconnect();dialog.remove();};
  dialog.addEventListener('close',close,{once:true});
  const message=(text)=>{status.textContent=text;status.hidden=!text;};
  const identityGallery=()=>kind==='gallery'&&preview?.extractor==='gallery-dl';
  const available=()=>!busy && !headBusy && filesConnection==='ready' && kind!=='unsupported' && (kind!=='torrent'||torrentSource==='magnet') && !(kind==='manga' && cbz?.checked);
  function refreshSubmit(){
    const count=details.querySelector('.dl-picker-count');
    let validIdentity=true;
    if(identityGallery()&&selected.size){
      try{selectedGalleryIdentities(choices,selected);}catch{validIdentity=false;}
    }
    if(count && kind!=='torrent'){
      count.textContent=previewSelectionSummary(choices,selected);
      if(!validIdentity)count.textContent+=' · '+t('downloader_bridge', 'Select up to {limit} distinct files.', {limit:MAX_GALLERY_SELECTION});
    }
    download.disabled=!available() || !validIdentity || (['playlist','channel','gallery','manga','torrent'].includes(kind) && selected.size===0);
    buttons.hidden=kind==='unsupported' || (kind==='torrent' && torrentSource!=='magnet');
  }
  function mediaControls(settingsValue, soundOnly=false, checkbox=true) {
    const media=e('div','','dl-media-row');
    if (checkbox) {
      audioOnly=e('input'); audioOnly.type='checkbox'; audioOnly.checked=false;
      const toggle=e('label','','dl-audio-toggle');
      toggle.append(audioOnly,e('span',t('downloader_bridge', 'Audio only')));media.append(toggle);
    } else audioOnly=null;
    const qualityPicker=pick([], 'best');
    quality=qualityPicker;
    const update=()=>{
      const audio=soundOnly || Boolean(audioOnly?.checked);
      const options=audio
        ? [['best',t('downloader_bridge', 'Best quality')],['192',t('downloader_bridge', 'Up to 192 kbps')],['128',t('downloader_bridge', 'Up to 128 kbps')],['small',t('downloader_bridge', 'Smallest audio')]]
        : [['best',t('downloader_bridge', 'Best quality')],['1080',t('downloader_bridge', 'Up to 1080p')],['720',t('downloader_bridge', 'Up to 720p')],['480',t('downloader_bridge', 'Up to 480p')]];
      qualityPicker.replaceChildren(...options.map(([value,label])=>{
        const node=e('option',label); node.value=value; return node;
      }));
      const desired=audio ? settingsValue.default_audio_quality : settingsValue.default_video_quality;
      qualityPicker.value=options.some(item=>item[0]===desired)?desired:'best';
    };
    audioOnly?.addEventListener('change',()=>{
      update();
      if(subtitles){
        subtitles.disabled=audioOnly.checked;
        subtitleLanguage.disabled=shouldDisableSubtitleLanguage(
          subtitles.checked,audioOnly.checked,subtitleLanguagesAvailable);
      }
    });
    update();
    qualityPicker.setAttribute('aria-label',t('downloader_bridge', 'Quality'));
    media.append(qualityPicker);
    return media;
  }
  function advancedVideo(subtitleLanguages=[], soundOnly=false) {
    const advanced=e('details','','dl-options');
    advanced.append(e('summary',t('downloader_bridge', 'Advanced')));
    const optionsRow=e('div','','dl-advanced-media-row');
    if(!soundOnly){
      subtitleLanguagesAvailable=subtitleLanguages.length>0;
      const subFrame=e('fieldset','','dl-subtitles-frame');
      subFrame.append(e('legend',t('downloader_bridge', 'Subtitles')));
      subtitles=e('input'); subtitles.type='checkbox';subtitles.checked=false;
      const subToggle=e('label','','dl-audio-toggle dl-subtitle-toggle');
      subToggle.append(subtitles,e('span',t('downloader_bridge', 'Download subtitles')));
      subFrame.append(subToggle);
      const system=(navigator.language||'en').split('-')[0].toLowerCase();
      subtitleLanguage=pick([['', t('downloader_bridge', 'System language ({language})', {language:system})],
        ...subtitleLanguages.filter(lang=>typeof lang==='string' && lang!==system)
          .slice(0,50).map(lang=>[lang,lang])], '');
      subtitleLanguage.disabled=true;
      subtitles.addEventListener('change',()=>{
        subtitleLanguage.disabled=shouldDisableSubtitleLanguage(
          subtitles.checked,Boolean(audioOnly?.checked),subtitleLanguagesAvailable);
      });
      subFrame.append(labeled(t('downloader_bridge', 'Subtitle language'),subtitleLanguage));
      if(!subtitleLanguagesAvailable)
        subFrame.append(e('small',t('downloader_bridge', 'No subtitles available.'),'dl-subtitles-unavailable'));
      optionsRow.append(subFrame);
    } else {subtitles=null;subtitleLanguage=null;}
    container=pick([], 'original');
    const setContainers=()=>{
      const audio=soundOnly||Boolean(audioOnly?.checked);
      const choices=audio
        ? [['original',t('downloader_bridge', 'Original format')],['m4a',t('downloader_bridge', 'Prefer M4A')],['webm',t('downloader_bridge', 'Prefer WebM')]]
        : [['original',t('downloader_bridge', 'Original format')],['mp4',t('downloader_bridge', 'Prefer MP4')],['webm',t('downloader_bridge', 'Prefer WebM')]];
      container.replaceChildren(...choices.map(([value,text])=>{
        const option=e('option',text);option.value=value;return option;
      }));
      container.value='original';
    };
    setContainers();
    audioOnly?.addEventListener('change',setContainers);
    optionsRow.append(labeled(t('downloader_bridge', 'Format'),container));
    advanced.append(optionsRow);
    return advanced;
  }
  function drawRows(containerNode, type) {
    observation?.disconnect();
    containerNode.replaceChildren();
    const filterText=(filter?.value||'').toLowerCase();
    const matching=choices.filter(row=>row.title.toLowerCase().includes(filterText)).slice(0,limit);
    if(!matching.length)containerNode.append(e('p',t('downloader_bridge', 'No entries match the current filter.'),'dl-muted'));
    for(const row of matching){
      const card=e('label','',type==='playlist'?'dl-playlist-item':'dl-grid-item');
      const check=e('input');check.type='checkbox';check.checked=selected.has(row.index);
      check.addEventListener('change',()=>{check.checked?selected.add(row.index):selected.delete(row.index);refreshSubmit();});
      const media=e('span','','dl-entry-media');
      if(row.thumbnail){
        const img=e('img'); img.src=row.thumbnail; img.alt=''; img.loading='lazy';
        media.append(img);
      }else media.append(e('span',t('downloader_bridge', 'Thumbnail unavailable'),'dl-entry-placeholder'));
      const title=e('span',row.title,'dl-entry-caption');
      if(row.subtitle) title.append(e('small',row.subtitle));
      const metadata=previewMeta(row);
      if(metadata)title.append(e('small',metadata));
      if(row.is_live)media.append(e('span',t('downloader_bridge', 'Live'),'dl-entry-live-badge'));
      if(type==='playlist'){
        const info=e('span','','dl-entry-details');
        info.append(title);
        card.append(check,media,info);
      }else{
        media.append(title);
        card.append(check,media);
      }
      containerNode.append(card);
    }
    if(previewNextOffset!==null && previewNextOffset<=MAX_OFFSET && choices.length<limit) {
      const sentinel=e('div',t('downloader_bridge', 'Loading additional entries…'),'dl-load-sentinel');
      containerNode.append(sentinel);
      if(typeof IntersectionObserver!=='undefined'){
        observation=new IntersectionObserver(entries=>{
          if(entries.some(entry=>entry.isIntersecting))void loadMore(containerNode,type);
        },{root:containerNode,rootMargin:'120px'});
        observation.observe(sentinel);
      }else{
        const more=e('button',t('downloader_bridge', 'Load next batch'));more.type='button';
        more.addEventListener('click',()=>{void loadMore(containerNode,type);});
        sentinel.replaceChildren(more);
      }
    }
  }
  async function loadMore(list, type) {
    const urlAtStart=currentUrl, token=generation, next=previewNextOffset;
    if(busy || !preview || next===null || next>MAX_OFFSET)return;
    busy=true;refreshSubmit();
    try {
      const gallery=identityGallery();
      const result=await api('/media-preview','POST',{url:urlAtStart,max_entries:PAGE,offset:next,
        ...(gallery?{engine:'gallery-dl'}:{})});
      if(token!==generation || urlAtStart!==currentUrl || closed)return;
      if(result.offset!==next || (gallery&&!galleryPreviewIsSelectable(result,true)))
        throw new Error('Preview page did not match requested extractor or offset');
      const page=appendPreviewPage(choices,result,next);
      choices=page.rows;
      if(type==='playlist' && playlistAutoSelect)for(const row of page.fresh)selected.add(row.index);
      preview=result;
      previewNextOffset=page.nextOffset;
      drawRows(list,type);
      message('');
    }catch(error){
      if(token===generation&&!closed)message(t('downloader_bridge', 'Could not load more items. Please try again.'));
    }finally{busy=false;refreshSubmit();}
  }
  function itemPicker(type, advanced) {
    const picker=e('div','','dl-picker');
    const operations=e('div','','dl-picker-controls');
    const selectedLabel=e('span','', 'dl-muted dl-picker-count');
    const selectAll=e('input');selectAll.type='checkbox';
    selectAll.checked=type==='playlist';
    if(type==='playlist'){
      selectAll.addEventListener('change',()=>{
        playlistAutoSelect=selectAll.checked;
        selected=chooseFiltered(selected, choices, selectAll.checked);
        drawRows(rows,type);refreshSubmit();
      });
      const action=e('label','','dl-audio-toggle');
      action.append(selectAll,e('span',t('downloader_bridge', 'Select all / none (loaded entries)')));
      operations.append(action);
    }else{
      // The single Advanced section owns all search/filter controls.
      const filters=e('fieldset','','dl-advanced-filters');
      filters.append(e('legend',t('downloader_bridge', 'Search / filter')));
      filter=e('input');filter.type='search';filter.placeholder=t('downloader_bridge', 'Filter loaded titles');
      filter.addEventListener('input',()=>{drawRows(rows,type);});
      filters.append(labeled(t('downloader_bridge', 'Filter loaded items'),filter));
      const count=pick([['all',t('downloader_bridge', 'All available')],['25','25'],['50','50'],['100','100']], 'all');
      count.addEventListener('change',()=>{limit=count.value==='all'?Infinity:Number(count.value);drawRows(rows,type);});
      filters.append(labeled(t('downloader_bridge', 'Maximum visible items'),count));
      const action=e('label','','dl-audio-toggle');
      action.append(selectAll,e('span',t('downloader_bridge', 'Check / uncheck loaded items matching filter')));
      selectAll.checked=false;
      selectAll.addEventListener('change',()=>{
        const matching=choices.filter(item=>item.title.toLowerCase().includes(filter.value.toLowerCase())).slice(0,limit);
        selected=chooseFiltered(selected, matching, selectAll.checked);
        drawRows(rows,type);refreshSubmit();
      });
      filters.append(action);
      if(type==='manga'){
        cbz=e('input');cbz.type='checkbox';cbz.checked=true;
        const pack=e('label','','dl-audio-toggle');pack.append(cbz,e('span',t('downloader_bridge', 'Pack as a single CBZ file')));
        cbz.addEventListener('change',refreshSubmit);
        filters.append(pack,e('p',t('downloader_bridge', 'Packing these pages into one comic book file is not available yet. Turn this off to download individual items.'),'dl-muted'));
        pageChoice=e('input');pageChoice.placeholder=t('downloader_bridge', 'Page selection is not available yet');pageChoice.disabled=true;
        filters.append(labeled(t('downloader_bridge', 'Pages'),pageChoice));
      }
      advanced.append(filters);
    }
    operations.append(selectedLabel);
    picker.append(operations);
    const rows=e('div','',type==='playlist'?'dl-playlist-list':'dl-gallery-grid');
    picker.append(rows);
    drawRows(rows,type);return picker;
  }
  function torrentPicker() {
    const picker=e('div','','dl-picker dl-torrent-picker');
    let view='tree', order='name', direction='asc';
    // The choices are computed afresh for each manifest, including extensionless files.
    const availableExtensions=[...new Set(manifestFiles.map(torrentExtension))]
      .sort((a,b)=>a.localeCompare(b));
    const extensions=new Set(availableExtensions);
    let minBytes=0, maxBytes=Infinity;

    const svgIcon=name=>{
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('viewBox','0 0 24 24');
      svg.setAttribute('class','dl-torrent-icon');
      svg.setAttribute('aria-hidden','true');
      const paths={
        tree:['M5 3v18','M5 6h6','M5 18h6','M11 3h9v6h-9z','M11 15h9v6h-9z'],
        list:['M4 6h16','M4 12h16','M4 18h16'],
        sort:['M7 4v16','M3 16l4 4 4-4','M17 20V4','M13 8l4-4 4 4'],
      };
      for(const d of paths[name]){
        const path=document.createElementNS('http://www.w3.org/2000/svg','path');
        path.setAttribute('d',d);svg.append(path);
      }
      return svg;
    };
    const iconButton=(name,title)=>{
      const button=e('button','','dl-torrent-icon-button');
      button.type='button';button.title=title;button.setAttribute('aria-label',title);
      button.append(svgIcon(name));return button;
    };

    const controls=e('div','','dl-torrent-controls');
    const viewControl=e('div','','dl-torrent-control');
    viewControl.append(e('span',t('downloader_bridge', 'View'),'dl-torrent-control-label'));
    const segment=e('div','','dl-torrent-view-toggle dl-segmented-toggle');
    segment.setAttribute('role','group');segment.setAttribute('aria-label',t('downloader_bridge', 'File view'));
    const slider=e('span','','dl-torrent-view-slider dl-segmented-slider');
    slider.setAttribute('aria-hidden','true');
    const treeButton=iconButton('tree',t('downloader_bridge', 'Tree view'));
    const flatButton=iconButton('list',t('downloader_bridge', 'Flat list'));
    treeButton.classList.add('dl-torrent-view-button','dl-segmented-button');
    flatButton.classList.add('dl-torrent-view-button','dl-segmented-button');
    segment.append(slider,treeButton,flatButton);
    const setView=mode=>{
      view=mode;segment.dataset.view=mode;
      treeButton.setAttribute('aria-pressed',String(mode==='tree'));
      flatButton.setAttribute('aria-pressed',String(mode==='flat'));
      draw();
    };
    treeButton.addEventListener('click',()=>setView('tree'));
    flatButton.addEventListener('click',()=>setView('flat'));
    viewControl.append(segment);

    // Desktop-style unified sort menu: one checked type, one checked direction.
    const sortControl=e('div','','dl-torrent-control dl-torrent-sort-control');
    const sortButton=iconButton('sort',t('downloader_bridge', 'Order by'));
    sortButton.setAttribute('aria-haspopup','menu');
    sortButton.setAttribute('aria-expanded','false');
    const sortMenu=e('div','','dl-torrent-sort-menu');
    sortMenu.setAttribute('role','menu');sortMenu.setAttribute('aria-label',t('downloader_bridge', 'Order by'));
    sortMenu.hidden=true;
    const sortOptions=[];
    const sortOption=(group,value,label)=>{
      const button=e('button','','dl-torrent-sort-option');
      button.type='button';button.setAttribute('role','menuitemradio');
      const tick=e('span','✓','dl-torrent-sort-check');tick.setAttribute('aria-hidden','true');
      button.append(tick,e('span',label));
      button.addEventListener('click',()=>{
        if(group==='type')order=value;else direction=value;
        updateSortMenu();closeSortMenu();draw();sortButton.focus();
      });
      sortOptions.push({button,group,value,tick});
      return button;
    };
    const divider=e('div','','dl-torrent-sort-divider');
    divider.setAttribute('role','separator');
    sortMenu.append(
      sortOption('type','name',t('downloader_bridge', 'Name')),
      sortOption('type','size',t('downloader_bridge', 'Size')),
      divider,
      sortOption('direction','asc',t('downloader_bridge', 'Ascending (A–Z)')),
      sortOption('direction','desc',t('downloader_bridge', 'Descending (Z–A)'))
    );
    const updateSortMenu=()=>{
      for(const {button,group,value,tick} of sortOptions){
        const checked=(group==='type'?order:direction)===value;
        button.setAttribute('aria-checked',String(checked));
        tick.hidden=!checked;
      }
      sortButton.title=t('downloader_bridge', 'Order by: {field}, {direction}', {
        field:order==='name'?t('downloader_bridge', 'Name'):t('downloader_bridge', 'Size'),
        direction:direction==='asc'?t('downloader_bridge', 'ascending'):t('downloader_bridge', 'descending'),
      });
    };
    const closeSortMenu=()=>{
      sortMenu.hidden=true;sortButton.setAttribute('aria-expanded','false');
    };
    sortButton.addEventListener('click',()=>{
      sortMenu.hidden=!sortMenu.hidden;
      sortButton.setAttribute('aria-expanded',String(!sortMenu.hidden));
      if(!sortMenu.hidden){
        const active=sortOptions.find(o=>o.group==='type' && o.value===order);
        active?.button.focus();
      }
    });
    dialog.addEventListener('click',event=>{
      if(!sortControl.contains(event.target))closeSortMenu();
    });
    dialog.addEventListener('keydown',event=>{
      if(event.key==='Escape' && !sortMenu.hidden){
        event.preventDefault();event.stopPropagation();
        closeSortMenu();sortButton.focus();
      }
    });
    updateSortMenu();
    sortControl.append(sortButton,sortMenu);
    controls.append(viewControl,sortControl);

    // Always-visible filters, laid out in the order they are used.
    const filterPanel=e('div','','dl-torrent-filter-panel');
    filterPanel.setAttribute('role','group');
    filterPanel.setAttribute('aria-label',t('downloader_bridge', 'Torrent file filters'));
    const typeGroup=e('fieldset','','dl-torrent-type-filter');
    typeGroup.append(e('legend',t('downloader_bridge', 'File type')));
    const typeOptions=e('div','','dl-torrent-type-options');
    for(const ext of availableExtensions){
      const label=e('label','','dl-torrent-type-option');
      const check=e('input');check.type='checkbox';check.checked=true;
      check.addEventListener('change',()=>{
        if(check.checked)extensions.add(ext);else extensions.delete(ext);
        draw();
      });
      label.append(check,e('span',ext?ext.slice(1):t('downloader_bridge', 'No extension')));
      typeOptions.append(label);
    }
    typeGroup.append(typeOptions);
    const sizeGroup=e('fieldset','','dl-torrent-size-filter');
    sizeGroup.append(e('legend',t('downloader_bridge', 'File size (MiB)')));
    const sizeBounds=e('div','','dl-torrent-size-bounds');
    const minimum=e('input','','dl-input');minimum.type='number';
    minimum.min='0';minimum.step='any';minimum.placeholder=t('downloader_bridge', 'Min');
    const maximum=e('input','','dl-input');maximum.type='number';
    maximum.min='0';maximum.step='any';maximum.placeholder=t('downloader_bridge', 'Max');
    const readBound=(input,fallback)=>{
      if(input.value.trim()==='')return fallback;
      const value=Number(input.value);
      return Number.isFinite(value) && value>=0 ? value*1024*1024 : fallback;
    };
    const updateBounds=()=>{
      minBytes=readBound(minimum,0);
      maxBytes=readBound(maximum,Infinity);
      draw();
    };
    minimum.addEventListener('input',updateBounds);
    maximum.addEventListener('input',updateBounds);
    sizeBounds.append(labeled(t('downloader_bridge', 'Minimum'),minimum),labeled(t('downloader_bridge', 'Maximum'),maximum));
    sizeGroup.append(sizeBounds);
    const nameGroup=e('fieldset','','dl-torrent-name-filter');
    nameGroup.append(e('legend',t('downloader_bridge', 'File name')));
    const query=e('input','','dl-input');query.type='search';
    query.placeholder=t('downloader_bridge', 'File name');query.setAttribute('aria-label',t('downloader_bridge', 'Filter by file name'));
    query.addEventListener('input',draw);
    nameGroup.append(query);
    const pathGroup=e('fieldset','','dl-torrent-path-filter');
    pathGroup.append(e('legend',t('downloader_bridge', 'Path name')));
    const pathQuery=e('input','','dl-input');pathQuery.type='search';
    pathQuery.placeholder=t('downloader_bridge', 'Path segment');
    pathQuery.setAttribute('aria-label',t('downloader_bridge', 'Filter by partial path segment'));
    pathQuery.addEventListener('input',draw);
    pathGroup.append(pathQuery);
    filterPanel.append(typeGroup,sizeGroup,nameGroup,pathGroup);
    const selectionLine=e('div','','dl-torrent-selection');
    const count=e('span','','dl-muted dl-picker-count');
    selectionLine.append(count);
    const files=e('div','','dl-torrent-files');
    picker.append(filterPanel,controls,selectionLine,files);

    const matching=()=>torrentMatches(manifestFiles,query.value,order,{
      extensions,minBytes,maxBytes,path:pathQuery.value,
    },direction);
    let folderChecks=[],fileChecks=[];
    function updateSelection(){
      for(const {check,index} of fileChecks)check.checked=selected.has(index);
      for(const {check,rows,scopeRows,totalRows,sizeOutput} of folderChecks){
        // Tri-state is deliberately based ONLY on visible rows, even for All files.
        const checked=rows.filter(row=>selected.has(row.index)).length;
        check.checked=rows.length>0 && checked===rows.length;
        check.indeterminate=checked>0 && checked<rows.length;
        check.disabled=scopeRows.length===0;
        sizeOutput.textContent=sizeLabel(torrentSelectedBytes(totalRows,selected));
      }
      count.textContent=t('downloader_bridge', '{selected} of {total} files selected · {size} total', {
        selected:selected.size,total:manifestFiles.length,size:sizeLabel(torrentSelectedBytes(manifestFiles,selected)),
      });
    }
    function applyScope(rows,checked){
      selected=chooseFiltered(selected,rows,checked);
      updateSelection();refreshSubmit();
    }
    function folderCheck(rows,name,scopeRows,totalRows,sizeOutput){
      const check=e('input');check.type='checkbox';
      check.setAttribute('aria-label',t('downloader_bridge', 'Select files in {name}', {name}));
      check.addEventListener('click',event=>event.stopPropagation());
      check.addEventListener('change',()=>applyScope(scopeRows,check.checked));
      folderChecks.push({check,rows,scopeRows,totalRows,sizeOutput});
      return check;
    }
    function fileLabel(item,showPath=false){
      const label=e('label','','dl-torrent-file');
      const check=e('input');check.type='checkbox';check.checked=selected.has(item.index);
      fileChecks.push({check,index:item.index});
      check.addEventListener('change',()=>{
        if(check.checked)selected.add(item.index);
        else selected.delete(item.index);
        updateSelection();refreshSubmit();
      });
      label.append(check,e('span',showPath?item.path:item.name,'dl-torrent-name'),
        e('small',sizeLabel(item.size_bytes),'dl-muted'));
      return label;
    }
    function descendants(node){
      const result=[...node.files];
      for(const child of node.folders.values())result.push(...descendants(child));
      return result;
    }
    function folderRow(name,visibleRows,allRows,scopeRows=visibleRows){
      const group=e('details','','dl-torrent-folder');
      group.open=true;
      const heading=e('summary');
      const expander=e('span','','dl-torrent-expander');
      expander.setAttribute('aria-hidden','true');
      const size=e('small','','dl-torrent-folder-size dl-muted');
      heading.append(expander,folderCheck(visibleRows,name,scopeRows,allRows,size),
        e('span',name,'dl-torrent-folder-name'),size);
      const children=e('div','','dl-torrent-children');
      group.append(heading,children);
      return {group,children};
    }
    function drawTree(node,fullNode,parent){
      const folders=[...node.folders.entries()].sort(([a,childA],[b,childB])=>{
        if(order==='size'){
          const bytes=node=>descendants(node).reduce((sum,file)=>sum+file.size_bytes,0);
          const delta=bytes(childA)-bytes(childB);
          if(delta)return direction==='desc'?-delta:delta;
        }
        return (direction==='desc'?-1:1)*a.localeCompare(b);
      });
      for(const [name,child] of folders){
        const allRows=descendants(fullNode.folders.get(name));
        const {group,children}=folderRow(name,descendants(child),allRows);
        drawTree(child,fullNode.folders.get(name),children);
        parent.append(group);
      }
      for(const file of node.files)parent.append(fileLabel(file));
    }
    function draw(){
      files.replaceChildren();folderChecks=[];fileChecks=[];
      const matches=matching();
      const fullTree=torrentTree(manifestFiles);
      // Root affects ALL manifest files, irrespective of filters. Its displayed
      // checkbox state remains visible-only, like every other folder.
      const {group,children}=folderRow(t('downloader_bridge', 'All files'),matches,manifestFiles,manifestFiles);
      group.classList.add('dl-torrent-all-files');
      if(!matches.length)children.append(e('p',t('downloader_bridge', 'No files match the current filter.'),'dl-muted'));
      else if(view==='tree')drawTree(torrentTree(matches),fullTree,children);
      else for(const file of matches)children.append(fileLabel(file,true));
      files.append(group);
      updateSelection();refreshSubmit();
    }
    setView('tree');
    return picker;
  }
  function showTorrentManifest(manifest) {
    manifestFiles=torrentRows(manifest);
    torrentSource=manifestFiles.length ? 'magnet' : 'none';
    selected=new Set(manifestFiles.map(item=>item.index));
    details.replaceChildren();
    if(!manifestFiles.length)details.append(e('p',t('downloader_bridge', 'No selectable files were reported for this torrent.'),'dl-muted'));
    else details.append(torrentPicker());
    refreshSubmit();
  }

  async function render(next, result, failure='could_not_check') {
    kind=next;preview=result;details.replaceChildren();details.hidden=false;
    dialog.classList.toggle('dl-torrent-dialog',kind==='torrent');
    buttons.hidden=true;quality=null;audioOnly=null;subtitles=null;subtitleLanguage=null;
    container=null;cbz=null;pageChoice=null;filter=null;selected=new Set();
    playlistAutoSelect=true;limit=Infinity;torrentSource='none';manifestFiles=[];
    message('');
    if(kind==='unsupported'){
      // Exactly one explanation, in the status line; no unsupported heading
      // or second diagnosis based on an extractor check that did not succeed.
      details.hidden=true;
      if(looksLikeDirectFile(currentUrl)){
        const tryDirect=e('button',t('downloader_bridge', 'Try as a direct file'));tryDirect.type='button';
        tryDirect.addEventListener('click',()=>{void render('direct',null);});
        details.append(tryDirect);
        details.hidden=false;
      }
      message(linkFailureMessage(failure));
      return;
    }
    if(kind==='torrent'){
      const token=generation;
      if(!/^magnet:\?/i.test(currentUrl)){
        message(t('downloader_bridge', 'Direct .torrent URLs cannot be inspected or submitted.'));
        return;
      }
      details.append(e('p',t('downloader_bridge', 'Loading torrent file list…'),'dl-muted'));
      busy=true;refreshSubmit();
      try{
        const manifest=await api('/torrent-manifest','POST',{url:currentUrl});
        if(token!==generation||closed)return;
        showTorrentManifest(manifest);
        message('');
      }catch(error){
        if(token!==generation||closed)return;
        details.replaceChildren();
        message(t('downloader_bridge', 'Could not load the torrent file list. Check the magnet link.'));
      }finally{busy=false;refreshSubmit();}
      return;
    }
    if(kind==='direct'){
      const token=generation, inspectedUrl=currentUrl;
      let metadata=null;
      headBusy=true;refreshSubmit();
      try{
        // This is a signed Core HEAD inspection only; the browser never
        // contacts the source or reads downloaded content directly.
        metadata=await api('/direct-metadata','POST',{url:inspectedUrl});
      }catch{
        // Unsupported HEAD, redirects or blocked targets must not be
        // presented as verified file metadata.
      }finally{
        if(token===generation)headBusy=false;
      }
      if(token!==generation||closed||currentUrl!==inspectedUrl)return;
      // A filename-looking URL may still point to an ordinary HTML page.
      // Do not offer a download if HEAD actually identifies web content.
      if(['text/html','application/xhtml+xml'].includes(metadata?.mime)){
        kind='unsupported';
        details.append(e('h3',t('downloader_bridge', 'Not a direct file')));
        message(t('downloader_bridge', 'This address returns a web page, not a downloadable file.'));
        refreshSubmit();
        return;
      }
      let filename=t('downloader_bridge', 'Unknown filename'), fileType=t('downloader_bridge', 'Unverified direct file'), bytes=null;
      try {const segment=new URL(inspectedUrl).pathname.split('/').pop();if(segment)filename=decodeURIComponent(segment);}
      catch { /* filename remains unknown */ }
      if(typeof metadata?.filename==='string' && metadata.filename)filename=metadata.filename;
      if(typeof metadata?.mime==='string' && metadata.mime)fileType=metadata.mime;
      if(Number.isSafeInteger(metadata?.size) && metadata.size>=0)bytes=metadata.size;
      details.append(e('h3',t('downloader_bridge', 'Direct file')),e('p',t('downloader_bridge', 'Name: {filename}', {filename})),
        e('p',t('downloader_bridge', 'Type: {fileType}', {fileType})),e('p',t('downloader_bridge', 'Size: {size}', {size:sizeLabel(bytes)})),
        e('p',t('downloader_bridge', 'No quality or conversion controls apply.'),'dl-muted'));
      message(metadata && (metadata.filename||metadata.mime||bytes!==null)?'':
        t('downloader_bridge', 'We have not confirmed this file\'s type or size. Review the filename before downloading.'));
      refreshSubmit();return;
    }
    const prefs=await settings;
    if(closed || currentUrl!==url.value.trim())return;
    const headingText={
      video:t('downloader_bridge', 'Video'),audio:t('downloader_bridge', 'Audio / music'),playlist:t('downloader_bridge', 'Playlist'),
      channel:t('downloader_bridge', 'Channel / series'),gallery:t('downloader_bridge', 'Image gallery / album'),manga:t('downloader_bridge', 'Manga / comics'),
    }[kind]||t('downloader_bridge', 'Media');
    const title=e('h3',headingText+(preview?.title?' · '+preview.title:''));
    details.append(title);
    if(kind==='video' && (preview?.live_status==='is_live'||preview?.is_live===true))
      title.append(e('span',t('downloader_bridge', 'Live'),'dl-live-badge'));
    let advanced;
    if(identityGallery()){
      advanced=e('details','','dl-options');
      advanced.append(e('summary',t('downloader_bridge', 'Advanced')));
      details.append(advanced);
    }else if(kind==='audio'){
      const media=mediaControls(prefs,true,false);
      advanced=advancedVideo([],true);
      details.append(media,advanced);
    }else{
      const media=mediaControls(prefs,false,true);
      advanced=advancedVideo(preview?.subtitle_languages||[],false);
      details.append(media,advanced);
    }
    if(['playlist','channel','gallery','manga'].includes(kind)){
      const page=appendPreviewPage([],preview,0);
      choices=page.rows;
      previewNextOffset=page.nextOffset;
      if(kind==='playlist'){
        for(const row of choices)selected.add(row.index);
      }else{
        details.append(e('p',t('downloader_bridge', 'Items appear in the order received. Some previews may not include dates or pictures; more items can be loaded.'),'dl-muted'));
      }
      details.append(itemPicker(kind,advanced));
    }
    refreshSubmit();
  }
  async function detect(input) {
    const token=++generation;
    const value=input.trim();currentUrl=value;observation?.disconnect();
    details.hidden=true;buttons.hidden=true;download.disabled=true;kind='unsupported';
    dialog.classList.remove('dl-torrent-dialog');
    details.replaceChildren();preview=null;previewNextOffset=null;choices=[];selected=new Set();
    message('');
    const magnet=/^magnet:\?/i.test(value);
    if(!isValidSourceLink(value)){
      spinner.hidden=true;
      message(value?linkFailureMessage(classifyLinkFailure(value)):'');
      return;
    }
    spinner.hidden=false;
    if(magnet || (()=>{try{return TORRENT.test(new URL(value).pathname)}catch{return false}})()){
      await render('torrent',null);if(token===generation&&!closed)spinner.hidden=true;return;
    }
    if(looksLikeDirectFile(value)){
      await render('direct',null);
      if(token===generation&&!closed)spinner.hidden=true;
      return;
    }
    let original=null, detected='unsupported', failure='could_not_check';
    try{
      original=await api('/media-preview','POST',{url:value,max_entries:PAGE,offset:0});
      if(token!==generation||closed)return;
      detected=classifyPreview(value,original);
    }catch(error){
      if(token!==generation||closed)return;
      failure=classifyLinkFailure(value,error);
    }
    // Do not disturb a successful video/audio/list extractor. Only an
    // unsupported or unconfirmed direct guess gets the public gallery probe.
    if((detected==='unsupported'||detected==='direct')&&failure!=='malformed'&&failure!=='item_not_found'){
      try{
        const gallery=await api('/media-preview','POST',{url:value,max_entries:PAGE,offset:0,engine:'gallery-dl'});
        if(token!==generation||closed)return;
        if(galleryPreviewIsSelectable(gallery)&&gallery.offset===0){
          original=gallery;detected='gallery';
        }
      }catch{ /* preserve the original diagnosis; older Core is compatible */ }
    }
    if(token!==generation||closed)return;
    spinner.hidden=true;
    await render(detected,original,failure);
  }
  function schedule(){
    clearTimeout(timer);++generation;headBusy=false;spinner.hidden=true;details.hidden=true;buttons.hidden=true;
    kind='unsupported';download.disabled=true;message('');
    timer=setTimeout(()=>{void detect(url.value);},220);
  }
  url.addEventListener('input',schedule);
  // Pasted Talk links must start detection without a second confirmation.
  if(suggested.trim())void detect(suggested);
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    // A hidden submit button can still be the form's default on Enter.
    // Never submit stale detection results when the link has changed.
    if(details.hidden||currentUrl!==url.value.trim()||!available()||download.disabled)return;
    const target=currentUrl;
    const audio=kind==='audio'||Boolean(audioOnly?.checked);
    let body;
    try{
      body=filesJobRequest(target,folder,quality?.value||'best',audio,{
        kind,container:container?.value||'original',
        subtitles:Boolean(subtitles?.checked),subtitleLanguage:subtitleLanguage?.value||
          (navigator.language||'en').split('-')[0].toLowerCase(),
        selectedIndices:[...selected],cbz:cbz?.checked,
        ...(identityGallery()?{extractor:'gallery-dl',galleryItemIds:selectedGalleryIdentities(choices,selected)}:{}),
      });
    }catch(error){notify(t('downloader_bridge', 'Please review your download options and try again.'));return;}
    // Retry one unchanged action with the same key. New user choices
    // intentionally begin a new Core submission. The identity is never logged.
    const identity=JSON.stringify(body);
    if(identity!==lastSubmissionPayload){
      if(typeof globalThis.crypto?.randomUUID!=='function'){
        notify(t('downloader_bridge', 'A secure browser connection is required to start downloads.'));
        return;
      }
      lastSubmissionPayload=identity;
      lastSubmissionId=globalThis.crypto.randomUUID();
    }
    body.submission_id=lastSubmissionId;
    busy=true;refreshSubmit();
    try{
      const created=await api('/jobs','POST',body);
      if (!created || !created.id) throw new Error('Missing queued job confirmation');
      notify(DOWNLOAD_QUEUED_MESSAGE);
      queued(created);dialog.close();
    }catch(error){
      const reason=error instanceof Error?error.message:'';
      if(/app.password|files.connection|credentials.unavailable|not.connected/i.test(reason)){
        filesConnection='missing';
        explainFilesConnection(t('downloader_bridge', 'Your Nextcloud Files connection needs attention. Reconnect in Downloader settings.'));
        notify(t('downloader_bridge', 'Connect Files in Downloader settings before retrying.'));
      }else if(/destination.folder|cannot.open.destination|not.writable/i.test(reason)){
        notify(t('downloader_bridge', 'The destination folder is unavailable. Choose a folder in Downloader settings and retry.'));
      }else if(/401|403|not.authorized|unauthorized/i.test(reason)){
        notify(t('downloader_bridge', 'Downloader is not available for this account. Ask your Nextcloud administrator.'));
      }else{
        notify(t('downloader_bridge', 'Could not start the download. Please try again. Your link and selections were kept.'));
      }
    }
    finally{busy=false;refreshSubmit();}
  });
  return dialog;
}
