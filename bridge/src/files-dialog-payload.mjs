/**
 * Build a signed, per-user ExApp submission. A Files-folder action always
 * owns its destination; Viewer/Talk requests use the user's implicit default.
 */
export function selectedMediaFormat(quality = 'default', container = 'auto') {
  if (quality === 'default' && container === 'auto') return null;
  const height = quality === '1080' ? 1080 : quality === '720' ? 720 : null;
  if (quality === 'audio') {
    return container === 'mp4' ? 'bestaudio[ext=m4a]/bestaudio'
      : container === 'webm' ? 'bestaudio[ext=webm]/bestaudio'
      : 'bestaudio/best';
  }
  const heightFilter = height === null ? '' : '[height<=' + height + ']';
  const normal = height === null ? 'bv*+ba/b'
    : 'bestvideo' + heightFilter + '+bestaudio/best' + heightFilter;
  if (container === 'auto') return normal;
  const videoExt = container === 'mp4' ? 'mp4' : 'webm';
  const audioExt = container === 'mp4' ? 'm4a' : 'webm';
  return 'bestvideo' + heightFilter + '[ext=' + videoExt + ']+bestaudio[ext='
    + audioExt + ']/best' + heightFilter + '[ext=' + videoExt + ']/' + normal;
}

export function filesJobRequest(url, folder, engine = 'auto', presetId = '',
                                quality = 'default', container = 'auto') {
  const payload = {url, engine: engine || 'auto'};
  if (presetId) payload.preset_id = presetId;
  if (folder !== null) payload.folder = folder;
  const format = selectedMediaFormat(quality, container);
  if (format !== null) payload.overrides = {format};
  return payload;
}
