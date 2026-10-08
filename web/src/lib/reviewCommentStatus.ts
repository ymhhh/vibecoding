import type { DiffComment, DiffCommentStatus } from '../types';

export function commentStatus(c: Pick<DiffComment, 'status'>): DiffCommentStatus {
  const s = (c.status || '').trim();
  if (s === 'fixing' || s === 'fixed') return s;
  return 'open';
}

export function hasBlockingReviewComments(comments: DiffComment[] | undefined | null): boolean {
  for (const c of comments || []) {
    const st = commentStatus(c);
    if (st === 'open' || st === 'fixing') return true;
  }
  return false;
}

export function markNonFixedCommentsFixing(comments: DiffComment[]): DiffComment[] {
  return comments.map((c) =>
    commentStatus(c) === 'fixed' ? c : { ...c, status: 'fixing' as const }
  );
}
