import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';

class EventStub{
  constructor(type){this.type=type;this.defaultPrevented=false;}
  preventDefault(){this.defaultPrevented=true;}
}
class ElementStub{
  constructor(tag,document){
    this.tagName=tag.toUpperCase();this.document=document;this.parentNode=null;
    this.childNodes=[];this._text='';this.listeners=new Map();this.attributes={};
    this.className='';this.files=[];this.disabled=false;
    this.type=tag==='button'?'submit':'';this.value='';
    this.classList={
      contains:token=>this.className.split(/\s+/).includes(token),
      add:token=>{if(!this.classList.contains(token))this.className=[this.className,token].filter(Boolean).join(' ');},
      remove:token=>{this.className=this.className.split(/\s+/).filter(part=>part!==token).join(' ');},
      toggle:(token,force)=>{
        const active=force===undefined?!this.classList.contains(token):force;
        if(active)this.classList.add(token);else this.classList.remove(token);
        return active;
      },
    };
  }
  get value(){return this._value;}
  set value(value){this._value=String(value);if(this.type==='file'&&value==='')this.files=[];}
  get textContent(){return this._text+this.childNodes.map(child=>child.textContent).join('');}
  set textContent(value){this.childNodes=[];this._text=String(value);}
  append(...children){for(const child of children){child.parentNode=this;this.childNodes.push(child);}}
  replaceChildren(...children){this.childNodes=[];this._text='';this.append(...children);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  addEventListener(type,listener){
    if(!this.listeners.has(type))this.listeners.set(type,[]);
    this.listeners.get(type).push(listener);
  }
  dispatchEvent(event){
    event.target=this;
    for(const listener of this.listeners.get(event.type)??[])listener(event);
    return !event.defaultPrevented;
  }
  requestSubmit(){
    assert.equal(this.tagName,'FORM');
    this.dispatchEvent(new EventStub('submit'));
  }
  click(){
    if(this.disabled)return;
    if(!this.dispatchEvent(new EventStub('click')))return;
    if(this.tagName==='BUTTON'&&this.type==='submit'){
      let owner=this.parentNode;
      while(owner&&owner.tagName!=='FORM')owner=owner.parentNode;
      owner?.requestSubmit();
    }
  }
  focus(){this.document.activeElement=this;}
}
function descendants(root){return [root,...root.childNodes.flatMap(descendants)];}
function renderWithDom(document){
  const source=readFileSync(new URL('../src/cookie-vault.ts',import.meta.url),'utf8');
  const replacements=[
    [/^type Api = .*;\r?\n/m,''],
    [/^type CookieRecord=.*;\r?\n/m,''],
    ["function node<K extends keyof HTMLElementTagNameMap>(tag:K,copy=''):HTMLElementTagNameMap[K]","function node(tag,copy='')"],
    ['function iconButton(name:string,label:string):HTMLButtonElement','function iconButton(name,label)'],
    ['function utf8Base64(content:Uint8Array):string','function utf8Base64(content)'],
    ['function safeSite(value:string):string|null','function safeSite(value)'],
    ['export function renderCookieVault(host:HTMLElement,api:Api):void','function renderCookieVault(host,api)'],
    ['function wrap(text:string,input:HTMLElement)','function wrap(text,input)'],
    ['let records:CookieRecord[]=[]','let records=[]'],
    ['let selected:string|null=null','let selected=null'],
    ['new Map<string,HTMLButtonElement>()','new Map()'],
    ['function selectEntry(filename:string|null)','function selectEntry(filename)'],
    ['async function refresh():Promise<boolean>','async function refresh()'],
    ["api<CookieRecord[]>('/cookies')","api('/cookies')"],
    ['function move(offset:number)','function move(offset)'],
    ['function setWorking(value:boolean)','function setWorking(value)'],
  ];
  let javascript=source;
  for(const [from,to] of replacements){
    if(typeof from==='string')assert.ok(javascript.includes(from),`Missing TypeScript syntax: ${from}`);
    else assert.match(javascript,from);
    javascript=javascript.replace(from,to);
  }
  return runInNewContext(`${javascript}\nrenderCookieVault`,{
    document,TextEncoder,TextDecoder,Uint8Array,btoa,
  });
}
function mount(initial=[]){
  const document={activeElement:null};
  document.createElement=tag=>new ElementStub(tag,document);
  document.createTextNode=text=>{const el=new ElementStub('#text',document);el.textContent=text;return el;};
  const host=document.createElement('div');
  const calls=[];
  const saved=initial.map(name=>({filename:name+'.txt',size_bytes:65}));
  const api=async(path,method='GET',payload)=>{
    calls.push({path,method,payload});
    if(path==='/cookies'&&method==='GET')return saved.map(entry=>({...entry}));
    const match=/^\/cookies\/(.+\.txt)$/.exec(path);
    if(!match)throw Error(`Unexpected API call: ${method} ${path}`);
    const filename=decodeURIComponent(match[1]);
    if(method==='PUT'){
      assert.equal(typeof payload.content_base64,'string');
      if(!saved.some(entry=>entry.filename===filename))saved.push({filename,size_bytes:65});
      return {};
    }
    if(method==='DELETE'){
      const index=saved.findIndex(entry=>entry.filename===filename);
      if(index<0)throw Error(`Unknown cookie file: ${filename}`);
      saved.splice(index,1);return {};
    }
    throw Error(`Unexpected API call: ${method} ${path}`);
  };
  renderWithDom(document)(host,api);
  const find=predicate=>descendants(host).find(predicate);
  const button=name=>find(el=>el.tagName==='BUTTON'&&el.getAttribute('aria-label')===name);
  const row=name=>button('Select site cookies for '+name);
  const order=()=>descendants(host).filter(el=>el.tagName==='BUTTON'&&el.getAttribute('role')==='option')
    .map(el=>el.childNodes[0].textContent);
  return {host,document,calls,saved,find,button,row,order,
    site:find(el=>el.tagName==='INPUT'&&el.placeholder==='example.com'),
    paste:find(el=>el.tagName==='TEXTAREA'),
    upload:find(el=>el.tagName==='INPUT'&&el.type==='file'),
    feedback:find(el=>el.getAttribute('role')==='status'),
  };
}
const content='# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tFALSE\t2147483647\tsid\tvalue\n';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('DOM stub distinguishes button, submit click, and requestSubmit',()=>{
  const document={activeElement:null};
  const form=new ElementStub('form',document);
  const button=new ElementStub('button',document);form.append(button);
  let submits=0;
  form.addEventListener('submit',event=>{event.preventDefault();submits++;});
  button.type='button';button.click();assert.equal(submits,0);
  button.type='submit';button.click();assert.equal(submits,1);
  form.requestSubmit();assert.equal(submits,2);
});

test('clicking + and rendered Save stores Netscape cookies and selects the new row',async()=>{
  const view=mount(['prior.com']);await tick();
  view.row('prior.com').click();assert.equal(view.site.value,'prior.com');
  view.button('Add site cookies').click();
  assert.equal(view.site.value,'');assert.equal(view.document.activeElement,view.site);
  assert.equal(view.button('Remove selected site cookies').disabled,true);
  view.site.value='example.com';view.paste.value=content;
  const save=view.button('Save site cookies');assert.equal(save.type,'submit');save.click();
  await tick();
  const put=view.calls.find(call=>call.method==='PUT');
  assert.ok(put,'Clicking Save must invoke PUT');
  assert.equal(put.path,'/cookies/example.com.txt');
  assert.equal(Buffer.from(put.payload.content_base64,'base64').toString('utf8'),content);
  assert.equal(view.feedback.textContent,'Cookies stored for example.com.');
  assert.equal(view.row('example.com').getAttribute('aria-selected'),'true');
  assert.equal(view.paste.value,'');assert.equal(view.upload.value,'');
  const reload=mount(view.saved.map(entry=>entry.filename.slice(0,-4)));await tick();
  assert.ok(reload.row('example.com'),'Saved site remains listed on reload');
});

test('clicking − deletes only selected site and selects next row',async()=>{
  const view=mount(['first.com','second.com']);await tick();
  assert.equal(view.button('Remove selected site cookies').disabled,true);
  view.row('first.com').click();
  assert.equal(view.button('Remove selected site cookies').disabled,false);
  view.button('Remove selected site cookies').click();await tick();
  assert.deepEqual(view.calls.filter(call=>call.method==='DELETE').map(call=>call.path),['/cookies/first.com.txt']);
  assert.deepEqual(view.order(),['second.com']);
  assert.equal(view.site.value,'second.com');
  assert.equal(view.row('second.com').getAttribute('aria-selected'),'true');
});

test('▲ and ▼ reorder selected row only within the current session',async()=>{
  const view=mount(['first.com','second.com','third.com']);await tick();
  assert.equal(view.button('Move selected site cookies up').disabled,true);
  view.row('second.com').click();
  view.button('Move selected site cookies up').click();
  assert.deepEqual(view.order(),['second.com','first.com','third.com']);
  const reload=mount(['first.com','second.com','third.com']);await tick();
  assert.deepEqual(reload.order(),['first.com','second.com','third.com']);
  assert.equal(view.button('Move selected site cookies up').disabled,true);
  view.button('Move selected site cookies down').click();
  assert.deepEqual(view.order(),['first.com','second.com','third.com']);
  assert.equal(view.row('second.com').getAttribute('aria-selected'),'true');
  assert.deepEqual(view.calls.filter(call=>call.method!=='GET'),[]);
  view.button('Move selected site cookies up').click();
  view.paste.value=content;view.button('Save site cookies').click();await tick();
  assert.deepEqual(view.order(),['second.com','first.com','third.com'],
    'Refreshing after Save preserves the session-only order');
});

test('clicking Reset deletes every saved cookie and returns to empty vault',async()=>{
  const view=mount(['first.com','second.com']);await tick();
  view.row('first.com').click();
  // Reset is a full-width text button, not a symbol button.
  const reset=view.find(el=>el.tagName==='BUTTON'&&el.textContent==='Reset cookies to default');
  assert.ok(reset);reset.click();
  await tick();
  assert.deepEqual(view.calls.filter(call=>call.method==='DELETE').map(call=>call.path),[
    '/cookies/first.com.txt','/cookies/second.com.txt',
  ]);
  assert.deepEqual(view.order(),[]);
  assert.match(view.host.textContent,/Not set — no site cookies saved\./);
  assert.equal(view.site.value,'');assert.equal(view.button('Remove selected site cookies').disabled,true);
});

test('save accepts uploaded Netscape content and rejects invalid pasted text',async()=>{
  const view=mount();await tick();
  view.button('Add site cookies').click();
  view.site.value='example.com';
  view.upload.files=[{arrayBuffer:async()=>new TextEncoder().encode(content).buffer}];
  view.button('Save site cookies').click();await tick();
  assert.equal(view.calls.filter(call=>call.method==='PUT').length,1);
  view.row('example.com').click();view.paste.value='not a cookie file';
  view.button('Save site cookies').click();await tick();
  assert.equal(view.feedback.textContent,'Provide cookies.txt in Netscape format.');
  assert.equal(view.calls.filter(call=>call.method==='PUT').length,1);
});
