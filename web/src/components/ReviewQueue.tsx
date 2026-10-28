import React from 'react';
import { GitPullRequest, X } from 'lucide-react';
import { Issue } from '../types';
import { Language, ThemeStyle, getTranslation } from '../lib/i18n';
import { THEME_CONFIGS } from '../lib/theme';

interface ReviewQueueProps {
  issues: Issue[];
  onSelectIssue: (issue: Issue) => void;
  onClose: () => void;
  lang?: Language;
  themeStyle?: ThemeStyle;
}

export const ReviewQueue: React.FC<ReviewQueueProps> = ({
  issues,
  onSelectIssue,
  onClose,
  lang = 'en',
  themeStyle = 'light',
}) => {
  const t = getTranslation(lang);
  const themeConfig = THEME_CONFIGS[themeStyle] || THEME_CONFIGS.light;
  const isLight = themeConfig.isLight;

  return (
    <div
      className={`shrink-0 border-b px-3 sm:px-6 py-3 ${themeConfig.subtleBorder} ${
        isLight ? 'bg-purple-50/70' : 'bg-purple-950/20'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <GitPullRequest className="w-4 h-4 text-purple-500 shrink-0" />
          <h3 className={`text-sm font-bold truncate ${themeConfig.textPrimary}`}>
            {t.reviewQueue}
          </h3>
          <span
            className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${
              isLight
                ? 'bg-purple-100 text-purple-900 border-purple-300'
                : 'bg-purple-500/20 text-purple-200 border-purple-500/40'
            }`}
          >
            {issues.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`p-1 rounded-lg border transition-colors ${
            isLight
              ? 'bg-white hover:bg-slate-100 border-slate-300 text-slate-600'
              : 'bg-white/10 hover:bg-white/15 border-white/15 text-slate-300'
          }`}
          title={t.close}
          aria-label={t.close}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <p className={`text-[11px] mb-2 ${themeConfig.textSecondary}`}>{t.reviewQueueHint}</p>
      {issues.length === 0 ? (
        <p className={`text-xs ${themeConfig.textMuted}`}>{t.reviewQueueEmpty}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {issues.map((issue) => (
            <li key={issue.id}>
              <button
                type="button"
                onClick={() => onSelectIssue(issue)}
                className={`inline-flex items-center gap-2 max-w-[280px] px-2.5 py-1.5 rounded-xl border text-left text-xs transition-colors ${
                  isLight
                    ? 'bg-white hover:bg-purple-100/80 border-purple-200 text-slate-800'
                    : 'bg-black/30 hover:bg-purple-500/20 border-purple-500/30 text-slate-200'
                }`}
              >
                <GitPullRequest className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                <span className="truncate font-medium">{issue.title || issue.id}</span>
                {issue.prInfo?.branchName && (
                  <span className={`font-mono text-[10px] truncate ${themeConfig.textMuted}`}>
                    {issue.prInfo.branchName}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
