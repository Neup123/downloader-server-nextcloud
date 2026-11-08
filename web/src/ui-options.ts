/** User-facing yt-dlp quality presets. Custom selectors remain advanced. */
export const VIDEO_QUALITY = [
  {id: 'best', label: 'Best quality', format: 'bv*+ba/b'},
  {id: '1080', label: 'Up to 1080p', format: 'bestvideo[height<=1080]+bestaudio/best[height<=1080]'},
  {id: '720', label: 'Up to 720p', format: 'bestvideo[height<=720]+bestaudio/best[height<=720]'},
  {id: 'audio', label: 'Audio only', format: 'bestaudio/best'},
] as const;
export function qualityFromFormat(format: string): string {
  return VIDEO_QUALITY.find(entry => entry.format === format)?.id ?? 'custom';
}
export function formatFromQuality(value: string): string | null {
  return VIDEO_QUALITY.find(entry => entry.id === value)?.format ?? null;
}
export function validPresetSettings(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Per-download preference: preserve a resolution ceiling even when a format is preferred. */
export function selectedMediaFormat(quality = 'default', container = 'auto'): string | null {
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
