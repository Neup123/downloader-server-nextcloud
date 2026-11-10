import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {filesJobRequest, selectedMediaFormat, playlistIndices} from '../src/files-dialog-payload.mjs';
import {classifyPreview, looksLikeDirectFile, chooseFiltered, previewRows} from '../src/link-first-dialog.mjs';

const source=readFileSync(new URL('../src/bridge.ts',import.meta.url),'utf8');
const dialog=readFileSync(new URL('../src/link-first-dialog.mjs',import.meta.url),'utf8');

test('folder and owner default are preserved without preset references',()=>{
  assert.deepEqual(filesJobRequest('https://example.org/video','Movies'),{
    url:'https://example.org/video',engine:'auto',folder:'Movies',
  });
  assert.deepEqual(filesJobRequest('https://example.org/file',null),{
    url:'https://example.org/file',engine:'auto',
  });
  assert.doesNotMatch(dialog,/preset_id|default_preset|presetEngine/);
  assert.match(source,/showLinkDialog\(\{folder, suggested, api, notify,/);
  assert.doesNotMatch(source,/window\.alert\(/);
});

test('link step has no Download control until detection, and signed Core preview is bounded',()=>{
  assert.match(dialog,/const line = e\('div', '', 'dl-link-line'\)/);
  assert.match(dialog,/spinner\.hidden=false/);
  assert.match(dialog,/url\.addEventListener\('input',schedule\)/);
  assert.match(dialog,/setTimeout\(\(\)=>\{void detect\(url\.value\);\},220\)/);
  assert.match(dialog,/buttons\.hidden=true/);
  assert.match(dialog,/max_entries:PAGE/);
  assert.match(dialog,/max_entries:MAX/);
  assert.match(dialog,/const download=e\('button','Download','dl-primary'\)/);
  assert.doesNotMatch(dialog,/e\('button','Confirm'/);
  assert.match(dialog,/await api\('\/jobs','POST',body\)/);
});

test('single-video quality, audio/music, subtitles and original container map correctly',()=>{
  assert.equal(selectedMediaFormat(),null);
  assert.equal(selectedMediaFormat('128',true),'bestaudio[abr<=128]');
  assert.equal(selectedMediaFormat('720'), 'bestvideo[height<=720]+bestaudio/best[height<=720]');
  assert.match(selectedMediaFormat('720',false,'mp4'),/ext=mp4/);
  assert.match(selectedMediaFormat('best',true,'m4a'),/ext=m4a/);
  assert.deepEqual(filesJobRequest('https://example.org/video',null,'best',false,{kind:'video'}),{
    url:'https://example.org/video',engine:'yt-dlp',
  });
  const subs=filesJobRequest('https://example.org/video','Films','720',false,{
    kind:'video', subtitles:true,subtitleLanguage:'en',
  });
  assert.equal(subs.overrides.write_subtitles,true);
  assert.equal(subs.overrides.subtitles_lang,'en');
  assert.match(dialog,/subtitleLanguage\.disabled=true/);
  assert.match(dialog,/subtitles\.checked=false/);
  assert.match(dialog,/\['original','Original format'\]/);
});

test('playlist all-selected maps to one yt-dlp job and bounded item indices',()=>{
  assert.equal(playlistIndices([3,1,2,2]),'1,2,3');
  assert.deepEqual(filesJobRequest('https://example.org/list','Folder','best',false,{
    kind:'playlist',selectedIndices:[1,3],
  }),{
    url:'https://example.org/list',engine:'yt-dlp',folder:'Folder',
    overrides:{allow_playlist:true,playlist_items:'1,3'},
  });
  assert.throws(()=>playlistIndices([]),/Select at least/);
  assert.match(dialog,/for\(const row of choices\)selected\.add\(row\.index\)/);
  assert.match(dialog,/detected==='playlist' && result\.entry_count>PAGE/);
});

test('nine content types are never inferred from fabricated metadata',()=>{
  const video={kind:'video',formats:[{vcodec:'avc1',acodec:'mp4a'}]};
  const music={kind:'video',formats:[{vcodec:'none',acodec:'opus'}]};
  const many={kind:'playlist',entries:[{index:1,title:'Track'}]};
  assert.equal(classifyPreview('https://example.org/watch',video),'video');
  assert.equal(classifyPreview('https://example.org/music',music),'audio');
  assert.equal(classifyPreview('https://example.org/playlist/abc',many),'playlist');
  assert.equal(classifyPreview('https://example.org/channel/videos',many),'channel');
  assert.equal(classifyPreview('https://example.org/albums/summer',many),'gallery');
  assert.equal(classifyPreview('https://example.org/manga/chapter/1',many),'manga');
  assert.equal(classifyPreview('https://example.org/file.zip',{kind:'direct'}),'direct');
  assert.equal(classifyPreview('magnet:?xt=urn:btih:abc',null),'torrent');
  assert.equal(classifyPreview('https://example.org/index.html',null),'unsupported');
  assert.equal(looksLikeDirectFile('https://example.org/book.pdf'),true);
  assert.equal(looksLikeDirectFile('https://example.org/index.html'),false);
});

test('selection works within filtered entries without touching the other checked items',()=>{
  const first=new Set([1,2,3,4]);
  const selected=chooseFiltered(first,[{index:2},{index:4}],false);
  assert.deepEqual([...selected].sort(),[1,3]);
  assert.deepEqual([...chooseFiltered(selected,[{index:4}],true)].sort(),[1,3,4]);
  assert.deepEqual(previewRows({entries:[{index:2,title:'Older',timestamp:1},
    {index:1,title:'Newer',timestamp:2}]}).map(item=>item.index),[1,2]);
  assert.match(dialog,/IntersectionObserver/);
  assert.match(dialog,/root:containerNode/);
  assert.match(dialog,/grid-item/);
});

test('unsupported direct fallback and torrent metadata limitations are explicit',()=>{
  assert.match(dialog,/No supported media type was detected in this link/);
  assert.match(dialog,/Try as a direct file/);
  assert.match(dialog,/Core API does not expose torrent metadata or file selections/);
  assert.match(dialog,/does not expose CBZ packaging/);
  assert.match(dialog,/Tree view/);
  assert.match(dialog,/Flat list/);
  assert.match(dialog,/Sort by size/);
});
