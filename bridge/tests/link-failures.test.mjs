import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  showLinkDialog, isValidSourceLink, classifyLinkFailure, linkFailureMessage,
} from '../src/link-first-dialog.mjs';

const dialogSource=readFileSync(new URL('../src/link-first-dialog.mjs',import.meta.url),'utf8');
const bridgeSource=readFileSync(new URL('../src/bridge.ts',import.meta.url),'utf8');

function fakeDocument() {
  function createElement(tagName) {
    const classNames=new Set();
    return {
      tagName, children: [], hidden: false, textContent: '',
      classList: {
        add(...names) { for(const name of names)classNames.add(name); },
        remove(...names) { for(const name of names)classNames.delete(name); },
        toggle(name,force) {
          const present=force===undefined ? !classNames.has(name) : Boolean(force);
          if(present)classNames.add(name);
          else classNames.delete(name);
          return present;
        },
      },
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; },
      setAttribute() {},
      addEventListener() {},
      querySelector() { return null; },
      showModal() {},
      focus() {},
      remove() {},
    };
  }
  return {createElement, body: createElement('body')};
}

async function detectedDialog(link, preview) {
  const previous=globalThis.document;
  globalThis.document=fakeDocument();
  try {
    const dialog=showLinkDialog({
      folder: null, suggested: link,
      api: path => path === '/settings'
        ? Promise.resolve({default_video_quality:'best', default_audio_quality:'best'})
        : preview(),
      notify: () => { throw new Error('Unexpected toast'); },
      queued: () => { throw new Error('Unexpected job'); },
    });
    // The detection starts immediately for a supplied link.
    await new Promise(resolve => setImmediate(resolve));
    const [, status, details, buttons]=dialog.children[0].children;
    return {status, details, buttons};
  } finally {
    globalThis.document=previous;
  }
}

test('malformed URL is classified before requesting Core', () => {
  for (const bad of [
    'example.com/video', 'not a link', 'https:example.com', 'https://',
    'ftp://example.com/video', 'https://user:secret@example.org/file',
  ]) {
    assert.equal(isValidSourceLink(bad),false,bad);
    assert.equal(classifyLinkFailure(bad,{httpStatus:422}),'malformed',bad);
  }
  assert.equal(isValidSourceLink('https://example.org/video'),true);
  assert.equal(isValidSourceLink('http://example.org/video'),true);
  assert.equal(isValidSourceLink('magnet:?xt=urn:btih:12345'),true);
  assert.equal(linkFailureMessage('malformed'),'Paste a valid HTTP(S) link or magnet URI.');
});

test('HTTP status and extractor text alone cannot prove a failure reason', () => {
  const cases=[
    // Core's generic 422 does not identify whether an extractor claims a host.
    ['https://no-claimed-engine.example/video', {httpStatus:422}],
    // A gateway 404 can mean a missing route, not a source-item 404.
    ['https://supported.example/deleted', {httpStatus:404}],
    // A successful HTTP page is not necessarily an inspectable media item.
    ['https://example.org/about', {httpStatus:422}],
    ['https://supported.example/video', {httpStatus:502}],
    ['https://supported.example/video', new Error('PRIVATE_RAW_ENGINE_ERROR')],
    ['https://supported.example/video', null],
  ];
  for (const [link, signal] of cases)
    assert.equal(classifyLinkFailure(link,signal),'could_not_check',link);
  assert.equal(linkFailureMessage('could_not_check'),'Could not check this link. Try again.');
});

for (const [reasonCode, expected, message] of [
  ['malformed_link', 'malformed', 'Paste a valid HTTP(S) link or magnet URI.'],
  ['unsupported_domain', 'unsupported_domain', 'This link is not supported. Try a direct file link or another media link.'],
  ['item_not_found', 'item_not_found', 'This link no longer exists. It may have been deleted or made private.'],
  ['not_media', 'not_media', 'Nothing downloadable was found at this link. Ordinary web pages cannot be downloaded here.'],
  ['could_not_check', 'could_not_check', 'Could not check this link. Try again.'],
]) {
  test(`reason_code ${reasonCode} produces only its corresponding explanation`, () => {
    const error=Object.assign(new Error('PRIVATE_RAW_ENGINE_ERROR'),{reasonCode,httpStatus:422});
    const reason=classifyLinkFailure('https://example.org/video',error);
    assert.equal(reason,expected);
    assert.equal(linkFailureMessage(reason),message);
  });
}

