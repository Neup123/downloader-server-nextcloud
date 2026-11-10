import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadTitle,downloadStatus,downloadStatusDetail,SKIPPED_DETAIL,downloadBubbleStatus,downloadSymbol,downloadAmount,deliveredFilesQuery} from '../src/download-labels.mjs';

test('safe titles and statuses use human file labels rather than job IDs or URL tokens', () => {
  const raw = {id:'123',status:'downloading',url:'https://example.org/media/video.mp4?token=secret'};
  assert.equal(downloadTitle(raw),'video.mp4');
  assert.equal(downloadStatus(raw),'Downloading');
  assert.ok(!downloadTitle(raw).includes('secret'));
  const verified = {...raw,status:'completed',output_files:[{filename:'film.mp4',verified:true}]};
  assert.equal(downloadTitle(verified),'film.mp4');
  assert.equal(downloadStatus(verified),'Delivered ✓ Verified');
});
test('Files deep links require verified ownership and discard the WebDAV host', () => {
  const job = {id:'abc',status:'completed',owner_id:'alice',url:'https://example.net/media',
    output_files:[{filename:'film.mp4',verified:true,file_id:'431',
      path:'https://private-nc.example/remote.php/dav/files/alice/Downloads/abc/film.mp4'}]};
  assert.equal(deliveredFilesQuery(job),'?dir=%2FDownloads%2Fabc&openfile=431');
  assert.equal(deliveredFilesQuery({...job,owner_id:'bob'}),null);
  assert.equal(deliveredFilesQuery({...job,status:'failed'}),null);
  assert.equal(deliveredFilesQuery({...job,output_files:[{...job.output_files[0],verified:false}]}),null);
  assert.equal(deliveredFilesQuery({...job,output_files:[{...job.output_files[0],
    path:'https://user:password@private-nc.example/remote.php/dav/files/alice/Downloads/abc/film.mp4'}]}),null);
});

test('Widget statuses match the Core Download and Library job card', () => {
  const source={id:'job-1',engine:'yt-dlp',url:'https://example.org/watch/123',status:'queued'};
  assert.equal(downloadStatus(source),'Queued');
  assert.equal(downloadStatus({...source,status:'downloading',progress:{
    percent:62.2,speed_bytes_per_second:3145728,
  }}),'Downloading 62% · 3.0 MB/s');
  assert.equal(downloadStatus({...source,status:'paused'}),'Paused');
  assert.equal(downloadStatus({...source,status:'delivering'}),'Delivering to your destination');
  assert.equal(downloadStatus({...source,status:'failed',error:'Connection lost'}),'Failed — Connection lost');
  assert.equal(downloadStatus({...source,status:'cancelled'}),'Cancelled');
  assert.equal(downloadStatus({...source,status:'completed',output_files:[{verified:false}]}),
    'Completed — checking delivery');
  assert.equal(downloadStatus({...source,status:'completed',output_files:[{verified:true}]}),
    'Delivered ✓ Verified');
  assert.equal(downloadAmount(10*1024),'10 KB');
});

test('Content-type icons mirror Core card, without rewriting source filenames', () => {
  assert.equal(downloadSymbol({url:'https://example.org/video',engine:'yt-dlp'}),'▶');
  assert.equal(downloadSymbol({url:'https://example.org/music.mp3',engine:'generic'}),'♫');
  assert.equal(downloadSymbol({url:'https://example.org/gallery',engine:'gallery-dl'}),'▧');
  assert.equal(downloadSymbol({url:'https://example.org/file.zip',engine:'aria2c'}),'↓');
  assert.equal(downloadTitle({url:'https://example.org/file.zip',output_files:[
    {filename:'raw-original.zip',verified:false},
  ]}),'raw-original.zip');
});


test('Bubble subtitle shows downloading state and speed but not duplicate percent',()=>{
  const job={id:'job',url:'https://example.org/file',status:'downloading',
    progress:{percent:32,speed_bytes_per_second:17825792}};
  assert.equal(downloadStatus(job),'Downloading 32% · 17 MB/s');
  assert.equal(downloadBubbleStatus(job),'Downloading · 17 MB/s');
  assert.equal(downloadBubbleStatus({...job,status:'queued'}),'Queued');
});


test('skipped history rows are terminal after refresh and show the unchanged skip reason only as detail', () => {
  const job = {id:'collision',status:'skipped',owner_id:'alice',url:'https://media.example/movie.mp4',
    output_files:[{filename:'movie.mp4',verified:false,skipped:true,skip_reason:'exists'}]};
  assert.equal(downloadStatus(job),'Skipped');
  assert.equal(downloadBubbleStatus(job),'Skipped');
  assert.equal(downloadStatusDetail(job),SKIPPED_DETAIL);
  assert.equal(SKIPPED_DETAIL,'Download skipped: a file already exists in Nextcloud Files. The existing file was kept.');
  assert.equal(downloadStatus(JSON.parse(JSON.stringify(job))),'Skipped');
  assert.doesNotMatch(downloadStatus(job),/checking delivery/i);
  assert.equal(deliveredFilesQuery(job),null);
  const renamed = {...job,status:'completed',output_files:[{filename:'movie (1).mp4',verified:true}]};
  const normal = {...job,status:'completed',output_files:[{filename:'movie.mp4',verified:true}]};
  assert.equal(downloadStatus(renamed),'Delivered ✓ Verified');
  assert.equal(downloadStatus(normal),'Delivered ✓ Verified');
  assert.equal(downloadStatusDetail(normal),downloadStatus(normal));
});
