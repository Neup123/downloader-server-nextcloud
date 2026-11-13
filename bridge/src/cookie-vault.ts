/** Owner-scoped cookie vault. Never rehydrate or log saved cookie values. */
type Api = <T>(path:string,method?:string,payload?:unknown)=>Promise<T>;
type CookieRecord={filename:string;size_bytes:number};
const EXTENSION='https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc';
function node<K extends keyof HTMLElementTagNameMap>(tag:K,copy=''):HTMLElementTagNameMap[K]{
  const el=document.createElement(tag);el.textContent=copy;return el;
}
function iconButton(name:string,label:string):HTMLButtonElement{
  const el=node('button',label);el.type='button';el.title=name;el.setAttribute('aria-label',name);
  el.className='downloader-vault-action';return el;
}
function utf8Base64(content:Uint8Array):string{
  let binary='';
  for(let offset=0;offset<content.length;offset+=8192){
    binary+=String.fromCharCode(...content.subarray(offset,offset+8192));
  }
  return btoa(binary);
}
function safeSite(value:string):string|null{
  try{
    const input=value.trim().replace(/^https?:\/\//i,'').split('/')[0].toLowerCase();
    if(!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(input))return null;
    return input;
  }catch{return null;}
}
export function renderCookieVault(host:HTMLElement,api:Api):void{
  const area=node('section');area.className='downloader-vault';
  area.id='downloader-site-cookies';area.append(node('h3','Site cookies'));
  const help=node('p','To connect a website: log in to that website in your browser, install ');
  const ext=node('a','Get cookies.txt LOCALLY');ext.href=EXTENSION;ext.target='_blank';
  ext.rel='noopener noreferrer';
  help.append(ext,document.createTextNode(', click the extension while on the website, export cookies.txt, then paste or upload it here.'));
  const warning=node('p','Keep cookies private: they are effectively a password. Anyone holding them can use your logged-in session. Do not use the older “Get cookies.txt” extension (without “LOCALLY”); it was removed for sending users’ data to a remote server.');
  warning.className='downloader-vault-warning';
  const feedback=node('p');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
  const rows=node('div');rows.className='downloader-vault-sites';
  rows.setAttribute('role','listbox');rows.setAttribute('aria-label','Saved site cookies');
  const add=iconButton('Add site cookies','+');
  const remove=iconButton('Remove selected site cookies','−');
  const up=iconButton('Move selected site cookies up','▲');
  const down=iconButton('Move selected site cookies down','▼');
  const toolbar=node('div');toolbar.className='downloader-vault-toolbar';
  const left=node('div');left.className='downloader-vault-toolbar-group';left.append(add,remove);
  const right=node('div');right.className='downloader-vault-toolbar-group';right.append(up,down);
  toolbar.append(left,right);
  const reset=node('button','Reset cookies to default');reset.type='button';reset.className='downloader-vault-reset';
  const site=node('input');site.type='text';site.placeholder='example.com';site.autocomplete='off';
  const paste=node('textarea');paste.rows=4;paste.placeholder='# Netscape HTTP Cookie File';paste.autocomplete='off';
  const upload=node('input');upload.type='file';upload.accept='.txt,.cookies,text/plain';
  const submit=iconButton('Save site cookies','Save cookies');submit.type='submit';submit.classList.add('primary');
  const form=node('form');form.append(wrap('Website',site),wrap('Paste cookies.txt',paste),wrap('Or upload cookies.txt',upload),submit);
  area.append(help,warning,rows,toolbar,reset,form,feedback);host.append(area);
  function wrap(text:string,input:HTMLElement){const el=node('label',text);el.append(input);return el;}
  let records:CookieRecord[]=[];
  let selected:string|null=null;
  let working=false;
  const rowButtons=new Map<string,HTMLButtonElement>();
  function syncSelection(){
    const index=records.findIndex(entry=>entry.filename===selected);
    for(const [filename,button] of rowButtons){
      const active=filename===selected;
      button.classList.toggle('is-selected',active);
      button.setAttribute('aria-selected',String(active));button.disabled=working;
    }
    add.disabled=working;remove.disabled=working||index<0;
    up.disabled=working||index<=0;down.disabled=working||index<0||index===records.length-1;
    reset.disabled=working||records.length===0;
  }
  function setWorking(value:boolean){
    working=value;site.disabled=value;paste.disabled=value;upload.disabled=value;submit.disabled=value;
    syncSelection();
  }
  function draw(){
    rows.replaceChildren();rowButtons.clear();
    if(!records.length)rows.append(node('p','Not set — no site cookies saved.'));
    for(const entry of records){
      const name=entry.filename.slice(0,-4);
      const row=iconButton('Select site cookies for '+name,'');row.className='downloader-vault-site';
      row.setAttribute('role','option');
      const title=node('span',name);title.className='downloader-vault-site-name';
      const status=node('span','Saved · validity not tested');status.className='downloader-vault-site-status';
      row.append(title,status);
      row.addEventListener('click',()=>selectEntry(entry.filename));
      rowButtons.set(entry.filename,row);rows.append(row);
    }
    syncSelection();
  }
  function selectEntry(filename:string|null){
    selected=filename;
    site.value=filename?filename.slice(0,-4):'';
    paste.value='';upload.value='';syncSelection();
  }
  async function refresh():Promise<boolean>{
    try{
      const incoming=(await api<CookieRecord[]>('/cookies'))
        .filter(entry=>typeof entry.filename==='string'&&entry.filename.endsWith('.txt'));
      const known=new Set(records.map(entry=>entry.filename));
      records=[...records.flatMap(old=>incoming.filter(entry=>entry.filename===old.filename)),
        ...incoming.filter(entry=>!known.has(entry.filename))];
      if(selected&&!records.some(entry=>entry.filename===selected)){
        selected=null;site.value='';paste.value='';upload.value='';
      }
      draw();return true;
    }catch{feedback.textContent='Could not load saved site cookie status.';return false;}
  }
  function move(offset:number){
    const index=records.findIndex(entry=>entry.filename===selected);
    const target=index+offset;
    if(working||index<0||target<0||target>=records.length)return;
    [records[index],records[target]]=[records[target],records[index]];
    draw();if(selected)rowButtons.get(selected)?.focus();
  }
  add.addEventListener('click',()=>{selectEntry(null);site.focus();});
  up.addEventListener('click',()=>move(-1));down.addEventListener('click',()=>move(1));
  remove.addEventListener('click',()=>{
    const index=records.findIndex(entry=>entry.filename===selected);
    if(working||index<0)return;
    const entry=records[index];
    const next=records[index+1]?.filename??records[index-1]?.filename??null;
    setWorking(true);
    void (async()=>{
      try{
        await api('/cookies/'+encodeURIComponent(entry.filename),'DELETE');
        selected=next;
        if(await refresh()){
          selectEntry(selected);feedback.textContent='Cookies removed for '+entry.filename.slice(0,-4);
        }
      }catch{feedback.textContent='Could not remove those cookies.';}
      finally{setWorking(false);}
    })();
  });
  reset.addEventListener('click',()=>{
    if(working||!records.length)return;
    setWorking(true);
    void (async()=>{
      try{
        for(const entry of records)await api('/cookies/'+encodeURIComponent(entry.filename),'DELETE');
        selected=null;
        if(await refresh()){
          selectEntry(null);feedback.textContent='Site cookies reset to default.';
        }
      }catch{
        feedback.textContent='Could not reset site cookies.';await refresh();
      }finally{setWorking(false);}
    })();
  });
  form.addEventListener('submit',event=>{
    event.preventDefault();
    if(working)return;
    const domain=safeSite(site.value);
    if(!domain){feedback.textContent='Enter a valid site domain (for example example.com).';return;}
    setWorking(true);
    void (async()=>{
      try{
        const bytes=upload.files?.length?new Uint8Array(await upload.files[0].arrayBuffer()):
          new TextEncoder().encode(paste.value);
        if(!bytes.length||bytes.length>1_000_000)throw Error('Choose a cookies.txt file of up to 1 MB.');
        const first=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
        if(!first.includes('# Netscape HTTP Cookie File')&&!first.includes('\t'))
          throw Error('Provide cookies.txt in Netscape format.');
        await api('/cookies/'+encodeURIComponent(domain+'.txt'),'PUT',{content_base64:utf8Base64(bytes)});
        paste.value='';upload.value='';feedback.textContent='Cookies stored for '+domain+'.';
        selected=domain+'.txt';await refresh();
      }catch(error){feedback.textContent=error instanceof Error?error.message:'Could not save cookies.';}
      finally{setWorking(false);}
    })();
  });
  draw();void refresh();
}
