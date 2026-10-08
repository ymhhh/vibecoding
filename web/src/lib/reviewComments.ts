import type { DiffComment } from '../types';

export const QUOTE_MAX_CHARS = 2048;

export function truncateQuote(s: string): string {
  const trimmed = s.replace(/\n+$/, '');
  if ([...trimmed].length <= QUOTE_MAX_CHARS) return trimmed;
  return [...trimmed].slice(0, QUOTE_MAX_CHARS).join('') + '…';
}

/** Build the rework prompt appendix from inline diff comments. */
export function formatReviewComments(
  comments: DiffComment[],
  repoName?: (repoId: string) => string
): string {
  if (!comments.length) return '';
  const lines = ['Review comments (fix these hunks; do not unrelated refactors):'];
  let wrote = 0;
  for (const c of comments) {
    if ((c.status || '').trim() === 'fixed') continue;
    wrote++;
    let name = (c.repoId || '').trim();
    if (repoName) {
      const n = (repoName(c.repoId) || '').trim();
      if (n) name = n;
    }
    if (!name) name = 'repo';
    const path = (c.path || '').trim() || '(unknown)';
    const side = (c.side || 'new').trim() || 'new';
    let start = c.startLine;
    let end = c.endLine;
    if (end < start) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    lines.push(`- [${name}] ${path}:${side}:${start}-${end}`);
    const quote = truncateQuote(c.quote || '');
    if (quote) lines.push(`  """${quote}"""`);
    const body = (c.body || '').trim();
    if (body) lines.push(`  ${body}`);
  }
  if (!wrote) return '';
  return lines.join('\n');
}
