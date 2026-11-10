import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {filesJobRequest, selectedMediaFormat, playlistIndices} from '../src/files-dialog-payload.mjs';
import {classifyPreview, looksLikeDirectFile, chooseFiltered, previewRows} from '../src/link-first-dialog.mjs';

const source=readFileSync(new URL('../src/bridge.ts',import.meta.url),'utf8');
const dialog=readFileSync(new URL('../src/link-first-dialog.mjs',import.meta.url),'utf8');

test('folder and owner default are preserved without preset references',()=>{
  assert.deepEqual(filesJobRequest('https://example.org/video','Movies'),{
    url:'https://example.org/video',engine:'auto',content_type:'video',folder:'Movies',
  });
  assert.deepEqual(filesJobRequest('https://example.org/file',null),{
    url:'https://example.org/file',engine:'auto',content_type:'video',
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
    url:'https://example.org/video',engine:'yt-dlp',content_type:'video',
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
    url:'https://example.org/list',engine:'yt-dlp',content_type:'video',folder:'Folder',
    overrides:{allow_playlist:true,playlist_items:'1,3'},
  });
  assert.throws(()=>playlistIndices([]),/Select at least/);
  assert.match(dialog,/for\(const row of choices\)selected\.add\(row\.index\)/);
  assert.match(dialog,/detected==='playlist' && \(result\.entry_count>PAGE \|\| result\.entries\?\.length===PAGE\)/);
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
  assert.match(dialog,/Torrent downloads are not available yet/);
  assert.match(dialog,/Packing these pages into one comic book file is not available yet/);
  assert.match(dialog,/Tree view/);
  assert.match(dialog,/Flat list/);
  assert.match(dialog,/Sort by size/);
});

test('detected dialog categories are server-routed; a Files context still carries its folder',()=>{
  const options=[
    ['video',false,'video'],['audio',true,'audio'],['playlist',false,'video'],
    ['playlist',true,'audio'],['channel',false,'video'],['gallery',false,'images'],
    ['manga',false,'manga'],['direct',false,'direct'],
  ];
  for(const [kind,audio,expected] of options){
    const opts={kind,selectedIndices:[1],cbz:false};
    const request=filesJobRequest('https://example.org/item',null,'best',audio,opts);
    assert.equal(request.content_type,expected,kind);
    assert.equal('folder' in request,false,'implicit destinations are resolved by signed gateway');
  }
  const folder=filesJobRequest('https://example.org/file.zip','Projects/2026','best',false,{kind:'direct'});
  assert.equal(folder.content_type,'direct');
  assert.equal(folder.folder,'Projects/2026');
});

test('skip outcome produces native toast and never claims delivered Files verification',()=>{
  assert.match(source,/file\.skipped===true/);
  assert.match(source,/Download skipped: a file already exists in Nextcloud Files/);
  assert.match(source,/The existing file was kept/);
});

test('dialog passes created job ID to header and supports a skip toast even for fast jobs',()=>{
  const bridgeSource=source;
  assert.match(dialog,/const created=await api\('\/jobs','POST',body\)/);
  assert.match(dialog,/queued\(created\);dialog.close\(\)/);
  assert.match(bridgeSource,/new CustomEvent\('downloader:job-queued'/);
  assert.match(bridgeSource,/const justQueued = new Set<string>\(\)/);
  assert.match(bridgeSource,/justQueued.has\(job.id\)/);
  assert.match(bridgeSource,/Download skipped: a file already exists/);
  assert.match(bridgeSource,/justQueued.delete\(job.id\)/);
});

test('split-format videos are video; real audio-only is audio; missing codecs are unknown',()=>{
  const split={kind:'video',formats:[
    ...Array.from({length:37},(_,i)=>({format_id:'v'+i,vcodec:'avc1.640028',acodec:'none'})),
    ...Array.from({length:10},(_,i)=>({format_id:'a'+i,vcodec:'none',acodec:'opus'})),
    ...Array.from({length:6},(_,i)=>({format_id:'unknown'+i})),
  ]};
  assert.equal(classifyPreview('https://www.youtube.com/watch?v=aqz-KE-bpKQ',split),'video');
  assert.equal(classifyPreview('https://example.org/song',{kind:'video',
    formats:[{vcodec:'none',acodec:'opus'},{acodec:'mp4a'},{format_id:'unknown'}]}),'audio');
  assert.equal(classifyPreview('https://example.org/unknown',{kind:'video',
    formats:[{format_id:'unknown'},{vcodec:'none',acodec:'none'}]}),'direct');
});

test('empty generic video preview and file-shaped link use direct-file state',()=>{
  assert.equal(classifyPreview('https://example.org/watch',{kind:'video',formats:[]}), 'direct');
  assert.equal(classifyPreview('https://proof.ovh.net/files/10Mb.dat',{kind:'video',
    formats:[{vcodec:'avc1',acodec:'none'}]}), 'direct');
  assert.equal(looksLikeDirectFile('https://proof.ovh.net/files/10Mb.dat'),true);
});

test('dialog hides technical errors and does not expose internal engines',()=>{
  assert.doesNotMatch(dialog,/Detected by Core extractor|Size unavailable from extractor|Core API does not expose|yt-dlp metadata inspection failed/);
  assert.doesNotMatch(dialog,/message\(error instanceof Error\?error.message/);
  assert.doesNotMatch(dialog,/render\('unsupported',null,reason\)/);
});
