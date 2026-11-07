import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadTitle,downloadStatus,deliveredFilesQuery} from '../src/download-labels.mjs';

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
