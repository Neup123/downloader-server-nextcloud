import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extendFolderResults} from '../src/folder-picker-pages.mjs';

const source=readFileSync(new URL('../src/settings.ts',import.meta.url),'utf8');

test('150 folders load as two pages without dropping the initial 100',()=>{
  const rows=Array.from({length:150},(_,i)=>({
    name:'Folder '+String(i+1).padStart(3,'0'),
    path:'Photos/Folder '+String(i+1).padStart(3,'0'),
  }));
  const first=extendFolderResults([],{
    path:'Photos',offset:0,has_more:true,folders:rows.slice(0,100),
  },'Photos',0,false);
  assert.equal(first.length,100);
  const second=extendFolderResults(first,{
    path:'Photos',offset:100,has_more:false,folders:rows.slice(100),
  },'Photos',100,true);
  assert.equal(second.length,150);
  assert.deepEqual(second.slice(0,100),first);
  assert.deepEqual(second.slice(100),rows.slice(100));
});

test('pagination rejects unrelated folder and offset responses and deduplicates',()=>{
  const rows=[{name:'A',path:'A'}];
  const page={path:'',offset:0,has_more:false,folders:rows};
  assert.deepEqual(extendFolderResults([],page,'',0,false),rows);
  assert.deepEqual(extendFolderResults(rows,page,'',0,true),rows);
  assert.throws(()=>extendFolderResults(rows,page,'Other',0,true),/did not match/);
  assert.throws(()=>extendFolderResults(rows,page,'',100,true),/did not match/);
});

test('folder picker appends rows in place and keeps a retryable More control',()=>{
  assert.match(source,/extendFolderResults\(listedFolders,page,path,offset,append\)/);
  assert.match(source,/listedFolders\.slice\(previousCount\)/);
  assert.match(source,/folderList!\.append\(li\)/);
  assert.match(source,/moreButton\.disabled=true/);
  assert.match(source,/Retry loading more folders/);
  assert.match(source,/token!==pickerGeneration/);
  assert.doesNotMatch(source,/openFolder\(page\.path,page\.offset\+100\);/);
});
