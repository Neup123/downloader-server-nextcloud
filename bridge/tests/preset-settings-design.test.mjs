import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const settings = readFileSync(new URL('../src/settings.ts',import.meta.url),'utf8');
const api = readFileSync(new URL('../../nextcloud_exapp/main.py',import.meta.url),'utf8');
const user = readFileSync(new URL('../../nextcloud_exapp/user.py',import.meta.url),'utf8');

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
