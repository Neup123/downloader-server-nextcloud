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
  const site=node('input');site.type='text';site.placeholder='example.com';site.autocomplete='off';
  const paste=node('textarea');paste.rows=4;paste.placeholder='# Netscape HTTP Cookie File';paste.autocomplete='off';
  const upload=node('input');upload.type='file';upload.accept='.txt,.cookies,text/plain';
  const submit=iconButton('Save site cookies','Save cookies');submit.classList.add('primary');
  const rows=node('div');rows.className='downloader-vault-sites';
  const form=node('form');form.append(wrap('Website',site),wrap('Paste cookies.txt',paste),wrap('Or upload cookies.txt',upload),submit);
  area.append(help,warning,form,feedback,rows);host.append(area);
  function wrap(text:string,input:HTMLElement){const el=node('label',text);el.append(input);return el;}
  async function refresh(){
    try{
      const records=await api<CookieRecord[]>('/cookies');
      rows.replaceChildren();
      if(!records.length)rows.append(node('p','Not set — no site cookies saved.'));
      for(const entry of records){
        if(typeof entry.filename!=='string'||!entry.filename.endsWith('.txt'))continue;
        const line=node('div');line.className='downloader-vault-site';
        const name=entry.filename.slice(0,-4);
        line.append(node('span',name),node('span','Saved · validity not tested'));
        const test=iconButton('Test site cookies for '+name,'Test');
        const remove=iconButton('Remove site cookies for '+name,'Remove');
        test.addEventListener('click',()=>{
          feedback.textContent='Cookie validation requires a Core test endpoint that is not yet available.';
        });
        remove.addEventListener('click',()=>{
          void api('/cookies/'+encodeURIComponent(entry.filename),'DELETE').then(()=>{
            feedback.textContent='Cookies removed for '+name;void refresh();
          }).catch(()=>{feedback.textContent='Could not remove those cookies.';});
        });
        line.append(test,remove);rows.append(line);
      }
    }catch{feedback.textContent='Could not load saved site cookie status.';}
  }
  form.addEventListener('submit',event=>{
    event.preventDefault();
    const domain=safeSite(site.value);
    if(!domain){feedback.textContent='Enter a valid site domain (for example example.com).';return;}
    submit.disabled=true;
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
        await refresh();
      }catch(error){feedback.textContent=error instanceof Error?error.message:'Could not save cookies.';}
      finally{submit.disabled=false;}
    })();
  });
  void refresh();
}
