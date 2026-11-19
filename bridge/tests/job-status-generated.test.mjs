import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ALL_JOB_STATES,TERMINAL_JOB_STATES,isTerminalJobState,isKnownJobState} from '../src/job-states.generated.mjs';

for(const file of ['bridge.ts','dashboard.ts','library.ts']){
  test(file+' uses the generated Core terminal predicate',()=>{
    const src=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
    assert.match(src,/isTerminalJobState\(job\.status\)/);
    assert.doesNotMatch(src,/new Set\(\['completed', 'failed', 'cancelled'\]\)/);
    assert.doesNotMatch(src,/\['completed','failed','cancelled'\]\.includes/);
  });
}
test('known/terminal module rejects unrecognized statuses and non-string inputs',()=>{
  assert.equal(new Set(ALL_JOB_STATES).size,ALL_JOB_STATES.length);
  for(const status of ALL_JOB_STATES){
    assert.equal(isKnownJobState(status),true);
    assert.equal(isTerminalJobState(status),TERMINAL_JOB_STATES.has(status));
  }
  assert.equal(isKnownJobState('skipped'),true);
  assert.equal(isTerminalJobState('skipped'),true);
  for(const unknown of [null,0,{},'COMPLETED','',undefined,'not-a-core-state']){
    assert.equal(isKnownJobState(unknown),false);
    assert.equal(isTerminalJobState(unknown),false);
  }
});
