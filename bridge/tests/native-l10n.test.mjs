import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {downloadStatus, downloadTitle, downloadBubbleStatus, DOWNLOAD_QUEUED_MESSAGE} from '../src/download-labels.mjs';

const catalog=JSON.parse(readFileSync(new URL('../l10n/he.json', import.meta.url), 'utf8'));
const javascript=readFileSync(new URL('../l10n/he.js', import.meta.url), 'utf8');
const labels=readFileSync(new URL('../src/download-labels.mjs', import.meta.url), 'utf8');

test('Nextcloud Hebrew JavaScript and PHP catalog forms are identical',()=>{
  let browserCatalog;
  const sandbox={OC:{L10N:{register:(app,translations,pluralForm)=>{
    assert.equal(app,'downloader_bridge');
    browserCatalog={translations,pluralForm};
  }}}};
  vm.runInNewContext(javascript,sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(browserCatalog)), catalog);
  for(const match of labels.matchAll(/t\('downloader_bridge', '([^']+)'/g)){
    assert.equal(typeof catalog.translations[match[1]],'string',
      'Translation missing for: '+match[1]);
  }
});

test('shared status labels use native user-language translation when provided',()=>{
  const previous=globalThis.t;
  try {
    globalThis.t=(app,source,replacements={})=>{
      assert.equal(app,'downloader_bridge');
      return (catalog.translations[source]||source)
        .replace(/\{(\w+)\}/g,(_,name)=>replacements[name]??'{'+name+'}');
    };
    const source={id:'a',status:'queued',url:'https://example.org/video'};
    assert.equal(downloadStatus(source),'ממתין בתור');
    assert.equal(downloadStatus({...source,status:'failed',error:'No connection'}),'ההורדה נכשלה — No connection');
    assert.equal(downloadStatus({...source,status:'downloading'}),'בהורדה');
    assert.equal(downloadBubbleStatus({...source,status:'paused'}),'מושהה');
    assert.equal(downloadTitle({id:'a',status:'queued',url:'not-a-url'}),'הורדה');
  } finally {
    if(previous===undefined) delete globalThis.t;
    else globalThis.t=previous;
  }
  assert.equal(DOWNLOAD_QUEUED_MESSAGE,'Download queued. Follow progress in Downloads.');
});

test('release packaging includes matching catalogs for PHP and JavaScript',()=>{
  const release=readFileSync(new URL('../../.github/workflows/bridge-package.yml',import.meta.url),'utf8');
  const deploy=readFileSync(new URL('../../.github/workflows/appapi-docker-deploy-e2e.yml',import.meta.url),'utf8');
  assert.match(release,/cp -a bridge\/appinfo bridge\/lib bridge\/js bridge\/templates bridge\/l10n/);
  assert.match(deploy,/cp -a bridge\/appinfo bridge\/lib bridge\/js bridge\/templates bridge\/l10n/);
});
