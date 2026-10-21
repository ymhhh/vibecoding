import React from 'react';
import { Issue } from '../../types';
import { Language, getTranslation, ThemeStyle } from '../../lib/i18n';
import { THEME_CONFIGS } from '../../lib/theme';
import { WorkspacePreset } from '../../lib/storage';
import { MessageSquare, Terminal, GitPullRequest } from 'lucide-react';

interface IssueDetailTabsProps {
  issue: Issue;
  preset: WorkspacePreset;
  setPreset: (preset: WorkspacePreset) => void;
  lang: Language;
  themeStyle: ThemeStyle;
}

export const IssueDetailTabs: React.FC<IssueDetailTabsProps> = ({
  issue,
  preset,
  setPreset,
  lang,
  themeStyle,
}) => {
  const themeConfig = THEME_CONFIGS[themeStyle] || THEME_CONFIGS.light;
  const t = getTranslation(lang);

  const items: { id: WorkspacePreset; icon: typeof MessageSquare; label: string; focus?: string }[] = [
    {
      id: 'requirement',
      icon: MessageSquare,
      label: t.presetRequirement,
      focus:
        issue.status === 'requirements' || issue.status === 'backlog'
          ? lang === 'zh'
            ? '当前重点'
            : 'Focus'
          : undefined,
    },
    {
      id: 'coding',
      icon: Terminal,
      label: t.presetCoding,
      focus:
        issue.status === 'in_progress'
          ? lang === 'zh'
            ? '编码中'
            : 'Coding'
          : undefined,
    },
    {
      id: 'review',
      icon: GitPullRequest,
      label: t.presetReview,
      focus:
        issue.status === 'in_review'
          ? lang === 'zh'
            ? '优先评审'
            : 'Focus'
          : issue.status === 'completed'
            ? lang === 'zh'
              ? '成果归档'
              : 'Archived'
            : undefined,
    },
  ];

  return (
    <div className={`flex border-b px-6 gap-6 text-xs font-semibold overflow-x-auto ${themeConfig.subtleBorder} ${themeConfig.modalHeaderBg}`}>
      {items.map(({ id, icon: Icon, label, focus }) => (
        <button
          key={id}
          type="button"
          onClick={() => setPreset(id)}
          className={`py-3 border-b-2 flex items-center gap-2 transition-colors shrink-0 ${
            preset === id
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-300 font-bold'
              : `border-transparent ${themeConfig.textSecondary} hover:${themeConfig.textPrimary}`
          }`}
        >
          <Icon className="w-4 h-4" />
          {label}
          {focus && (
            <span
              className={`px-1.5 py-0.5 rounded text-[9px] border font-bold ${
                id === 'coding'
                  ? 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border-indigo-500/40 flex items-center gap-1'
                  : id === 'review'
                    ? issue.status === 'completed'
                      ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40'
                      : 'bg-purple-500/20 text-purple-700 dark:text-purple-200 border-purple-500/40'
                    : 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/40'
              }`}
            >
              {id === 'coding' && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />}
              {focus}
            </span>
          )}
        </button>
      ))}
    </div>
  );
};
