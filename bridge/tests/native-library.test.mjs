import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../src/library.ts', import.meta.url),'utf8');
const php = readFileSync(new URL('../lib/Controller/LibraryController.php', import.meta.url),'utf8');
const route = readFileSync(new URL('../appinfo/routes.php', import.meta.url),'utf8');

test('native Library belongs to Nextcloud and never loads standalone Core UI',()=>{
  assert.match(route,/library#index/);
  assert.match(php,/TemplateResponse/);
  assert.match(php,/EntitlementPolicy::allows/);
  assert.match(source,/\/apps\/app_api\/proxy\/downloader-server-nextcloud\/user\/api/);
  assert.doesNotMatch(source,/X-API-Key|DOWNLOADER_API_TOKEN|\/api\/v1\/jobs/);
});
test('Library exposes owner-only search, filter, pagination and native actions',()=>{
  for(const feature of ['Search downloads','Name or source link','All downloads',
    'Active','Delivered','Failed or cancelled','Show more downloads',
    'Retry all failed','Clear history','Files were not deleted','View details',
    'Open in Files','downloader-library-modal','dlg.showModal()']){
    assert.ok(source.includes(feature),feature);
  }
  assert.match(source,/URLSearchParams/);
  assert.match(source,/clear-history/);
  assert.match(source,/retry-failed/);
});
