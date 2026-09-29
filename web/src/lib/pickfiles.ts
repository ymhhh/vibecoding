/** Pick attachment files. Prefer Wails native dialog in the desktop app. */

import { isDesktopApp } from './desktop';

type OpenedAttachmentFile = {
  name: string;
  mime: string;
  size: number;
  data: string; // standard base64
};

type WailsGo = Record<string, Record<string, Record<string, unknown>>>;

export type PickAttachmentResult =
  | { mode: 'desktop'; files: File[] }
  | { mode: 'browser' };

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

function base64ToFile(name: string, mime: string, b64: string): File {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime || 'application/octet-stream' });
}

/**
 * Desktop: OpenAttachmentFiles (macOS uses a separate system dialog, not a
 * WKWebView sheet — keep Issue modals visible while picking).
 * Browser: `{ mode: 'browser' }` so the caller may click a hidden file input.
 */
export async function pickAttachmentFiles(): Promise<PickAttachmentResult> {
  if (!isDesktopApp()) return { mode: 'browser' };
  const open = findBoundFn('OpenAttachmentFiles');
  if (!open) {
    throw new Error(
      'Desktop file picker is unavailable. Rebuild the app (`make run`) so OpenAttachmentFiles is bound.'
    );
  }
  const rows = (await Promise.resolve(open())) as OpenedAttachmentFile[] | null | undefined;
  if (!rows || !Array.isArray(rows)) {
    return { mode: 'desktop', files: [] };
  }
  return {
    mode: 'desktop',
    files: rows
      .filter((r) => r && typeof r.data === 'string' && r.name)
      .map((r) => base64ToFile(r.name, r.mime || '', r.data)),
  };
}
