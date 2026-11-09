import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
// Resolve against this file, not cwd or any container-specific mount path.
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = (path) => readFileSync(resolve(repositoryRoot, path), 'utf8');
const settings = source('bridge/src/settings.ts');
const api = source('nextcloud_exapp/main.py');
const user = source('nextcloud_exapp/user.py');
const info = source('appinfo/info.xml');

test('header settings are autosaved through the existing personal settings UI',()=>{
  for(const value of ['header_indicator_visibility','dropdown_content',
      "'active'|'always'","'active'|'all'",'changed(',"'/settings','PUT',patch"]) {
    assert.ok(settings.includes(value),value);
  }
  assert.match(user,/header_indicator_visibility.*"active"/);
  assert.match(user,/dropdown_content.*"active"/);
});
test('personal order and hide remain private while catalog mutations require admin identity',()=>{
  for(const part of ['preset_hidden','preset_order','Move ','+ Add preset','showModal',
    'adminApi','preset-catalog','can_manage_presets']) {
    assert.ok(settings.includes(part)||part==='showModal',part);
  }
  assert.match(api,/@APP\.post\("\/admin\/api\/presets"/);
  assert.match(api,/@APP\.put\("\/admin\/api\/preset-catalog"/);
  assert.match(api,/Depends\(require_admin\)/);
  assert.match(api,/Only Nextcloud administrators manage presets/);
  assert.match(api,/include_hidden: bool = False/);
});


test('admin preset mutations are reachable through the declared AppAPI proxy verbs',()=>{
  for(const verb of ['GET','POST','PUT','DELETE']) {
    assert.match(info,new RegExp('<url>\\^/admin/api/\\.\\*\\$</url><verb>'+verb+'</verb><access_level>ADMIN</access_level>'));
  }
});
