import React from 'react';
import { CheckCircle2, GitBranch, GitPullRequest, Tag } from 'lucide-react';
import { BranchPrefixConfig, GitRepo, Issue, IssueStatus } from '../types';
import { Language, ThemeStyle, getTranslation } from '../lib/i18n';
import { THEME_CONFIGS } from '../lib/theme';
import { branchNameForIssue, normalizeIssueKind } from '../lib/issueKind';

interface IssueListViewProps {
  issues: Issue[];
  gitRepos: GitRepo[];
  branchPrefixConfig?: BranchPrefixConfig;
  onSelectIssue: (issue: Issue) => void;
  lang?: Language;
  themeStyle?: ThemeStyle;
}

const STATUS_ORDER: IssueStatus[] = [
  'requirements',
  'backlog',
  'in_progress',
  'in_review',
  'completed',
];

export const IssueListView: React.FC<IssueListViewProps> = ({
  issues,
  gitRepos,
  branchPrefixConfig,
  onSelectIssue,
  lang = 'en',
  themeStyle = 'light',
}) => {
  const t = getTranslation(lang);
  const themeConfig = THEME_CONFIGS[themeStyle] || THEME_CONFIGS.light;
  const isLight = themeConfig.isLight;

  const statusTitle = (s: IssueStatus) => {
    switch (s) {
      case 'requirements':
        return t.colRequirements;
      case 'backlog':
        return t.colBacklog;
      case 'in_progress':
        return t.colInProgress;
      case 'in_review':
        return t.colInReview;
      case 'completed':
        return t.colCompleted;
    }
  };

  const sorted = [...issues].sort((a, b) => {
    const si = STATUS_ORDER.indexOf(a.status);
    const sj = STATUS_ORDER.indexOf(b.status);
    if (si !== sj) return si - sj;
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });

  if (sorted.length === 0) {
    return (
      <div className={`flex-1 overflow-auto p-6 flex items-center justify-center ${themeConfig.textMuted}`}>
        <p className="text-sm">{t.listEmpty}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-3 sm:p-6">
      <div
        className={`rounded-2xl border overflow-hidden ${themeConfig.columnBg} ${
          isLight ? 'border-slate-200' : 'border-white/10'
        }`}
      >
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr
              className={`text-[11px] uppercase tracking-wide border-b ${
                isLight
                  ? 'bg-slate-50 text-slate-500 border-slate-200'
                  : 'bg-black/20 text-slate-400 border-white/10'
              }`}
            >
              <th className="px-3 py-2.5 font-semibold">{t.listColTitle}</th>
              <th className="px-3 py-2.5 font-semibold hidden sm:table-cell">{t.listColStatus}</th>
              <th className="px-3 py-2.5 font-semibold hidden md:table-cell">{t.listColKind}</th>
              <th className="px-3 py-2.5 font-semibold hidden md:table-cell">{t.listColPriority}</th>
              <th className="px-3 py-2.5 font-semibold hidden lg:table-cell">{t.listColRepos}</th>
              <th className="px-3 py-2.5 font-semibold hidden lg:table-cell">{t.listColBranch}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((issue) => {
              const kind = normalizeIssueKind(issue.kind);
              const kindLabel =
                kind === 'bugfix'
                  ? t.issueKindBugfix
                  : kind === 'hotfix'
                    ? t.issueKindHotfix
                    : t.issueKindFeature;
              const priorityLabel =
                issue.priority === 'urgent'
                  ? t.priorityUrgent
                  : issue.priority === 'high'
                    ? t.priorityHigh
                    : issue.priority === 'medium'
                      ? t.priorityMedium
                      : t.priorityLow;
              const repos = gitRepos.filter((r) => (issue.associatedRepoIds || []).includes(r.id));
              const branch =
                issue.prInfo?.branchName || branchNameForIssue(branchPrefixConfig, issue, 4);

              return (
                <tr
                  key={issue.id}
                  onClick={() => onSelectIssue(issue)}
                  className={`cursor-pointer border-b last:border-b-0 transition-colors ${
                    isLight
                      ? 'border-slate-100 hover:bg-indigo-50/60'
                      : 'border-white/5 hover:bg-white/5'
                  }`}
                >
                  <td className="px-3 py-2.5 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {issue.status === 'completed' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      ) : issue.status === 'in_review' ? (
                        <GitPullRequest className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                      ) : (
                        <Tag className={`w-3.5 h-3.5 shrink-0 ${themeConfig.textMuted}`} />
                      )}
                      <span className={`font-medium truncate ${themeConfig.textPrimary}`}>
                        {issue.title || issue.id}
                      </span>
                    </div>
                    <div className={`sm:hidden text-[11px] mt-0.5 ${themeConfig.textMuted}`}>
                      {statusTitle(issue.status)}
                    </div>
                  </td>
                  <td className={`px-3 py-2.5 hidden sm:table-cell ${themeConfig.textSecondary}`}>
                    {statusTitle(issue.status)}
                  </td>
                  <td className={`px-3 py-2.5 hidden md:table-cell ${themeConfig.textSecondary}`}>
                    {kindLabel}
                  </td>
                  <td className={`px-3 py-2.5 hidden md:table-cell ${themeConfig.textSecondary}`}>
                    {priorityLabel}
                  </td>
                  <td className={`px-3 py-2.5 hidden lg:table-cell ${themeConfig.textMuted}`}>
                    <span className="truncate block max-w-[180px]">
                      {repos.map((r) => r.name || r.path).join(', ') || '—'}
                    </span>
                  </td>
                  <td className={`px-3 py-2.5 hidden lg:table-cell font-mono text-[11px] ${themeConfig.textMuted}`}>
                    <span className="inline-flex items-center gap-1 truncate max-w-[200px]">
                      <GitBranch className="w-3 h-3 shrink-0" />
                      {branch}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
