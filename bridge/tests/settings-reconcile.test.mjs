import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileSettingsPatch, mergePendingPatches, overlayPendingSettings}
  from '../src/settings-reconcile.mjs';

const saved = {
  destination_folder:'Updated', existing_file_behavior:'rename',
  notify_failed:true, engine_settings:{'yt-dlp':{format:'best'}},
  destination_route_overrides:{audio:'Custom/Podcasts'},
  destination_routes:{audio:'Custom/Podcasts',video:'Updated/Video'},
  app_password_configured:true,
};

test('reconciles a partial server write by field rather than assuming failure means nothing saved',()=>{
  const requested={
    destination_folder:'Updated', existing_file_behavior:'skip', notify_failed:false,
    destination_routes:{audio:null,video:'Custom/Podcasts'},
  };
  const outcome=reconcileSettingsPatch(requested,saved);
  assert.deepEqual(outcome.applied,['destination_folder']);
  assert.deepEqual(outcome.pending,[
    'existing_file_behavior','notify_failed','destination_routes.audio','destination_routes.video',
  ]);
  assert.deepEqual(outcome.remaining,{
    existing_file_behavior:'skip',notify_failed:false,
    destination_routes:{audio:null,video:'Custom/Podcasts'},
  });
  const merged=overlayPendingSettings(saved,outcome.remaining);
  assert.equal(merged.destination_folder,'Updated');
  assert.equal(merged.destination_routes.audio,'Updated/Audio');
  assert.equal(merged.destination_routes.video,'Custom/Podcasts');
  assert.deepEqual(merged.destination_route_overrides,{video:'Custom/Podcasts'});
});

test('fully rejected combined patch keeps all proposed values pending',()=>{
  const outcome=reconcileSettingsPatch({
    destination_folder:'Proposed', engine_settings:{'yt-dlp':{format:'worst'}},
  },saved);
  assert.deepEqual(outcome.applied,[]);
  assert.deepEqual(outcome.pending,['destination_folder','engine_settings']);
  assert.deepEqual(outcome.remaining,{
    destination_folder:'Proposed',engine_settings:{'yt-dlp':{format:'worst'}},
  });
});

test('already applied route reset and engine settings are detected',()=>{
  const outcome=reconcileSettingsPatch({
    destination_routes:{video:null,audio:'Custom/Podcasts'},
    engine_settings:{'yt-dlp':{format:'best'}},
  },saved);
  assert.deepEqual(outcome.applied,['destination_routes.video','destination_routes.audio','engine_settings']);
  assert.deepEqual(outcome.remaining,{});
});

test('in-flight edits win, including distinct route keys',()=>{
  assert.deepEqual(mergePendingPatches(
    {destination_folder:'First',destination_routes:{audio:'One',video:'Two'}},
    {destination_folder:'Last',destination_routes:{audio:null,torrent:'Three'}},
  ),{destination_folder:'Last',destination_routes:{audio:null,video:'Two',torrent:'Three'}});
});

test('stored-password existence does not imply a new secret was applied',()=>{
  const outcome=reconcileSettingsPatch({app_password:'a-new-secret'},saved);
  assert.deepEqual(outcome.applied,[]);
  assert.deepEqual(outcome.unverified,['app_password']);
  assert.deepEqual(outcome.remaining,{});
  assert.deepEqual(reconcileSettingsPatch({app_password:''},{
    ...saved, app_password_configured:false,
  }).applied,['app_password']);
});
