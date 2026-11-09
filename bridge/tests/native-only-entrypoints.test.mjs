import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const bridge=readFileSync(new URL('../src/bridge.ts',import.meta.url),'utf8');
const dashboard=readFileSync(new URL('../src/dashboard.ts',import.meta.url),'utf8');
const library=readFileSync(new URL('../src/library.ts',import.meta.url),'utf8');
const settings=readFileSync(new URL('../src/settings.ts',import.meta.url),'utf8');

test('all user journeys stay inside Nextcloud native pages',()=>{
  for(const source of [bridge,dashboard]){
    assert.match(source,/\/apps\/downloader_bridge\/library/);
    assert.doesNotMatch(source,/window\.open\(['"]https?:\/\//);
  }
  assert.match(library,/\/settings\/user\/downloader/);
  assert.match(settings,/\/settings\/user\/security/);
});
test('all browser clients consume signed user API with no Core token or address inputs',()=>{
  for(const source of [dashboard,bridge,library,settings]){
    assert.match(source,/app_api\/proxy\/downloader-server-nextcloud\/user\/api/);
    assert.doesNotMatch(source,/\bX-API-Key\b|\bAPP_API_TOKEN\b|\bDOWNLOADER_API_TOKEN\b/);
    assert.doesNotMatch(source,/localhost:8080|\/api\/v1\/jobs/);
  }
});
