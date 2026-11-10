import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const js=readFileSync(new URL('../src/settings.ts',import.meta.url),'utf8');
const form=readFileSync(new URL('../lib/Settings/PersonalSettings.php',import.meta.url),'utf8');
const section=readFileSync(new URL('../lib/Settings/PersonalSection.php',import.meta.url),'utf8');
const xml=readFileSync(new URL('../appinfo/info.xml',import.meta.url),'utf8');

test('personal forms render within Nextcloud profile settings and enforce entitlement',()=>{
  assert.match(xml,/<personal>OCA\\DownloaderBridge\\Settings\\PersonalSettings<\/personal>/);
  assert.match(xml,/<personal-section>OCA\\DownloaderBridge\\Settings\\PersonalSection<\/personal-section>/);
  assert.match(form,/implements ISettings/);
  assert.match(form,/EntitlementPolicy::allows/);
  assert.match(section,/implements IIconSection/);
  assert.match(form,/Util::addScript\(Application::APP_ID, 'settings'\)/);
});
test('personal settings cards avoid exposing service API keys or preset controls',()=>{
  for(const part of ['Where your downloads go','Files connection','Notifications',
    'Browse my Files folders','Default download quality','Notify me when a download finishes',
    'Notify me if a download fails','Saved ✓ Changes apply to new downloads.',
    'Advanced — technical engine settings','Connect my Files']){
    assert.ok(js.includes(part),part);
  }
  assert.doesNotMatch(js,/preset/i);
  assert.match(js,/queue|changed\(/);
  assert.match(js,/\/folders\?/);
  assert.doesNotMatch(js,/X-API-Key|DOWNLOADER_API_TOKEN|\bapi_key\b/);
  const beforeAdvanced=js.slice(0,js.indexOf("Advanced — technical engine settings"));
  assert.doesNotMatch(beforeAdvanced,/Engine settings JSON/);
});
test('password is submitted only through deliberate form and never in autosave patch',()=>{
  assert.match(js,/\/settings','PUT',\{app_password:secret\}/);
  assert.match(js,/dirty\[key\]=value/);
  assert.doesNotMatch(js,/dirty\['app_password'\]/);
  assert.match(js,/password\.value=''/);
  assert.match(js,/role','status'/);
});

test('typed content destination paths validate existence and keep invalid text visible',()=>{
  const routes=js.slice(js.indexOf("const routes=card("),js.indexOf("const collisions=card("));
  assert.match(routes,/const field=element\('input'\)/);
  assert.doesNotMatch(routes,/field.readOnly=true/);
  assert.match(routes,/field.addEventListener\('change'/);
  assert.match(routes,/api<FolderList>\('\/folders\?'/);
  assert.match(routes,/if\(page.path!==path\)/);
  assert.match(routes,/role','alert'/);
  assert.match(routes,/Folder not found in your Files/);
  assert.match(routes,/Never revert the text/);
  assert.match(routes,/changed\('destination_routes',\{\[kind\]:path\}\)/);
});
