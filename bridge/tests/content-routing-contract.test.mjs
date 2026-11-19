import test from 'node:test';
import assert from 'node:assert/strict';
import contract from '../../nextcloud_exapp/content-routes.contract.json' with {type:'json'};
import {
  CONTENT_ROUTES, DEFAULT_FOLDER, SUPPORTED_SOURCE_KINDS,
  SOURCE_KIND_TO_ROUTE, contentCategoryFor,
} from '../src/content-routes.mjs';
import {filesJobRequest} from '../src/files-dialog-payload.mjs';

test('native plugin reads exactly the signed gateway content-route contract',()=>{
  assert.equal(DEFAULT_FOLDER,contract.default_folder);
  assert.deepEqual(CONTENT_ROUTES,contract.categories);
  const expected=Object.fromEntries(contract.categories.flatMap(
    category=>category.source_kinds.map(kind=>[kind,category.id])));
  assert.deepEqual(SOURCE_KIND_TO_ROUTE,expected);
  assert.deepEqual(new Set(SUPPORTED_SOURCE_KINDS),new Set(Object.keys(expected)));
});

test('every supported link-first content kind maps to the gateway-owned category',()=>{
  for(const kind of SUPPORTED_SOURCE_KINDS){
    const url=kind==='torrent'
      ? 'magnet:?xt=urn:btih:0123456789012345678901234567890123456789'
      : 'https://example.org/asset';
    const options={kind,selectedIndices:[1],cbz:false};
    const body=filesJobRequest(url,null,'best',false,options);
    assert.equal(body.content_type,SOURCE_KIND_TO_ROUTE[kind],kind);
    assert.equal(contentCategoryFor(kind),body.content_type);
    assert.equal(filesJobRequest(url,null,'best',true,options).content_type,'audio');
  }
});

test('an unrecognized category cannot be silently routed as video',()=>{
  assert.throws(()=>contentCategoryFor('synthetic-unknown-kind'),/Unsupported content type/);
  assert.throws(()=>filesJobRequest('https://example.org/asset',null,'best',false,
    {kind:'synthetic-unknown-kind'}),/Unsupported content type/);
  assert.equal(Object.hasOwn(SOURCE_KIND_TO_ROUTE,'synthetic-unknown-kind'),false);
});
