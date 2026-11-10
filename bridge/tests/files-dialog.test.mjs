import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {filesJobRequest, selectedMediaFormat, playlistIndices} from '../src/files-dialog-payload.mjs';
import {classifyPreview, looksLikeDirectFile, chooseFiltered, previewRows} from '../src/link-first-dialog.mjs';

const source=readFileSync(new URL('../src/bridge.ts',import.meta.url),'utf8');
const dialog=readFileSync(new URL('../src/link-first-dialog.mjs',import.meta.url),'utf8');
const labels=readFileSync(new URL('../src/download-labels.mjs',import.meta.url),'utf8');

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


test('advanced subtitle checkbox and label share the Audio only row alignment',()=>{
  assert.match(dialog,/const subToggle=e\('label','','dl-audio-toggle dl-subtitle-toggle'\)/);
  assert.match(dialog,/subToggle\.append\(subtitles,e\('span','Download subtitles'\)\)/);
  assert.match(dialog,/advanced\.append\(subToggle\)/);
  assert.doesNotMatch(dialog,/labeled\('Download subtitles',subtitles\)/);
  assert.match(source,/\.dl-options \.dl-audio-toggle\{display:flex;align-items:center;gap:6px\}/);
  assert.match(source,/\.dl-options \.dl-subtitle-toggle input\{width:18px;height:18px;margin:0\}/);
});

test('direct-file details remain in the box while a verified file has no status message',()=>{
  assert.match(dialog,/form\.append\(line,status,details,buttons\)/);
  assert.match(dialog,/details\.append\(e\('h3','Direct file'\),e\('p','Name: '\+filename\)/);
  assert.match(dialog,/e\('p','Type: '\+fileType\),e\('p','Size: '\+sizeLabel\(bytes\)\)/);
  assert.match(dialog,/message\(result\?'':"We have not confirmed this file/);
  assert.doesNotMatch(dialog,/File details are shown above|File details are shown below/);
});


test('dialog has no visible title and hides status text unless a problem exists',()=>{
  assert.doesNotMatch(dialog,/Download into my Files|dl-dialog-heading|aria-labelledby/);
  assert.match(dialog,/dialog\.setAttribute\('aria-label','Download link'\)/);
  assert.match(dialog,/form\.append\(line,status,details,buttons\)/);
  assert.match(dialog,/status\.hidden=true/);
  assert.match(dialog,/const message=\(text\)=>\{status\.textContent=text;status\.hidden=!text;\}/);
  assert.doesNotMatch(dialog,/Link checked\. Review your choices|Detecting content type…|Choose items to download|Loading more items…/);
  assert.match(dialog,/spinner\.hidden=false/);
  assert.match(dialog,/message\('This link is not supported\./);
  assert.match(dialog,/message\('Torrent downloads are not available yet\.'\)/);
  assert.match(dialog,/message\('Could not load more items\. Please try again\.'\)/);
  assert.match(dialog,/message\(value\?'Paste an HTTP\(S\) link or a magnet URI\.':''\)/);
  assert.match(dialog,/Only the first 100 items are available to select/);
});

test('quality is inline and all dialog inputs use content width except link and item lists',()=>{
  assert.match(dialog,/const qualityLabel=labeled\('Quality',qualityPicker\)/);
  assert.match(dialog,/qualityLabel\.classList\.add\('dl-quality-label'\)/);
  assert.match(source,/\.dl-link-dialog \.dl-media-row \.dl-quality-label\{display:inline-flex;align-items:center;/);
  assert.match(source,/gap:8px;flex:0 0 auto;margin:0;width:max-content/);
  assert.match(source,/\.dl-link-dialog select\.dl-input\{width:max-content;field-sizing:content;max-width:100%;/);
  assert.match(source,/\.dl-link-dialog \.dl-label\{width:max-content;max-width:100%;justify-self:start\}/);
  assert.match(source,/\.dl-link-dialog \.dl-options\{width:max-content;max-width:100%;justify-self:start\}/);
  assert.match(source,/\.dl-link-dialog \.dl-options\[open\]\{justify-items:start\}/);
  assert.match(source,/\.dl-link-dialog \.dl-options input:not\(\[type=checkbox\]\)\{width:max-content;/);
  assert.match(source,/\.dl-link-dialog \.dl-picker-controls\{width:max-content;max-width:100%\}/);
  assert.match(source,/\.dl-link-dialog \.dl-detected\{justify-items:start\}/);
  assert.match(source,/\.dl-link-dialog \.dl-picker\{width:100%;max-width:100%;min-width:0;justify-self:stretch\}/);
  assert.match(source,/\.dl-link-line input\{flex:1;min-width:0\}/);
  assert.match(source,/\.dl-playlist-list\{display:grid/);
  assert.match(source,/\.dl-gallery-grid\{display:grid/);
  assert.match(dialog,/advanced\.append\(labeled\('Subtitle language',subtitleLanguage\)\)/);
  assert.match(dialog,/advanced\.append\(labeled\('Container',container\)\)/);
});

test('video and audio default to the same plain Best quality label',()=>{
  assert.equal((dialog.match(/\['best','Best quality'\]/g)||[]).length,2);
  assert.doesNotMatch(dialog,/Best available video|Best available audio/);
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
  assert.match(dialog,/We could not find a supported download at this link/);
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
  assert.match(source,/SKIPPED_DETAIL/);
  assert.match(labels,/Download skipped: a file already exists in Nextcloud Files/);
  assert.match(labels,/The existing file was kept/);
});

test('dialog passes created job ID to header and supports a skip toast even for fast jobs',()=>{
  const bridgeSource=source;
  assert.match(dialog,/const created=await api\('\/jobs','POST',body\)/);
  assert.match(dialog,/queued\(created\);dialog.close\(\)/);
  assert.match(bridgeSource,/new CustomEvent\('downloader:job-queued'/);
  assert.match(bridgeSource,/const justQueued = new Set<string>\(\)/);
  assert.match(bridgeSource,/justQueued.has\(job.id\)/);
  assert.match(bridgeSource,/SKIPPED_DETAIL/);
  assert.match(labels,/Download skipped: a file already exists/);
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