test('an absent reason_code falls back to could-not-check', () => {
  assert.equal(classifyLinkFailure('https://example.org/video',{httpStatus:422}),'could_not_check');
});
test('an unknown reason_code falls back to could-not-check', () => {
  assert.equal(classifyLinkFailure('https://example.org/video',
    {httpStatus:422,reasonCode:'PRIVATE_UNKNOWN_CLASS'}),'could_not_check');
});

test('malformed pasted text displays one explanation, without a second card', async () => {
  const {status,details,buttons}=await detectedDialog('not a URL',() => {
    throw new Error('Preview must not run for malformed input');
  });
  assert.equal(status.textContent,'Paste a valid HTTP(S) link or magnet URI.');
  assert.equal(status.hidden,false);
  assert.equal(details.hidden,true);
  assert.equal(details.children.length,0);
  assert.equal(buttons.hidden,true);
});

test('SoundCloud unsupported-domain code shows exactly one line without raw extractor text', async () => {
  const error=Object.assign(new Error('PRIVATE_RAW_ENGINE_ERROR: SoundCloud internal details'),
    {httpStatus:422,reasonCode:'unsupported_domain'});
  const {status,details,buttons}=await detectedDialog(
    'https://soundcloud.com/artist/deleted-track',() => Promise.reject(error),
  );
  assert.equal(status.textContent,'This link is not supported. Try a direct file link or another media link.');
  assert.equal(status.hidden,false);
  assert.equal(details.hidden,true);
  assert.equal(details.children.length,0);
  assert.equal(buttons.hidden,true);
  assert.doesNotMatch(status.textContent,/PRIVATE_RAW_ENGINE_ERROR|SoundCloud|Could not check/);
  assert.doesNotMatch(dialogSource,/Unsupported or unrecognized link/);
});

test('a failed check without a code shows only the retryable line', async () => {
  const error=Object.assign(new Error('PRIVATE_RAW_ENGINE_ERROR'),{httpStatus:422});
  const {status,details,buttons}=await detectedDialog(
    'https://soundcloud.com/artist/deleted-track',() => Promise.reject(error),
  );
  assert.equal(status.textContent,'Could not check this link. Try again.');
  assert.equal(status.hidden,false);
  assert.equal(details.hidden,true);
  assert.equal(details.children.length,0);
  assert.equal(buttons.hidden,true);
  assert.doesNotMatch(status.textContent,/PRIVATE_RAW_ENGINE_ERROR|not supported/);
});

test('an ambiguous successful preview cannot be relabeled as unsupported or not-media', async () => {
  const {status,details}=await detectedDialog('https://example.org/ordinary-page',
    () => Promise.resolve({kind:'unknown'}));
  assert.equal(status.textContent,'Could not check this link. Try again.');
  assert.equal(details.hidden,true);
  assert.equal(details.children.length,0);
});

test('a failed file-shaped link keeps only the direct-file action under the one explanation', async () => {
  const {status,details}=await detectedDialog('https://example.org/archive.zip',
    () => Promise.reject(Object.assign(new Error('RAW_404_SOURCE'),{httpStatus:404})));
  assert.equal(status.textContent,'Could not check this link. Try again.');
  assert.equal(details.hidden,false);
  assert.equal(details.children.length,1);
  assert.equal(details.children[0].tagName,'button');
  assert.equal(details.children[0].textContent,'Try as a direct file');
  assert.doesNotMatch(status.textContent,/RAW_404_SOURCE/);
});

test('verified direct-file result has no status line', async () => {
  const {status}=await detectedDialog('https://example.org/book.pdf',
    () => Promise.resolve({kind:'direct',filename:'book.pdf',mime:'application/pdf',size:128}));
  assert.equal(status.textContent,'');
  assert.equal(status.hidden,true);
});

test('bridge preserves structured preview HTTP status, not a raw Core error message', () => {
  assert.match(bridgeSource,/if \(path === '\/media-preview'\)/);
  assert.match(bridgeSource,/failure\.httpStatus = res\.status/);
  assert.match(bridgeSource,/detail\?\.reason_code/);
  assert.match(bridgeSource,/failure\.reasonCode = reasonCode/);
  assert.match(bridgeSource,/throw failure;/);
  assert.match(dialogSource,/classifyLinkFailure\(value,error\)/);
  assert.doesNotMatch(dialogSource,/message\(error\.message\)|message\(error instanceof Error/);
});