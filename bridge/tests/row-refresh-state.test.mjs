import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const library=readFileSync(new URL('../src/library.ts',import.meta.url),'utf8');
const bridge=readFileSync(new URL('../src/bridge.ts',import.meta.url),'utf8');
const helper=readFileSync(new URL('../src/row-refresh-state.mjs',import.meta.url),'utf8');

test('Library and header refresh both reuse one focus/scroll-preservation contract',()=>{
  assert.match(library,/captureRowState\(list,'\.library-row','\.library-overflow'\)/);
  assert.match(library,/restoreRowState\(list,interaction,'\.library-row','\.library-overflow',search\)/);
  assert.match(bridge,/captureRowState\(list,'\.dl-job',null\)/);
  assert.match(bridge,/restoreRowState\(list,interaction,'\.dl-job',null,button\)/);
  assert.match(helper,/focusId/);
  assert.match(helper,/openIds/);
  assert.match(helper,/fallback\?\.focus/);
});

test('real Chromium retains focused action through two refreshes and recovers on row removal',t=>{
  const candidates=['google-chrome','google-chrome-stable','chromium','chromium-browser'];
  const executable=candidates.find(name=>{
    const result=spawnSync(name,['--version'],{encoding:'utf8'});
    return !result.error&&result.status===0;
  });
  if(!executable){
    if(process.env.GITHUB_ACTIONS==='true')assert.fail('Chromium required for CI UI focus acceptance');
    t.skip('Chromium not available locally');return;
  }
  const script=helper.replace(/export function /g,'function ');
  const html=`<!doctype html><html><head><meta charset="utf-8">
  <style>#list{height:48px;width:320px;overflow-y:auto}article{height:64px}button{font-size:12px}</style>
  </head><body><input id="search" value=""><div id="list"></div><script>${script}
    const list=document.getElementById('list'),search=document.getElementById('search');
    function row(id,status){
      const el=document.createElement('article');el.className='library-row';el.dataset.jobId=id;
      const menu=document.createElement('details');menu.className='library-overflow';
      const summary=document.createElement('summary');summary.textContent='More actions';
      const button=document.createElement('button');button.textContent='View details';
      button.setAttribute('aria-label','View details');
      const label=document.createElement('span');label.textContent=status;
      menu.append(summary,button);el.append(label,menu);return el;
    }
    list.replaceChildren(row('a','downloading'),row('b','downloading'));
    list.querySelector('details').open=true;
    const focus=list.querySelector('button');focus.focus();list.scrollTop=22;
    const result=[];
    for(const status of ['downloading','completed']){
      const state=captureRowState(list,'.library-row','.library-overflow');
      list.replaceChildren(row('a',status),row('b','queued'));
      restoreRowState(list,state,'.library-row','.library-overflow',search);
      result.push({focus:document.activeElement?.getAttribute('aria-label'),
        expanded:list.querySelector('details').open,scroll:list.scrollTop,
        status:list.querySelector('article span').textContent});
    }
    const state=captureRowState(list,'.library-row','.library-overflow');
    list.replaceChildren(row('b','completed'));
    restoreRowState(list,state,'.library-row','.library-overflow',search);
    result.push({fallback:document.activeElement===search});
    document.body.setAttribute('data-result',encodeURIComponent(JSON.stringify(result)));
  <\/script></body></html>`;
  const dir=mkdtempSync(join(tmpdir(),'downloader-focus-test-'));
  try{
    const file=join(dir,'index.html');writeFileSync(file,html);
    const result=spawnSync(executable,['--headless=new','--no-sandbox','--disable-dev-shm-usage',
      '--disable-gpu','--disable-background-networking','--dump-dom','file://'+file],
      {encoding:'utf8',timeout:20000,maxBuffer:8*1024*1024});
    assert.equal(result.status,0,result.stderr);
    const match=result.stdout.match(/data-result="([^"]+)"/);
    assert.ok(match,'Browser did not report focus state');
    const states=JSON.parse(decodeURIComponent(match[1]));
    assert.equal(states[0].focus,'View details');
    assert.equal(states[0].expanded,true);
    assert.equal(states[1].focus,'View details');
    assert.equal(states[1].status,'completed');
    assert.equal(states[1].expanded,true);
    assert.equal(states[2].fallback,true);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
