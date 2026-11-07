/**
 * Shared presentation-only helpers for the Nextcloud header, Dashboard and
 * Files bridge. They never fetch, download, or handle API/WebDAV credentials.
 * @typedef {{id:string,url:string,status:string,engine?:string,owner_id?:string,
 * output_files?:Array<{filename:string,path?:string,verified?:boolean,file_id?:string|number}>}} Job
 */

/** @param {Job} job */
export function downloadTitle(job) {
  const output = job.output_files?.find(f => f.verified)?.filename;
  if (output) return output;
  try {
    const url = new URL(job.url);
    const last = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) || '');
    return last || url.hostname || 'Download';
  } catch {
    return 'Download';
  }
}

/** @param {Job} job */
export function downloadStatus(job) {
  if (job.status === 'completed') {
    return job.output_files?.length && job.output_files.every(f => f.verified)
      ? 'Delivered ✓ Verified' : 'Completed — checking delivery';
  }
  if (job.status === 'failed') return 'Failed — try again';
  if (job.status === 'cancelled') return 'Cancelled';
  if (job.status === 'downloading') return 'Downloading';
  if (job.status === 'delivering') return 'Delivering to Files';
  if (job.status === 'queued') return 'Queued';
  return (job.status || 'Pending').replaceAll('-', ' ');
}

/**
 * Return only a trusted same-origin Files query string for an owner's verified
 * Nextcloud DAV file. Never reuse the remote HTTP(S) host or auth data.
 * @param {Job} job
 * @returns {string|null}
 */
export function deliveredFilesQuery(job) {
  if (job.status !== 'completed' || !job.owner_id) return null;
  for (const file of job.output_files || []) {
    if (!file.verified || !file.path) continue;
    try {
      const source = new URL(file.path);
      if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) continue;
      const marker = '/remote.php/dav/files/';
      const index = source.pathname.indexOf(marker);
      if (index < 0) continue;
      const parts = source.pathname.slice(index + marker.length).split('/').map(decodeURIComponent);
      if (parts.length < 2 || parts[0] !== job.owner_id || parts.slice(1).some(
        part => !part || part === '.' || part === '..' || part.includes('/') || part.includes('\\')
      )) continue;
      const folder = '/' + parts.slice(1, -1).join('/');
      let query = '?dir=' + encodeURIComponent(folder);
      if (file.file_id !== null && file.file_id !== undefined && /^\d+$/.test(String(file.file_id))) {
        query += '&openfile=' + encodeURIComponent(String(file.file_id));
      }
      return query;
    } catch {
      // Malformed or potentially cross-user DAV references cannot become links.
    }
  }
  return null;
}
