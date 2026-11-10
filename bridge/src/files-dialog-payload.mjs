/**
 * Convert Audio only and Quality into a signed ExApp download request.
 * Best video leaves the engine automatic, retaining direct-file and gallery
 * detection without a separate preset or engine control.
 */
export function selectedMediaFormat(quality = 'best', audioOnly = false) {
  if (audioOnly) {
    const filter = quality === '192' ? '[abr<=192]' : quality === '128' ? '[abr<=128]' : '';
    return quality === 'small' ? 'worstaudio' : 'bestaudio' + filter;
  }
  if (quality === 'best') return null;
  const heights = {'1080': 1080, '720': 720, '480': 480};
  const height = heights[quality];
  if (!height) throw new Error('Unsupported video quality.');
  const limit = '[height<=' + height + ']';
  return 'bestvideo' + limit + '+bestaudio/best' + limit;
}

export function filesJobRequest(url, folder, quality = 'best', audioOnly = false) {
  const audioChoices = ['best', '192', '128', 'small'];
  const videoChoices = ['best', '1080', '720', '480'];
  if (!(audioOnly ? audioChoices : videoChoices).includes(quality)) {
    throw new Error('Unsupported audio/video quality.');
  }
  const format = selectedMediaFormat(quality, audioOnly);
  const payload = {url, engine: format ? 'yt-dlp' : 'auto'};
  if (folder !== null) payload.folder = folder;
  if (format !== null) {
    payload.overrides = {format};
    payload.audio_only = Boolean(audioOnly);
    payload.quality = quality;
  }
  return payload;
}
