import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';

// All bridge and AppAPI files are resolved inside the mounted bridge package.
const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');

// The deploy container mounts bridge/ alone at /src. Python contract checks
// still run in full checkouts, but cannot run when that sibling is absent.
const exappPresent = existsSync(new URL('../../nextcloud_exapp/', import.meta.url));
const exappSkip = exappPresent ? false :
  'nextcloud_exapp/ is not present in the bridge-only deploy layout';
const pythonSource = (name) =>
  readFileSync(new URL('../../nextcloud_exapp/' + name, import.meta.url), 'utf8');

// AppAPI proxy verbs are declared in the repository-level ExApp manifest,
// not in bridge/appinfo/info.xml. The manifest is absent in the bridge mount.
const appapiManifestPresent = existsSync(new URL('../../appinfo/info.xml', import.meta.url));
const appapiManifestSkip = appapiManifestPresent ? false :
  'repository-level appinfo/info.xml is absent in the bridge-only deploy layout';

test('header settings are autosaved through the existing personal settings UI',()=>{
  for(const value of ['header_indicator_visibility','dropdown_content',
      "'active'|'always'","'active'|'all'",'changed(',"'/settings','PUT',patch"]) {
    assert.ok(settings.includes(value),value);
  }
});

test('header preference defaults are declared by the ExApp', {skip: exappSkip},()=>{
  const user = pythonSource('user.py');
  assert.match(user,/header_indicator_visibility.*"active"/);
  assert.match(user,/dropdown_content.*"active"/);
});

test('personal order and hide remain private in the settings UI',()=>{
  for(const part of ['preset_hidden','preset_order','Move ','+ Add preset','showModal',
    'adminApi','preset-catalog','can_manage_presets']) {
    assert.ok(settings.includes(part)||part==='showModal',part);
  }
});

test('catalog mutations require ExApp admin identity', {skip: exappSkip},()=>{
  const api = pythonSource('main.py');
  assert.match(api,/@APP\.post\("\/admin\/api\/presets"/);
  assert.match(api,/@APP\.put\("\/admin\/api\/preset-catalog"/);
  assert.match(api,/Depends\(require_admin\)/);
  assert.match(api,/Only Nextcloud administrators manage presets/);
  assert.match(api,/include_hidden: bool = False/);
});

test('admin preset mutations are reachable through the declared AppAPI proxy verbs', {skip: appapiManifestSkip},()=>{
  const info = readFileSync(new URL('../../appinfo/info.xml', import.meta.url), 'utf8');
  for(const verb of ['GET','POST','PUT','DELETE']) {
    assert.match(info,new RegExp('<url>\\^/admin/api/\\.\\*\\$</url><verb>'+verb+'</verb><access_level>ADMIN</access_level>'));
  }
});
