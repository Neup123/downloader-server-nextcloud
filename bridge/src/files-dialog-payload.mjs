/**
 * Build a signed, per-user ExApp submission. A Files-folder action always
 * owns its destination; Viewer/Talk requests use the user's implicit default.
 * Explicit quality is represented by a real yt-dlp format passed to Core.
 */
export function selectedMediaFormat(quality = 'default', container = 'auto', audioOnly = false) {
  const audio = audioOnly || quality === 'audio';
  if (!audio && quality === 'default' && container === 'auto') return null;
  if (audio) {
    // Legacy 'audio' means the old preset-like best-audio choice.
    if (quality === 'audio' && !audioOnly) {
      return container === 'mp4' ? 'bestaudio[ext=m4a]/bestaudio'
        : container === 'webm' ? 'bestaudio[ext=webm]/bestaudio'
        : 'bestaudio/best';
    }
    const filter = quality === '192' ? '[abr<=192]' : quality === '128' ? '[abr<=128]' : '';
    const base = quality === 'small' ? 'worstaudio' : 'bestaudio' + filter;
    const preference = container === 'mp4' ? '[ext=m4a]'
      : container === 'webm' ? '[ext=webm]' : '';
    // Do not fall back to 'best', which could select a video stream.
    return preference ? 'bestaudio' + filter + preference + '/' + base : base;
  }
  const height = ({'1080':1080, '720':720, '480':480})[quality] ?? null;
  const heightFilter = height === null ? '' : '[height<=' + height + ']';
  const normal = height === null ? 'bv*+ba/b'
    : 'bestvideo' + heightFilter + '+bestaudio/best' + heightFilter;
  if (container === 'auto') return normal;
  const videoExt = container === 'mp4' ? 'mp4' : 'webm';
  const audioExt = container === 'mp4' ? 'm4a' : 'webm';
  return 'bestvideo' + heightFilter + '[ext=' + videoExt + ']+bestaudio[ext='
    + audioExt + ']/best' + heightFilter + '[ext=' + videoExt + ']/' + normal;
}

export function presetEngineForSubmission(presets, selectedPresetId = '', defaultPresetId = '') {
  const activeId = selectedPresetId || defaultPresetId;
  if (!activeId) return null;
  // An unavailable preset must also be resolved by the server; never guess yt-dlp.
  return presets.find(item => item.id === activeId)?.engine || 'auto';
}

export function filesJobRequest(url, folder, engine = 'auto', presetId = '',
                                quality = 'default', container = 'auto', audioOnly = false,
                                presetEngine = null) {
  // Null means no preset. An explicit or implicit non-yt-dlp preset must
  // retain the server's own engine/format rather than receiving yt-dlp options.
  const format = presetEngine !== null && presetEngine !== 'yt-dlp'
    ? null : selectedMediaFormat(quality, container, audioOnly);
  const requestedEngine = engine || 'auto';
  if (format !== null && presetEngine === null && requestedEngine !== 'auto' && requestedEngine !== 'yt-dlp') {
    throw new Error('Video and audio quality choices require the yt-dlp engine.');
  }
  const payload = {
    url,
    engine: presetEngine !== null ? 'auto'
      : format !== null && requestedEngine === 'auto' ? 'yt-dlp' : requestedEngine,
  };
  if (presetId) payload.preset_id = presetId;
  if (folder !== null) payload.folder = folder;
  if (format !== null) {
    payload.overrides = {format};
    // Keep the explicit UI mode and quality on the signed request to ExApp.
    // It checks these against the format, then forwards the Core-supported
    // overrides.format (which determines the actual media stream).
    payload.audio_only = Boolean(audioOnly || quality === 'audio');
    payload.quality = quality === 'audio' || quality === 'default' ? 'best' : quality;
  }
  return payload;
}
