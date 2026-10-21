import React from 'react';
import { Issue, GitRepo } from '../../types';
import { Language, ThemeStyle, getTranslation } from '../../lib/i18n';
import { THEME_CONFIGS } from '../../lib/theme';
import { FileText, GitBranch, Pencil } from 'lucide-react';

interface IssueMetaLineProps {
  issue: Issue;
  associatedRepos: GitRepo[];
  canEditRepos: boolean;
  editingRepos: boolean;
  onToggleReposEdit: () => void;
  briefExpanded: boolean;
  onToggleBrief: () => void;
  lang: Language;
  themeStyle: ThemeStyle;
}

function statusLabel(status: Issue['status'], lang: Language): string {
  if (lang === 'zh') {
    if (status === 'requirements') return '需求列表';
    if (status === 'backlog') return '待执行';
    if (status === 'in_progress') return '进行中';
    if (status === 'in_review') return '待评审';
    return '已完成';
  }
  if (status === 'requirements') return 'Requirements';
  if (status === 'backlog') return 'Backlog';
  if (status === 'in_progress') return 'In progress';
  if (status === 'in_review') return 'In review';
  return 'Completed';
}

function statusClass(status: Issue['status']): string {
  if (status === 'requirements') return 'bg-cyan-500/10 border-cyan-500/30 text-cyan-600 dark:text-cyan-300';
  if (status === 'backlog') return 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-300';
  if (status === 'in_progress') return 'bg-indigo-500/10 border-indigo-500/30 text-indigo-600 dark:text-indigo-300';
  if (status === 'in_review') return 'bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-purple-300';
  return 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-300';
}

export const IssueMetaLine: React.FC<IssueMetaLineProps> = ({
  issue,
  associatedRepos,
  canEditRepos,
  editingRepos,
  onToggleReposEdit,
  briefExpanded,
  onToggleBrief,
  lang,
  themeStyle,
}) => {
  const themeConfig = THEME_CONFIGS[themeStyle] || THEME_CONFIGS.light;
  const t = getTranslation(lang);
  const repoNames = associatedRepos.map((r) => r.name).filter(Boolean);
  const repoLabel =
    repoNames.length > 0
      ? repoNames.join(', ')
      : lang === 'zh'
        ? '未关联仓库'
        : 'No repos';
  const briefFilled = !!(issue.description || '').trim();

  return (
    <div
      className={`px-5 py-1.5 border-b flex items-center gap-2 min-w-0 text-[11px] ${themeConfig.subtleBorder} ${themeConfig.modalHeaderBg}`}
    >
      <span
        className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider shrink-0 border ${statusClass(issue.status)}`}
      >
        {statusLabel(issue.status, lang)}
      </span>

      <button
        type="button"
        onClick={onToggleReposEdit}
        disabled={!canEditRepos && !editingRepos}
        className={`inline-flex items-center gap-1 min-w-0 max-w-[42%] truncate rounded-md px-1.5 py-0.5 border transition-colors ${themeConfig.inputBorder} ${
          editingRepos
            ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-700 dark:text-indigo-200'
            : `${themeConfig.textSecondary} hover:bg-black/5 dark:hover:bg-white/5`
        } ${!canEditRepos && !editingRepos ? 'opacity-80 cursor-default' : ''}`}
        title={associatedRepos.map((r) => `${r.name} (${r.path || ''})`).join('\n') || repoLabel}
      >
        <GitBranch className="w-3 h-3 shrink-0 text-indigo-500" />
        <span className="truncate font-medium">{repoLabel}</span>
        {canEditRepos && <Pencil className="w-2.5 h-2.5 shrink-0 opacity-60" />}
      </button>

      <button
        type="button"
        onClick={onToggleBrief}
        className={`inline-flex items-center gap-1 shrink-0 rounded-md px-1.5 py-0.5 border transition-colors ${themeConfig.inputBorder} ${
          briefExpanded
            ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-700 dark:text-indigo-200'
            : briefFilled
              ? `${themeConfig.textSecondary} hover:bg-black/5 dark:hover:bg-white/5`
              : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200'
        }`}
        title={briefFilled ? t.issueBrief : t.issueBriefEmpty}
      >
        <FileText className="w-3 h-3 shrink-0" />
        <span className="font-medium">
          {briefFilled
            ? lang === 'zh'
              ? '需求已填写'
              : 'Brief filled'
            : lang === 'zh'
              ? '需求未填写'
              : 'Brief empty'}
        </span>
      </button>

      <span className={`ml-auto shrink-0 font-mono ${themeConfig.textMuted}`}>#{issue.id}</span>
    </div>
  );
};
