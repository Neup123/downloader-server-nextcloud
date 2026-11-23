import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {filesJobRequest} from '../src/files-dialog-payload.mjs';

const dialog=readFileSync(new URL('../src/link-first-dialog.mjs',import.meta.url),'utf8');
const key='550e8400-e29b-41d4-a716-446655440000';

test('signed plugin request can carry one stable UUIDv4 and does not leak it otherwise',()=>{
  const one=filesJobRequest('https://example.org/video',null,'best',false,{submissionId:key});
  const two=filesJobRequest('https://example.org/video',null,'best',false,{submissionId:key});
  assert.equal(one.submission_id,key);
  assert.deepEqual(one,two);
  assert.equal(filesJobRequest('https://example.org/video',null).submission_id,undefined);
  assert.throws(()=>filesJobRequest('https://example.org/video',null,'best',false,
    {submissionId:'bad'}),/Invalid download retry identity/);
});

test('shared plugin dialog keeps the action UUID across retries but changes it for new choices',()=>{
  assert.match(dialog,/lastSubmissionPayload=null, lastSubmissionId=null/);
  assert.match(dialog,/const identity=JSON\.stringify\(body\)/);
  assert.match(dialog,/if\(identity!==lastSubmissionPayload\)/);
  assert.match(dialog,/lastSubmissionId=globalThis\.crypto\.randomUUID\(\)/);
  assert.match(dialog,/body\.submission_id=lastSubmissionId/);
  assert.match(dialog,/busy=true;refreshSubmit\(\)/);
});
