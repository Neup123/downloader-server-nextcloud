/**
 * Build the signed, per-user ExApp submission payload.
 * Explicit Files folder actions must pass the chosen folder; other entry
 * points omit it to use the signed user's default (including first-use mkdir).
 * Never read destination from a modal input or from the browser's URL.
 */
export function filesJobRequest(url, folder, engine = 'auto', presetId = '') {
  const payload = {url, engine: engine || 'auto'};
  if (presetId) payload.preset_id = presetId;
  if (folder !== null) payload.folder = folder;
  return payload;
}
