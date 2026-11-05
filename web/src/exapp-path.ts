/** Resolve the AppAPI-mounted root without mixing query strings into a path. */
export function exappRoot(pathname: string): string {
  if (!pathname.startsWith('/') || pathname.includes('\\')) {
    throw new Error('Invalid ExApp location');
  }
  const root = pathname.replace(/\/+$/, '');
  return root || '/';
}
