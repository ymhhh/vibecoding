import { Issue, IssueKind, IssueStatus, Priority } from '../types';
import { Language } from './i18n';
import { backlogBlockReason } from './subreq';
import { normalizeIssueKind } from './issueKind';

export type BoardViewMode = 'board' | 'list';

export interface BoardFilters {
  kind: IssueKind | '';
  repoId: string;
  priority: Priority | '';
}

export const EMPTY_BOARD_FILTERS: BoardFilters = {
  kind: '',
  repoId: '',
  priority: '',
};

export function applyBoardFilters(issues: Issue[], filters: BoardFilters): Issue[] {
  return issues.filter((issue) => {
    if (filters.kind && normalizeIssueKind(issue.kind) !== filters.kind) return false;
    if (filters.priority && issue.priority !== filters.priority) return false;
    if (filters.repoId && !(issue.associatedRepoIds || []).includes(filters.repoId)) return false;
    return true;
  });
}

/** In-review issues that still need local approve-and-merge (#42). */
export function pendingLocalReviewIssues(issues: Issue[]): Issue[] {
  return issues.filter(
    (i) => i.status === 'in_review' && (!i.prInfo || i.prInfo.status !== 'merged')
  );
}

/**
 * Why a status move would be refused by the existing move action.
 * Empty string means the move is allowed (same checks as handleMoveColumn).
 */
export function moveBlockReason(
  issue: Issue,
  newStatus: IssueStatus,
  lang: Language = 'en'
): string {
  if (issue.status === newStatus) return '';
  if (newStatus === 'backlog') {
    const specReason = backlogBlockReason(issue, lang);
    if (specReason) return specReason;
    if (!issue.associatedRepoIds?.length) {
      return lang === 'zh'
        ? '移入待执行前需关联至少一个 Git 仓库'
        : 'Associate at least one Git repository before backlog';
    }
  }
  if (newStatus === 'in_review' && !issue.prInfo) {
    return lang === 'zh'
      ? '进入评审前需先完成一次 Auto-Dev'
      : 'Complete Auto-Dev before moving to in review';
  }
  return '';
}
