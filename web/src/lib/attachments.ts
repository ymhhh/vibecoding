import { Issue, IssueAttachment } from '../types';

export const MAX_ISSUE_ATTACHMENTS = 12;
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const MAX_PDF_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_TEXT_CHARS = 80_000;

const TEXT_EXT = new Set([
  'md', 'txt', 'json', 'yaml', 'yml', 'csv', 'xml', 'html', 'htm', 'log',
  'toml', 'ini', 'conf', 'env', 'rst', 'adoc', 'go', 'ts', 'tsx', 'js', 'jsx',
  'py', 'java', 'kt', 'rs', 'c', 'h', 'cpp', 'cc', 'cs', 'sql', 'sh', 'bash',
  'zsh', 'rb', 'php', 'swift', 'scala', 'vue', 'svelte', 'css', 'scss', 'less',
  'proto', 'graphql', 'gradle', 'properties', 'gitignore', 'dockerfile',
]);

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const PDF_EXT = new Set(['pdf']);

export function fileExt(name: string): string {
  const base = name.split(/[/\\]/).pop() || name;
  const i = base.lastIndexOf('.');
  return i >= 0 ? base.slice(i + 1).toLowerCase() : '';
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isPdfFile(name: string, mime?: string): boolean {
  return PDF_EXT.has(fileExt(name)) || mime === 'application/pdf';
}

export function isPdfAttachment(att: Pick<IssueAttachment, 'kind' | 'name' | 'mime'>): boolean {
  return att.kind === 'pdf' || isPdfFile(att.name, att.mime);
}

export function maxBytesForAttachment(name: string, mime?: string): number {
  return isPdfFile(name, mime) ? MAX_PDF_ATTACHMENT_BYTES : MAX_ATTACHMENT_BYTES;
}

function looksLikeText(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 4096);
  let suspicious = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0) return false;
    if (b < 7 || (b > 13 && b < 32)) suspicious++;
  }
  return suspicious / Math.max(n, 1) < 0.08;
}

function isPdfMagic(buf: Uint8Array): boolean {
  return buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

async function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

export async function fileToAttachment(file: File): Promise<IssueAttachment> {
  const ext = fileExt(file.name);
  const id = `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const base: Omit<IssueAttachment, 'kind'> = {
    id,
    name: file.name,
    mime: file.type || undefined,
    size: file.size,
  };

  if (IMAGE_EXT.has(ext) || (file.type && file.type.startsWith('image/'))) {
    const dataUrl = await readAsDataURL(file);
    return { ...base, kind: 'image', dataUrl };
  }

  if (isPdfFile(file.name, file.type) || isPdfMagic(new Uint8Array(await file.slice(0, 8).arrayBuffer()))) {
    const dataUrl = await readAsDataURL(file);
    return { ...base, kind: 'pdf', mime: file.type || 'application/pdf', dataUrl };
  }

  if (TEXT_EXT.has(ext) || file.type.startsWith('text/') || file.type === 'application/json') {
    let text = await file.text();
    if (text.length > MAX_ATTACHMENT_TEXT_CHARS) {
      text = `${text.slice(0, MAX_ATTACHMENT_TEXT_CHARS)}\n\n… (truncated)`;
    }
    return { ...base, kind: 'text', text };
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  if (looksLikeText(buf)) {
    let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    if (text.length > MAX_ATTACHMENT_TEXT_CHARS) {
      text = `${text.slice(0, MAX_ATTACHMENT_TEXT_CHARS)}\n\n… (truncated)`;
    }
    return { ...base, kind: 'text', text };
  }

  return { ...base, kind: 'file' };
}

export async function filesToAttachments(
  files: File[],
  existing: IssueAttachment[],
  lang: string = 'zh'
): Promise<{ attachments: IssueAttachment[]; errors: string[] }> {
  const errors: string[] = [];
  const next = [...existing];
  const seen = new Set(existing.map((a) => `${a.name}:${a.size}`));

  for (const file of files) {
    if (next.length >= MAX_ISSUE_ATTACHMENTS) {
      errors.push(
        lang === 'zh'
          ? `最多附加 ${MAX_ISSUE_ATTACHMENTS} 个文件`
          : `At most ${MAX_ISSUE_ATTACHMENTS} files`
      );
      break;
    }
    const key = `${file.name}:${file.size}`;
    const limit = maxBytesForAttachment(file.name, file.type);
    const existingIdx = next.findIndex((a) => `${a.name}:${a.size}` === key);
    if (existingIdx >= 0) {
      const prev = next[existingIdx];
      if (prev.dataUrl || prev.text) continue;
      if (file.size > limit) {
        errors.push(
          lang === 'zh'
            ? `${file.name} 超过 ${formatFileSize(limit)} 限制`
            : `${file.name} exceeds ${formatFileSize(limit)}`
        );
        continue;
      }
      try {
        const att = await fileToAttachment(file);
        next[existingIdx] = { ...att, id: prev.id };
        seen.add(key);
      } catch {
        errors.push(lang === 'zh' ? `无法读取 ${file.name}` : `Could not read ${file.name}`);
      }
      continue;
    }
    if (file.size > limit) {
      errors.push(
        lang === 'zh'
          ? `${file.name} 超过 ${formatFileSize(limit)} 限制`
          : `${file.name} exceeds ${formatFileSize(limit)}`
      );
      continue;
    }
    try {
      const att = await fileToAttachment(file);
      next.push(att);
      seen.add(key);
    } catch {
      errors.push(lang === 'zh' ? `无法读取 ${file.name}` : `Could not read ${file.name}`);
    }
  }

  return { attachments: next, errors };
}

export function promptDescription(issue: Pick<Issue, 'description' | 'attachments'>): string {
  const parts = [issue.description || ''];
  for (const a of issue.attachments || []) {
    if (a.text?.trim()) {
      parts.push(`\n\n----- Attached file: ${a.name} -----\n${a.text}`);
    } else if (a.kind === 'image') {
      parts.push(`\n\n[Attached image: ${a.name}]`);
    } else {
      parts.push(`\n\n[Attached file: ${a.name}]`);
    }
  }
  return parts.join('');
}
