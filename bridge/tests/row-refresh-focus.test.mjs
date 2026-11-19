import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const library=readFileSync(new URL('../src/library.ts',import.meta.url),'utf8');
const header=readFileSync(new URL('../src/bridge.ts',import.meta.url),'utf8');

test('Library and header use the same row refresh state helper',()=>{
  for(const source of [library,header]){
    assert.match(source,/captureRowState\(/);
    assert.match(source,/restoreRowState\(/);
  }
  assert.match(library,/\.library-row','\.library-overflow'/);
  assert.match(header,/\.dl-job',null/);
});

test('real browser retains menu action, open menu and scroll during refresh',async t=>{
  const browser=['google-chrome','google-chrome-stable','chromium','chromium-browser']
    .find(name=>{const r=spawnSync(name,['--version'],{encoding:'utf8'});
      return !r.error&&r.status===0;});
  if(!browser){
    if(process.env.GITHUB_ACTIONS==='true') assert.fail('Chrome required for focus regression in CI');
    t.skip('Chrome not installed');return;
  }
  const {build}=await import('esbuild');
  const built=await build({entryPoints:[
    fileURLToPath(new URL('../src/row-refresh-state.mjs',import.meta.url)),
  ],bundle:true,format:'iife',globalName:'RowRefresh',write:false,platform:'browser'});
  const bundle=built.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
  function exercise(){
    const list=document.getElementById('list');
    const search=document.getElementById('search');
    const makeRow=(id,name)=>'<article class="row" data-job-id="'+id+'">'+
      '<button class="title">'+name+'</button>'+
      '<details class="menu"><summary>More actions</summary>'+
      '<button aria-label="Remove from history">Remove</button></details></article>';
    list.innerHTML=makeRow('a','Video A')+makeRow('b','Video B')+makeRow('c','Video C');
    const menu=list.querySelector('.menu');menu.open=true;
    const remove=list.querySelector('[aria-label="Remove from history"]');
    remove.focus();list.scrollTop=45;
    const first=RowRefresh.captureRowState(list,'.row','.menu');
    list.innerHTML=makeRow('a','Video A (completed)')+makeRow('b','Video B')+makeRow('c','Video C');
    RowRefresh.restoreRowState(list,first,'.row','.menu',search);
    const keptMenu=list.querySelector('.menu').open;
    const keptAction=document.activeElement.getAttribute('aria-label')==='Remove from history';
    const keptScroll=list.scrollTop===first.scroll&&first.scroll>0;
    const later=RowRefresh.captureRowState(list,'.row','.menu');
    list.innerHTML=makeRow('b','Video B')+makeRow('c','Video C');
    RowRefresh.restoreRowState(list,later,'.row','.menu',search);
    const removedFallback=document.activeElement===search;
    const header=document.getElementById('header');
    header.innerHTML='<article class="job" data-job-id="h">'+
      '<a href="#">Example</a><button aria-label="Pause this download">Pause</button></article>';
    header.querySelector('button').focus();
    const headerState=RowRefresh.captureRowState(header,'.job',null);
    header.innerHTML='<article class="job" data-job-id="h">'+
      '<a href="#">Example</a><button aria-label="Resume this download">Resume</button></article>';
    RowRefresh.restoreRowState(header,headerState,'.job',null,search);
    const changedStateFocused=document.activeElement.getAttribute('aria-label')==='Resume this download';
    document.body.dataset.result=encodeURIComponent(JSON.stringify({
      keptMenu,keptAction,keptScroll,removedFallback,changedStateFocused,
    }));
  }
  const html=['<!doctype html><html><head><style>#list{overflow:auto;height:40px}',
    '.row{height:54px}</style></head><body><input id="search">',
    '<div id="list"></div><div id="header"></div>',
    '<script>',bundle,'</script>','<script>(',exercise.toString(),')()</script></body></html>'].join('');
  const dir=mkdtempSync(join(tmpdir(),'downloader-row-focus-'));
  try{
    const fixture=join(dir,'index.html');writeFileSync(fixture,html);
    const result=spawnSync(browser,['--headless=new','--no-sandbox',
      '--disable-dev-shm-usage','--disable-gpu','--disable-background-networking',
      '--virtual-time-budget=1000','--dump-dom','file://'+fixture],
      {encoding:'utf8',maxBuffer:4*1024*1024,timeout:20000});
    assert.equal(result.status,0,result.stderr);
    const match=result.stdout.match(/data-result="([^"]+)"/);
    assert.ok(match,'Missing browser focus measurements');
    const state=JSON.parse(decodeURIComponent(match[1]));
    for(const [key,value]of Object.entries(state)) assert.equal(value,true,key);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
