/** Verified Nextcloud files only: never emit DAV events for another owner's data. */
export function ownDeliveredFilePaths(job, ownerId) {
  const prefix = '/remote.php/dav/files/' + encodeURIComponent(ownerId) + '/';
  const paths = [];
  for (const item of job.output_files || []) {
    if (item.verified !== true || typeof item.path !== 'string') continue;
    try {
      const path = new URL(item.path).pathname;
      const index = path.indexOf(prefix);
      if (index < 0) continue;
      const suffix = path.slice(index + prefix.length);
      const parts = suffix.split('/').map(decodeURIComponent);
      if (parts.some(part => !part || part === '.' || part === '..'
        || part.includes('/') || part.includes('\\') || /[\x00-\x1f]/.test(part))) continue;
      paths.push('/' + parts.join('/'));
    } catch { /* Ignore local paths, malformed URLs and unverified file records. */ }
  }
  return [...new Set(paths)];
}
