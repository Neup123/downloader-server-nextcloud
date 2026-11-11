import {filesJobRequest} from './files-dialog-payload.mjs';

const PAGE = 24;
const MAX = 100;
const MAX_OFFSET = 100000;
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
export function chooseFiltered(indices, matching, checked) {
  const next = new Set(indices);
  for (const item of matching) {
    if (checked) next.add(item.index);
    else next.delete(item.index);
  }
  return next;
}
export function previewRows(preview) {
  if (!preview || !Array.isArray(preview.entries)) return [];
  // Each Core page carries its absolute, one-based extractor indices. Its
  // original source order is authoritative; timestamps must never re-sort it.
  return preview.entries.filter(item => Number.isInteger(item.index) && item.index >= 1 && item.index <= MAX_OFFSET+MAX)
    .map(item => ({
      index: item.index,
      title: typeof item.title === 'string' ? item.title.slice(0,500) : 'Untitled',
      subtitle: typeof item.subtitle === 'string' ? item.subtitle.slice(0,200) : '',
      thumbnail: safeThumbnail(item.thumbnail),
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
  const fresh=previewRows(response).filter(row=>!existing.has(row.index));
  const nextOffset=response?.has_more===true && Number.isInteger(response.next_offset) &&
    response.next_offset>offset && response.next_offset<=MAX_OFFSET ? response.next_offset : null;
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
export function torrentMatches(files, query='', order='name') {
  const q=query.trim().toLowerCase();
  return files.filter(item=>item.path.toLowerCase().includes(q))
    .sort((a,b)=>order==='size' ? a.size_bytes-b.size_bytes || a.path.localeCompare(b.path)
      : a.path.localeCompare(b.path));
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
function sizeLabel(value) {
  if (!Number.isSafeInteger(value) || value < 0) return 'Size not available';
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KiB';
  return (value / (1024 * 1024)).toFixed(1) + ' MiB';
}

export function showLinkDialog({folder, suggested = '', api, notify, queued}) {
  const dialog = e('dialog', '', 'dl-dialog dl-link-dialog');
  dialog.setAttribute('aria-modal','true');
  const form = e('form');
  form.method='dialog';
  dialog.setAttribute('aria-label','Download link');
  const line = e('div', '', 'dl-link-line');
  const url = e('input', '', 'dl-input');
  url.type='text'; url.inputMode='url'; url.autocomplete='url'; url.spellcheck=false;
  url.placeholder='Paste a link…'; url.value=suggested;
  url.setAttribute('aria-label','Source link');
  const spinner=e('span','', 'dl-detect-spinner');spinner.hidden=true;
  spinner.setAttribute('role','status');spinner.setAttribute('aria-label','Detecting link content');
  line.append(url,spinner);
  const status=e('p','', 'dl-muted dl-detect-status');
  status.setAttribute('aria-live','polite');
  status.hidden=true;
  const details=e('section', '', 'dl-detected');
  details.hidden=true;
  const buttons=e('div','','dl-buttons');
  const download=e('button','Download','dl-primary');
  download.type='submit';
  buttons.append(download);buttons.hidden=true;
  form.append(line,status,details,buttons);
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  url.focus();

  let closed=false, generation=0, timer=0;
  let kind='unsupported', preview=null, choices=[], selected=new Set(), limit=Infinity;
  let previewNextOffset=null, playlistAutoSelect=true, torrentSource='none', manifestFiles=[];
  let quality=null, audioOnly=null, subtitles=null, subtitleLanguage=null, container=null;
  let cbz=null, pageChoice=null, filter=null;
  let observation=null, currentUrl='', busy=false;
  const settings=api('/settings').catch(()=>({default_video_quality:'best',default_audio_quality:'best'}));
  const close=()=>{closed=true;generation++;clearTimeout(timer);observation?.disconnect();dialog.remove();};
  dialog.addEventListener('close',close,{once:true});
  const message=(text)=>{status.textContent=text;status.hidden=!text;};
  const available=()=>!busy && kind!=='unsupported' && (kind!=='torrent'||torrentSource==='magnet') && !(kind==='manga' && cbz?.checked);
  function refreshSubmit(){
    const count=details.querySelector('.dl-picker-count');
    if(count && kind!=='torrent')count.textContent=selected.size+' selected';
    download.disabled=!available() || (['playlist','channel','gallery','manga','torrent'].includes(kind) && selected.size===0);
    buttons.hidden=kind==='unsupported' || (kind==='torrent' && torrentSource!=='magnet');
  }
  function mediaControls(settingsValue, soundOnly=false, checkbox=true) {
    const media=e('div','','dl-media-row');
    if (checkbox) {
      audioOnly=e('input'); audioOnly.type='checkbox'; audioOnly.checked=false;
      const toggle=e('label','','dl-audio-toggle');
      toggle.append(audioOnly,e('span','Audio only'));media.append(toggle);
    } else audioOnly=null;
    const qualityPicker=pick([], 'best');
    quality=qualityPicker;
    const update=()=>{
      const audio=soundOnly || Boolean(audioOnly?.checked);
      const options=audio
        ? [['best','Best quality'],['192','Up to 192 kbps'],['128','Up to 128 kbps'],['small','Smallest audio']]
        : [['best','Best quality'],['1080','Up to 1080p'],['720','Up to 720p'],['480','Up to 480p']];
      qualityPicker.replaceChildren(...options.map(([value,label])=>{
        const node=e('option',label); node.value=value; return node;
      }));
      const desired=audio ? settingsValue.default_audio_quality : settingsValue.default_video_quality;
      qualityPicker.value=options.some(item=>item[0]===desired)?desired:'best';
    };
    audioOnly?.addEventListener('change',()=>{
      update();
      if(subtitles){
        subtitles.disabled=audioOnly.checked;subtitleLanguage.disabled=!subtitles.checked || audioOnly.checked;
      }
    });
    update();
    const qualityLabel=labeled('Quality',qualityPicker);
    qualityLabel.classList.add('dl-quality-label');
    media.append(qualityLabel);
    return media;
  }
  function advancedVideo(subtitleLanguages=[], soundOnly=false) {
    const advanced=e('details','','dl-options');
    advanced.append(e('summary','Advanced'));
    if(!soundOnly){
      subtitles=e('input'); subtitles.type='checkbox';subtitles.checked=false;
      const subToggle=e('label','','dl-audio-toggle dl-subtitle-toggle');
      subToggle.append(subtitles,e('span','Download subtitles'));
      advanced.append(subToggle);
      const system=(navigator.language||'en').split('-')[0].toLowerCase();
      subtitleLanguage=pick([['', 'System language ('+system+')'],
        ...subtitleLanguages.filter(lang=>typeof lang==='string' && lang!==system)
          .slice(0,50).map(lang=>[lang,lang])], '');
      subtitleLanguage.disabled=true;
      subtitles.addEventListener('change',()=>{subtitleLanguage.disabled=!subtitles.checked;});
      advanced.append(labeled('Subtitle language',subtitleLanguage));
    } else {subtitles=null;subtitleLanguage=null;}
    container=pick([], 'original');
    const setContainers=()=>{
      const audio=soundOnly||Boolean(audioOnly?.checked);
      const choices=audio
        ? [['original','Original format'],['m4a','Prefer M4A'],['webm','Prefer WebM']]
        : [['original','Original format'],['mp4','Prefer MP4'],['webm','Prefer WebM']];
      container.replaceChildren(...choices.map(([value,text])=>{
        const option=e('option',text);option.value=value;return option;
      }));
      container.value='original';
    };
    setContainers();
    audioOnly?.addEventListener('change',setContainers);
    advanced.append(labeled('Container',container));
    return advanced;
  }
  function drawRows(containerNode, type) {
    observation?.disconnect();
    containerNode.replaceChildren();
    const filterText=(filter?.value||'').toLowerCase();
    const matching=choices.filter(row=>row.title.toLowerCase().includes(filterText)).slice(0,limit);
    if(!matching.length)containerNode.append(e('p','No entries match the current filter.','dl-muted'));
    for(const row of matching){
      const card=e('label','',type==='playlist'?'dl-playlist-item':'dl-grid-item');
      const check=e('input');check.type='checkbox';check.checked=selected.has(row.index);
      check.addEventListener('change',()=>{check.checked?selected.add(row.index):selected.delete(row.index);refreshSubmit();});
      const media=e('span','','dl-entry-media');
      if(row.thumbnail){
        const img=e('img'); img.src=row.thumbnail; img.alt=''; img.loading='lazy';
        media.append(img);
      }else media.append(e('span','Thumbnail unavailable','dl-entry-placeholder'));
      const title=e('span',row.title,'dl-entry-caption');
      if(row.subtitle) title.append(e('small',row.subtitle));
      const metadata=previewMeta(row);
      if(metadata)title.append(e('small',metadata));
      if(row.is_live)media.append(e('span','Live','dl-entry-live-badge'));
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
      const sentinel=e('div','Loading additional entries…','dl-load-sentinel');
      containerNode.append(sentinel);
      if(typeof IntersectionObserver!=='undefined'){
        observation=new IntersectionObserver(entries=>{
          if(entries.some(entry=>entry.isIntersecting))void loadMore(containerNode,type);
        },{root:containerNode,rootMargin:'120px'});
        observation.observe(sentinel);
      }else{
        const more=e('button','Load next batch');more.type='button';
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
      const result=await api('/media-preview','POST',{url:urlAtStart,max_entries:PAGE,offset:next});
      if(token!==generation || urlAtStart!==currentUrl || closed)return;
      if(result.offset!==next)throw new Error('Preview page did not match requested offset');
      const page=appendPreviewPage(choices,result,next);
      choices=page.rows;
      if(type==='playlist' && playlistAutoSelect)for(const row of page.fresh)selected.add(row.index);
      preview=result;
      previewNextOffset=page.nextOffset;
      drawRows(list,type);
      message('');
    }catch(error){
      if(token===generation&&!closed)message('Could not load more items. Please try again.');
    }finally{busy=false;refreshSubmit();}
  }
  function itemPicker(type) {
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
      action.append(selectAll,e('span','Select all / none (loaded entries)'));
      operations.append(action);
    }else{
      const advanced=e('details','','dl-options');advanced.append(e('summary','Advanced filters'));
      filter=e('input');filter.type='search';filter.placeholder='Filter loaded titles';
      filter.addEventListener('input',()=>{drawRows(rows,type);});
      advanced.append(labeled('Filter loaded items',filter));
      const count=pick([['all','All available'],['25','25'],['50','50'],['100','100']], 'all');
      count.addEventListener('change',()=>{limit=count.value==='all'?Infinity:Number(count.value);drawRows(rows,type);});
      advanced.append(labeled('Maximum visible items',count));
      const action=e('label','','dl-audio-toggle');
      action.append(selectAll,e('span','Check / uncheck loaded items matching filter'));
      selectAll.checked=false;
      selectAll.addEventListener('change',()=>{
        const matching=choices.filter(item=>item.title.toLowerCase().includes(filter.value.toLowerCase())).slice(0,limit);
        selected=chooseFiltered(selected, matching, selectAll.checked);
        drawRows(rows,type);refreshSubmit();
      });
      advanced.append(action);
      if(type==='manga'){
        cbz=e('input');cbz.type='checkbox';cbz.checked=true;
        const pack=e('label','','dl-audio-toggle');pack.append(cbz,e('span','Pack as a single CBZ file'));
        cbz.addEventListener('change',refreshSubmit);
        advanced.append(pack,e('p','Packing these pages into one comic book file is not available yet. Turn this off to download individual items.','dl-muted'));
        pageChoice=e('input');pageChoice.placeholder='Page selection is not available yet';pageChoice.disabled=true;
        advanced.append(labeled('Pages',pageChoice));
      }
      picker.append(advanced);
    }
    operations.append(selectedLabel);
    picker.append(operations);
    const rows=e('div','',type==='playlist'?'dl-playlist-list':'dl-gallery-grid');
    picker.append(rows);
    drawRows(rows,type);return picker;
  }
  function torrentPicker() {
    const advanced=e('details','','dl-options');
    advanced.append(e('summary','Advanced — torrent files'));
    // Core can inspect uploaded .torrent bytes, but its /jobs contract cannot
    // enqueue raw uploaded bytes. Such a manifest is explicitly preview-only.
    const upload=e('input');upload.type='file';upload.accept='.torrent,application/x-bittorrent';
    upload.setAttribute('aria-label','Inspect an uploaded .torrent file');
    upload.addEventListener('change',()=>{void inspectUploadedTorrent(upload.files?.[0]);});
    advanced.append(labeled('Inspect a .torrent file',upload));
    if(!manifestFiles.length){
      advanced.append(e('p','No torrent file manifest has been loaded.','dl-muted'));
      return advanced;
    }
    const view=pick([['tree','Tree view'],['flat','Flat list']], 'tree');
    const sort=pick([['name','Sort by name'],['size','Sort by size']], 'name');
    const query=e('input');query.type='search';query.placeholder='Filter torrent files';
    const all=e('input');all.type='checkbox';
    const files=e('div','','dl-torrent-files');
    const count=e('span','','dl-muted dl-picker-count');
    advanced.append(labeled('View',view),labeled('Sort',sort),labeled('Filter files',query));
    const bulk=e('label','','dl-audio-toggle');
    bulk.append(all,e('span','Check / uncheck files matching current filter'));
    advanced.append(bulk,count,files);

    const matching=()=>torrentMatches(manifestFiles,query.value,sort.value);
    function fileLabel(item,showPath=false) {
      const label=e('label','','dl-torrent-file');
      const check=e('input');check.type='checkbox';check.checked=selected.has(item.index);
      check.addEventListener('change',()=>{
        if(check.checked)selected.add(item.index);
        else selected.delete(item.index);
        updateBulk();refreshSubmit();
      });
      label.append(check,e('span',showPath?item.path:item.name,'dl-torrent-name'),
        e('small',sizeLabel(item.size_bytes),'dl-muted'));
      return label;
    }
    function drawTree(node,parent){
      const folders=[...node.folders.entries()].sort(([a],[b])=>a.localeCompare(b));
      for(const [name,child] of folders){
        const group=e('details','','dl-torrent-folder');group.open=true;
        group.append(e('summary',name));
        drawTree(child,group);
        parent.append(group);
      }
      for(const file of node.files)parent.append(fileLabel(file));
    }
    function updateBulk(){
      const matches=matching();
      const checked=matches.filter(item=>selected.has(item.index)).length;
      all.checked=matches.length>0 && checked===matches.length;
      all.indeterminate=checked>0 && checked<matches.length;
      all.disabled=matches.length===0;
      count.textContent=selected.size+' of '+manifestFiles.length+' files selected';
    }
    function draw(){
      files.replaceChildren();
      const matches=matching();
      if(!matches.length)files.append(e('p','No files match the current filter.','dl-muted'));
      else if(view.value==='tree')drawTree(torrentTree(matches),files);
      else for(const file of matches)files.append(fileLabel(file,true));
      updateBulk();refreshSubmit();
    }
    view.addEventListener('change',draw);
    sort.addEventListener('change',draw);
    query.addEventListener('input',draw);
    all.addEventListener('change',()=>{
      selected=chooseFiltered(selected,matching(),all.checked);
      draw();
    });
    draw();
    return advanced;
  }
  function showTorrentManifest(manifest,source) {
    manifestFiles=torrentRows(manifest);
    torrentSource=manifestFiles.length ? source : 'none';
    selected=new Set(manifestFiles.map(item=>item.index));
    details.replaceChildren(e('h3','Torrent or magnet link'));
    if(source==='upload'){
      details.append(e('p','Uploaded .torrent files can be inspected, but this Core version cannot create a job from uploaded bytes. Use a magnet link to download.','dl-muted'));
    }
    if(!manifestFiles.length)details.append(e('p','No selectable files were reported for this torrent.','dl-muted'));
    details.append(torrentPicker());
    refreshSubmit();
  }
  async function inspectUploadedTorrent(file) {
    if(!file)return;
    const token=generation;
    if(file.size<20 || file.size>2000000){
      message('.torrent files must be between 20 bytes and 2 MB.');return;
    }
    busy=true;refreshSubmit();message('');
    try{
      const bytes=new Uint8Array(await file.arrayBuffer());
      if(token!==generation||closed)return;
      let binary='';
      for(let i=0;i<bytes.length;i+=32768){
        binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
      }
      const manifest=await api('/torrent-manifest','POST',{torrent_base64:btoa(binary)});
      if(token!==generation||closed)return;
      showTorrentManifest(manifest,'upload');
      message('');
    }catch(error){
      if(token===generation&&!closed)message('Could not inspect the uploaded .torrent file.');
    }finally{busy=false;refreshSubmit();}
  }

  async function render(next, result, warning='') {
    kind=next;preview=result;details.replaceChildren();details.hidden=false;
    buttons.hidden=true;quality=null;audioOnly=null;subtitles=null;subtitleLanguage=null;
    container=null;cbz=null;pageChoice=null;filter=null;selected=new Set();
    playlistAutoSelect=true;limit=Infinity;torrentSource='none';manifestFiles=[];
    message('');
    if(kind==='unsupported'){
      details.append(e('h3','Unsupported or unrecognized link'),
        e('p','We could not find a supported download at this link. Ordinary web pages cannot be downloaded here.','dl-muted'));
      if(warning)details.append(e('p',warning,'dl-muted'));
      if(looksLikeDirectFile(currentUrl)){
        const tryDirect=e('button','Try as a direct file');tryDirect.type='button';
        tryDirect.addEventListener('click',()=>{void render('direct',null);});
        details.append(tryDirect);
      }
      message('This link is not supported. Try a direct file link or another media link.');
      return;
    }
    if(kind==='torrent'){
      const token=generation;
      if(!/^magnet:\?/i.test(currentUrl)){
        details.append(e('h3','Torrent or magnet link'),
          e('p','Remote HTTP .torrent URLs are not supported. Paste a magnet link or upload .torrent bytes to inspect the files.','dl-muted'),
          torrentPicker());
        message('Remote .torrent URLs cannot be inspected or submitted.');
        return;
      }
      details.append(e('h3','Torrent or magnet link'),
        e('p','Reading the torrent file list from peers…','dl-muted'));
      busy=true;refreshSubmit();
      try{
        const manifest=await api('/torrent-manifest','POST',{url:currentUrl});
        if(token!==generation||closed)return;
        showTorrentManifest(manifest,'magnet');
        message('');
      }catch(error){
        if(token!==generation||closed)return;
        details.replaceChildren(e('h3','Torrent or magnet link'),
          e('p','Torrent file metadata could not be retrieved. Check the magnet link and its available peers.','dl-muted'),
          torrentPicker());
        message('Could not retrieve torrent metadata. Try again later or inspect an uploaded .torrent file.');
      }finally{busy=false;refreshSubmit();}
      return;
    }
    if(kind==='direct'){
      let filename='Unknown filename', fileType='Unverified direct file', bytes=null;
      try { filename=decodeURIComponent(new URL(currentUrl).pathname.split('/').pop()||'Unknown filename'); }
      catch { /* filename remains unknown */ }
      if(result && typeof result.filename==='string')filename=result.filename;
      if(result && typeof result.mime==='string')fileType=result.mime;
      if(result && Number.isSafeInteger(result.size))bytes=result.size;
      details.append(e('h3','Direct file'),e('p','Name: '+filename),
        e('p','Type: '+fileType),e('p','Size: '+sizeLabel(bytes)),
        e('p','No quality or conversion controls apply.','dl-muted'));
      message(result?'':"We have not confirmed this file\'s type or size. Review the filename before downloading.");
      refreshSubmit();return;
    }
    const prefs=await settings;
    if(closed || currentUrl!==url.value.trim())return;
    const headingText={
      video:'Video',audio:'Audio / music',playlist:'Playlist',
      channel:'Channel / series',gallery:'Image gallery / album',manga:'Manga / comics',
    }[kind]||'Media';
    const title=e('h3',headingText+(preview?.title?' · '+preview.title:''));
    details.append(title);
    if(kind==='video' && (preview?.live_status==='is_live'||preview?.is_live===true))
      title.append(e('span','Live','dl-live-badge'));
    if(kind==='audio'){
      details.append(mediaControls(prefs,true,false),advancedVideo([],true));
    }else{
      details.append(mediaControls(prefs,false,true),advancedVideo(preview?.subtitle_languages||[],false));
    }
    if(['playlist','channel','gallery','manga'].includes(kind)){
      const page=appendPreviewPage([],preview,0);
      choices=page.rows;
      previewNextOffset=page.nextOffset;
      if(kind==='playlist'){
        for(const row of choices)selected.add(row.index);
      }else{
        details.append(e('p','Items appear in the order received. Some previews may not include dates or pictures; more items can be loaded.','dl-muted'));
      }
      details.append(itemPicker(kind));
    }
    refreshSubmit();
  }
  async function detect(input) {
    const token=++generation;
    const value=input.trim();currentUrl=value;observation?.disconnect();
    details.hidden=true;buttons.hidden=true;download.disabled=true;kind='unsupported';
    details.replaceChildren();preview=null;previewNextOffset=null;choices=[];selected=new Set();
    message('');
    const magnet=/^magnet:\?/i.test(value);
    let valid=false;
    try {valid=magnet || ['http:','https:'].includes(new URL(value).protocol);}catch{}
    if(!valid){spinner.hidden=true;message(value?'Paste an HTTP(S) link or a magnet URI.':'');return;}
    spinner.hidden=false;
    if(magnet || (()=>{try{return TORRENT.test(new URL(value).pathname)}catch{return false}})()){
      await render('torrent',null);if(token===generation&&!closed)spinner.hidden=true;return;
    }
    try{
      let result=await api('/media-preview','POST',{url:value,max_entries:PAGE,offset:0});
      if(token!==generation||closed)return;
      const detected=classifyPreview(value,result);
      // All first-page playlist entries are selected; further pages select as loaded.
      spinner.hidden=true;
      await render(detected,result);
    }catch(error){
      if(token!==generation||closed)return;
      spinner.hidden=true;
      await render('unsupported',null,'We could not check this link. Try another link or use the direct-file option if it is a file.');
    }
  }
  function schedule(){
    clearTimeout(timer);++generation;spinner.hidden=true;details.hidden=true;buttons.hidden=true;
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
      });
    }catch(error){notify('Please review your download options and try again.');return;}
    busy=true;refreshSubmit();
    try{
      const created=await api('/jobs','POST',body);
      notify('Download added to your Nextcloud Files.');
      queued(created);dialog.close();
    }catch(error){notify('Could not start the download. Please check your connection and try again.');}
    finally{busy=false;refreshSubmit();}
  });
  return dialog;
}
