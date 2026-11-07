/**
 * Extract a single explicit HTTP(S) URL from a Nextcloud Talk message body.
 * Never interpret private DAV paths or the message's rich-object file refs as
 * download sources; the destination and download still need user confirmation.
 * Multiple distinct URLs must be selected manually instead of guessing.
 *
 * @param {unknown} messageBody
 * @returns {string|null}
 */
export function suggestTalkSource(messageBody) {
  if (typeof messageBody !== 'string' || messageBody.length > 16384) return null;
  const candidates = new Set();
  for (const match of messageBody.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    const raw = match[0].replace(/[.,!?;:)\]}]+$/u, '');
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      if (!url.hostname || url.username || url.password) continue;
      candidates.add(url.href);
    } catch {
      // Malformed tokens cannot be used as a source.
    }
    if (candidates.size > 1) return null;
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}
