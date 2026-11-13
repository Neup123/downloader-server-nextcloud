import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const js=readFileSync(new URL('../src/settings.ts',import.meta.url),'utf8');
const vault=readFileSync(new URL('../src/cookie-vault.ts',import.meta.url),'utf8');
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
  for(const part of ['Destination routing by content type','Default Files folder',
    'Files connection','Notifications','Default download quality','Notify me when a download finishes',
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

test('default Files folder is the first row of one compact routing group',()=>{
  const routing=js.slice(js.indexOf("const routes=card("),js.indexOf("const collisions=card("));
  assert.match(routing,/Files not routed by type use the default folder/);
  assert.equal((js.match(/const routes=card\(/g)||[]).length,1);
  assert.doesNotMatch(js,/card\('Where your downloads go'/);
  assert.doesNotMatch(js,/Browse my Files folders/);
  assert.match(routing,/routes\.classList\.add\('downloader-routing-card'\)/);
  assert.match(routing,/routes\.append\(list\)/);
  assert.ok(routing.indexOf("routeRow('downloader-route-default'")
    <routing.indexOf('for(const [kind,subfolder] of Object.entries(routeSubfolders))'));
  assert.match(routing,/routeRow\('downloader-route-default','Default Files folder',folder/);
  assert.match(routing,/video:'Video',audio:'Audio',images:'Images',manga:'Manga'/);
  assert.match(routing,/direct:'Direct files',torrent:'Torrents'/);
  assert.match(js,/downloader-settings-card\.downloader-routing-card\{grid-column:1\/-1;justify-self:start;width:max-content/);
  assert.match(js,/downloader-routing-list\{display:grid;grid-template-columns:max-content max-content max-content/);
});

test('every folder row uses adjacent icon buttons with full accessible tooltips',()=>{
  const routing=js.slice(js.indexOf("const routes=card("),js.indexOf("const collisions=card("));
  assert.match(js,/const FOLDER_SEARCH_ICON='<svg /);
  assert.match(js,/const RESET_ICON='<svg /);
  assert.match(js,/button\.title=name;button\.setAttribute\('aria-label',name\)/);
  assert.match(routing,/const browse=folderAction\('Choose folder'\)/);
  assert.match(routing,/const clear=folderAction\('Use default'\)/);
  assert.match(routing,/actions\.append\(browse,clear\);group\.append\(title,field,actions\)/);
  assert.match(js,/button\.downloader-folder-action\{width:32px;min-width:32px;height:32px;min-height:32px/);
  assert.doesNotMatch(routing,/element\('button','Choose folder'\)/);
  assert.doesNotMatch(routing,/element\('button','Use default'\)/);
});

test('folder fields size to their paths, not to the card or grid column',()=>{
  assert.match(js,/input\.downloader-route-field\{width:auto;min-width:0;max-width:min\(56ch,100%\)/);
  assert.match(js,/field\.size=Math\.max\(1,Math\.min\(56,field\.value\.length\+1\)\)/);
  assert.match(js,/field\.addEventListener\('input',\(\)=>\{\s*edited\+\+;\s*sizeFolderField\(field\)/);
  assert.match(js,/downloader-route-controls\{display:flex;align-items:center;gap:4px\}/);
  assert.match(js,/@media\(max-width:640px\)/);
});

test('folder reset, per-type overrides and inherited routes retain their saving contract',()=>{
  const routing=js.slice(js.indexOf("const routes=card("),js.indexOf("const collisions=card("));
  assert.match(routing,/setDefaultFolder\('Downloads'\)/);
  assert.match(routing,/changed\('destination_folder',path\)/);
  assert.match(routing,/if\(customRoutes\.has\(kind\)\)continue/);
  assert.match(routing,/const customRoutes=new Set\(Object\.keys\(data\.destination_route_overrides\|\|\{\}\)\)/);
  assert.match(routing,/customRoutes\.add\(kind\)/);
  assert.match(routing,/changed\('destination_routes',\{\[kind\]:path\}\)/);
  assert.match(routing,/customRoutes\.delete\(kind\)/);
  assert.match(routing,/changed\('destination_routes',\{\[kind\]:null\}\)/);
  assert.match(routing,/onFolderChosen=setDefaultFolder/);
  // The server's explicit starting-folder priority is tested by Python route-contract tests.
});

test('site cookie vault is mounted in Advanced settings with owner-scoped API and no secret rehydration',()=>{
  assert.match(js,/renderCookieVault\(advanced,api\)/);
  assert.match(vault,/Site cookies/);
  assert.match(vault,/Get cookies\.txt LOCALLY/);
  assert.match(vault,/cclelndahbckbenkjhflpdbgdldlbecc/);
  assert.match(vault,/effectively a password/);
  assert.match(vault,/older “Get cookies\.txt” extension/);
  assert.match(vault,/\/cookies'/);
  assert.match(vault,/content_base64:utf8Base64\(bytes\)/);
  assert.match(vault,/paste\.value=''/);
  assert.match(vault,/upload\.value=''/);
  assert.match(vault,/Remove site cookies/);
  assert.doesNotMatch(vault,/innerHTML|console\.|localStorage|sessionStorage/);
});

test('cookie status never falsely claims an unimplemented validation endpoint succeeded',()=>{
  assert.match(vault,/Saved · validity not tested/);
  assert.doesNotMatch(vault,/Test site cookies/);
  assert.doesNotMatch(vault,/Valid ✓|Cookies are valid/);
});
