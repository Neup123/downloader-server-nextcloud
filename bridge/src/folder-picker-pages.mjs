/** Append a validated folder page without losing entries from earlier pages. */
export function extendFolderResults(existing, page, path, offset, append) {
  if (!page || page.path !== path || page.offset !== offset || !Array.isArray(page.folders)) {
    throw new Error('Folder page did not match the requested location');
  }
  const result = append ? [...existing] : [];
  const seen = new Set(result.map(item => item.path));
  for (const item of page.folders) {
    if (typeof item.path !== 'string' || typeof item.name !== 'string') {
      throw new Error('Invalid folder entry');
    }
    if (!seen.has(item.path)) {
      seen.add(item.path);
      result.push(item);
    }
  }
  return result;
}
