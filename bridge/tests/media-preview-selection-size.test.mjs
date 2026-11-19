import test from 'node:test';
import assert from 'node:assert/strict';
import {previewRows,previewSelectionSummary} from '../src/link-first-dialog.mjs';

const rows=previewRows({entries:[
  {index:1,title:'Exact',size_bytes:1048576},
  {index:2,title:'Approximate',size_estimate_bytes:2097152},
  {index:3,title:'Unknown'},
  {index:4,title:'Invalid',size_bytes:-1,size_estimate_bytes:Infinity},
]});

test('Core size metadata is normalized and invalid byte sizes remain missing',()=>{
  assert.equal(rows.length,4);
  assert.equal(rows[0].size_bytes,1048576);
  assert.equal(rows[1].size_estimate_bytes,2097152);
  assert.equal(rows[2].size_bytes,null);
  assert.equal(rows[3].size_bytes,null);
  assert.equal(rows[3].size_estimate_bytes,null);
});

test('non-torrent playlist/gallery selection distinguishes exact, approximate and missing bytes',()=>{
  assert.equal(previewSelectionSummary(rows,new Set()),'0 of 4 selected · 0 B selected');
  assert.equal(previewSelectionSummary(rows,new Set([1])),'1 of 4 selected · 1.0 MiB for 1 sized item');
  assert.equal(previewSelectionSummary(rows,new Set([2])),'1 of 4 selected · About 2.0 MiB for 1 sized item');
  assert.equal(previewSelectionSummary(rows,new Set([3])),'1 of 4 selected · size unknown for 1 item');
  assert.equal(previewSelectionSummary(rows,new Set([1,2,3])),'3 of 4 selected · About 3.0 MiB for 2 sized items · size unknown for 1 item');
  assert.equal(previewSelectionSummary(rows,new Set([1,3,4])),'3 of 4 selected · 1.0 MiB for 1 sized item · size unknown for 2 items');
});

test('summaries are recomputed from selected indices, not current filter visibility',()=>{
  assert.match(previewSelectionSummary(rows,new Set([1,2,3,4])),/4 of 4 selected/);
  assert.match(previewSelectionSummary(rows,new Set([2])),/1 of 4 selected/);
});
