import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const dialog=readFileSync(new URL('../src/link-first-dialog.mjs',import.meta.url),'utf8');

test('shared link-first dialog is blocked while Files readiness is unknown or missing',()=>{
  assert.match(dialog,/let filesConnection='checking'/);
  assert.match(dialog,/value\?\.app_password_configured===true/);
  assert.match(dialog,/filesConnection='ready'/);
  assert.match(dialog,/filesConnection='missing'/);
  assert.match(dialog,/filesConnection='unavailable'/);
  assert.match(dialog,/filesConnection==='ready'/);
  assert.match(dialog,/download\.disabled=!available\(\)/);
});

test('a failing settings request cannot silently fall back to submitting a job',()=>{
  assert.match(dialog,/const settings=api\('\/settings'\)\.then\(value=>/);
  assert.match(dialog,/\.catch\(\(\)=>\{/);
  assert.match(dialog,/Could not check your Files connection/);
  assert.match(dialog,/Open Downloader settings/);
  assert.match(dialog,/\/settings\/user\/downloader/);
  assert.match(dialog,/aria-live','polite'/);
});

test('failed submissions offer distinct next steps and retain link and selections',()=>{
  assert.match(dialog,/Your Nextcloud Files connection needs attention/);
  assert.match(dialog,/The destination folder is unavailable/);
  assert.match(dialog,/not available for this account/);
  assert.match(dialog,/Your link and selections were kept/);
  assert.doesNotMatch(dialog,/message\(error instanceof Error\?error.message/);
  assert.match(dialog,/await api\('\/jobs','POST',body\)/);
});
