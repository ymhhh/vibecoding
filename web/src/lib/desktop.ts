/** Optional Wails desktop bindings (no-op in browser / server mode). */

type WailsGo = Record<string, Record<string, Record<string, unknown>>>;

function findBoundFn(name: string): ((...args: never[]) => unknown) | undefined {
  const pkgs = (window as Window & { go?: WailsGo }).go;
  if (!pkgs || typeof pkgs !== 'object') return undefined;
  for (const pkg of Object.values(pkgs)) {
    if (!pkg || typeof pkg !== 'object') continue;
    for (const svc of Object.values(pkg)) {
      if (!svc || typeof svc !== 'object') continue;
      const fn = (svc as Record<string, unknown>)[name];
      if (typeof fn === 'function') {
        return fn as (...args: never[]) => unknown;
      }
    }
  }
  return undefined;
}

export function isDesktopApp(): boolean {
  return (
    !!findBoundFn('WindowToggleMaximise') ||
    !!findBoundFn('SaveTextFile') ||
    !!findBoundFn('SaveTextFileToDownloads') ||
    !!findBoundFn('OpenAttachmentFiles')
  );
}

export async function toggleDesktopMaximize(): Promise<void> {
  const fn = findBoundFn('WindowToggleMaximise');
  if (!fn) return;
  await Promise.resolve(fn());
}
