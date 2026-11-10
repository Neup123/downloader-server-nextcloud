/**
 * One signed Nextcloud submission. The content class comes from Core's
 * extractor preview, not a named preset or a browser-selected engine.
 */
export function selectedMediaFormat(quality = 'best', audioOnly = false, container = 'original') {
  const audio = audioOnly;
  if (audio) {
    const filter = quality === '192' ? '[abr<=192]' : quality === '128' ? '[abr<=128]' : '';
    const base = quality === 'small' ? 'worstaudio' : 'bestaudio' + filter;
    if (container === 'original') return base;
    if (!['m4a','webm'].includes(container)) throw new Error('Unsupported audio container.');
    const ext = container === 'm4a' ? 'm4a' : 'webm';
    return 'bestaudio' + filter + '[ext=' + ext + ']/' + base;
  }
  const height = ({'best':null,'1080':1080,'720':720,'480':480})[quality];
  if (height === undefined) throw new Error('Unsupported video quality.');
  const limit = height === null ? '' : '[height<=' + height + ']';
  const base = height === null ? null : 'bestvideo' + limit + '+bestaudio/best' + limit;
  if (container === 'original') return base;
  if (!['mp4','webm'].includes(container)) throw new Error('Unsupported video container.');
  const audioExt = container === 'mp4' ? 'm4a' : 'webm';
  return 'bestvideo' + limit + '[ext=' + container + ']+bestaudio[ext=' +
    audioExt + ']/best' + limit + '[ext=' + container + ']/' + (base || 'bv*+ba/b');
}

export function playlistIndices(indices) {
  if (!Array.isArray(indices) || !indices.length || indices.length > 100100 ||
      indices.some(index => !Number.isInteger(index) || index < 1 || index > 100100)) {
    throw new Error('Select at least one listed item.');
  }
  const ordered=[...new Set(indices)].sort((a,b)=>a-b);
  // Keep old small-list formatting stable. Large collections must not exceed
  // the signed gateway's 16k options limit when "all" was selected.
  if(ordered.length<=100) return ordered.join(',');
  const ranges=[];
  for(let i=0;i<ordered.length;){
    let j=i;while(j+1<ordered.length && ordered[j+1]===ordered[j]+1)j++;
    ranges.push(j>i ? ordered[i]+'-'+ordered[j] : String(ordered[i]));
    i=j+1;
  }
  const expression=ranges.join(',');
  if(expression.length>14000)throw new Error('Select fewer separate items.');
  return expression;
}

export function filesJobRequest(url, folder, quality = 'best', audioOnly = false, options = {}) {
  const audioChoices = ['best', '192', '128', 'small'];
  const videoChoices = ['best', '1080', '720', '480'];
  if (!(audioOnly ? audioChoices : videoChoices).includes(quality)) {
    throw new Error('Unsupported audio/video quality.');
  }
  const kind = options.kind || 'auto';
  if (!['auto','video','audio','playlist','channel','gallery','manga','direct','torrent'].includes(kind)) {
    throw new Error('Unsupported content type.');
  }
  if (kind === 'manga' && options.cbz !== false) {
    throw new Error('The extractor does not provide a CBZ packaging capability.');
  }
  if(kind==='torrent' && !/^magnet:\\?/i.test(url)) {
    throw new Error('Torrent download requires a magnet link.');
  }
  const media = !['auto','direct','torrent'].includes(kind);
  const container = options.container || 'original';
  const format = ['direct','torrent'].includes(kind) ? null : selectedMediaFormat(quality, audioOnly, container);
  const engine = kind === 'torrent' ? 'aria2c' : kind === 'direct' ? 'generic' : media || format ? 'yt-dlp' : 'auto';
  const category = kind === 'audio' || audioOnly ? 'audio'
    : kind === 'direct' ? 'direct'
    : kind === 'gallery' ? 'images'
    : kind === 'manga' ? 'manga'
    : kind === 'torrent' ? 'torrent'
    : 'video';
  const payload = {url, engine, content_type: category};
  if (folder !== null) payload.folder = folder;
  const overrides = {};
  if (format !== null) {
    overrides.format = format;
    payload.audio_only = Boolean(audioOnly);
    payload.quality = quality;
  }
  if (media && options.subtitles === true && !audioOnly) {
    const language = options.subtitleLanguage;
    if (typeof language !== 'string' || !/^[a-zA-Z]{2,8}(?:-[a-zA-Z]{2,8})?$/.test(language)) {
      throw new Error('Invalid subtitle language.');
    }
    overrides.write_subtitles = true;
    overrides.subtitles_lang = language;
  }
  if (['playlist','channel','gallery','manga'].includes(kind)) {
    overrides.allow_playlist = true;
    overrides.playlist_items = playlistIndices(options.selectedIndices);
  }
  if(kind==='torrent') {
    overrides.options = {'select-file': playlistIndices(options.selectedIndices)};
  }
  if (Object.keys(overrides).length) payload.overrides = overrides;
  return payload;
}
