import test from 'node:test';
import assert from 'node:assert/strict';
import { firstDownloadVerified, showFirstRunGuide } from '../src/first-run.ts';

const ownJob = (status, verified=[]) => ({
  owner_id:'alice',status,output_files:verified.map(value=>({verified:value})),
});

test('first-run only counts completed jobs with all output files verified', () => {
  for (const [status,flags] of [
    ['queued',[]],['downloading',[]],['failed',[true]],
    ['completed',[]],['completed',[true,false]],['completed',[false]],
  ]) {
    assert.equal(firstDownloadVerified('alice',false,[ownJob(status,flags)]), false,
      'Unexpectedly accepted '+status+' '+flags);
  }
  assert.equal(firstDownloadVerified('alice',false,[ownJob('completed',[true,true])]),true);
});

test('other users never complete the signed owner guide', () => {
  const bob={owner_id:'bob',status:'completed',output_files:[{verified:true}]};
  assert.equal(firstDownloadVerified('alice',false,[bob]),false);
  assert.equal(firstDownloadVerified('',true,[bob]),false);
});

test('first-run guide persists until both steps complete then disappears', () => {
  const before=firstDownloadVerified('alice',false,[]);
  assert.equal(showFirstRunGuide('alice',false,before),true);
  assert.equal(showFirstRunGuide('alice',true,before),true);
  const after=firstDownloadVerified('alice',false,[ownJob('completed',[true])]);
  assert.equal(showFirstRunGuide('alice',true,after),false);
  assert.equal(showFirstRunGuide('alice',false,after),true);
  // History can be paginated away without re-showing a completed guide.
  assert.equal(showFirstRunGuide('alice',true,firstDownloadVerified('alice',true,[])),false);
  assert.equal(showFirstRunGuide('',false,false),false);
});
