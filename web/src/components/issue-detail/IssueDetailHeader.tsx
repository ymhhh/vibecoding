import React, { useEffect, useRef, useState } from 'react';
import { Issue, IssueKind, BranchPrefixConfig } from '../../types';
import { Language, getTranslation, ThemeStyle } from '../../lib/i18n';
import { THEME_CONFIGS } from '../../lib/theme';
import { Density } from '../../lib/storage';
import { specReadyForDev } from '../../lib/subreq';
import { branchNameForIssue, normalizeIssueKind } from '../../lib/issueKind';
import { ThemedSelect } from '../ThemedSelect';
import { X, Play, Trash2, Minus, GitBranch } from 'lucide-react';

interface IssueDetailHeaderProps {
  issue: Issue;
  lang: Language;
  themeStyle: ThemeStyle;
  density?: Density;
  branchPrefixConfig?: BranchPrefixConfig;
  onClose: () => void;
  onMinimize?: () => void;
  analyzing?: boolean;
  onStartAutoDev: (issueId: string, subRequirementId?: string) => void;
  onDeleteIssue?: (issueId: string) => void;
  onUpdateIssue?: (updatedIssue: Issue) => void;
  setActiveTab: (tab: 'chat' | 'spec' | 'console' | 'review') => void;
}

export const IssueDetailHeader: React.FC<IssueDetailHeaderProps> = ({
  issue,
  lang,
  themeStyle,
  density = 'comfortable',
  branchPrefixConfig,
  onClose,
  onMinimize,
  analyzing,
  onStartAutoDev,
  onDeleteIssue,
  onUpdateIssue,
  setActiveTab,
}) => {
  const themeConfig = THEME_CONFIGS[themeStyle] || THEME_CONFIGS.light;
  const t = getTranslation(lang);
  const isLight = themeConfig.isLight;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteWrapRef = useRef<HTMLDivElement>(null);
  const kind = normalizeIssueKind(issue.kind);
  const canEditKind = issue.status === 'requirements' || issue.status === 'backlog';
  const branchPreview = issue.prInfo?.branchName || branchNameForIssue(branchPrefixConfig, issue);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [issue.id]);

  useEffect(() => {
    if (!confirmingDelete) return;
    const onPointerDown = (e: PointerEvent) => {
      if (deleteWrapRef.current?.contains(e.target as Node)) return;
      setConfirmingDelete(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [confirmingDelete]);

  const setKind = (next: IssueKind) => {
    if (!onUpdateIssue || next === kind) return;
    onUpdateIssue({
      ...issue,
      kind: next,
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <div className={`${density === 'compact' ? 'px-4 py-3' : 'p-5'} border-b flex items-center justify-between gap-4 ${themeConfig.subtleBorder} ${themeConfig.modalHeaderBg}`}>
      <div className="flex items-center gap-3 overflow-hidden min-w-0">
        <span
          className={`px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider shrink-0 border ${
            issue.status === 'requirements'
              ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-600 dark:text-cyan-300'
              : issue.status === 'backlog'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-300'
              : issue.status === 'in_progress'
              ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-600 dark:text-indigo-300 animate-pulse'
              : issue.status === 'in_review'
              ? 'bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-purple-300'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-300'
          }`}
        >
          {issue.status === 'requirements'
            ? '需求列表'
            : issue.status === 'backlog'
            ? '待执行'
            : issue.status === 'in_progress'
            ? '进行中'
            : issue.status === 'in_review'
            ? '待评审'
            : '已完成'}
        </span>

        <div className="overflow-hidden min-w-0">
          <h2 className={`text-lg font-bold truncate ${themeConfig.textPrimary}`}>{issue.title}</h2>
          <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs mt-0.5 ${themeConfig.textSecondary}`}>
            <span className="shrink-0">Issue #{issue.id}</span>
            <label className="flex items-center gap-1.5 min-w-0">
              <span className={`shrink-0 ${themeConfig.textMuted}`}>{t.createIssueKind}</span>
              {canEditKind && onUpdateIssue ? (
                <ThemedSelect
                  value={kind}
                  onChange={(e) => setKind(e.target.value as IssueKind)}
                  isLight={isLight}
                  chevronClassName={themeConfig.textSecondary}
                  className={`px-2 py-0.5 border rounded-md text-[11px] font-semibold max-w-[140px] ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                >
                  <option value="feature">{t.issueKindFeature}</option>
                  <option value="bugfix">{t.issueKindBugfix}</option>
                  <option value="hotfix">{t.issueKindHotfix}</option>
                </ThemedSelect>
              ) : (
                <span className="font-semibold">
                  {kind === 'bugfix'
                    ? t.issueKindBugfix
                    : kind === 'hotfix'
                      ? t.issueKindHotfix
                      : t.issueKindFeature}
                </span>
              )}
            </label>
            <span
              className="inline-flex items-center gap-1 font-mono text-[10px] min-w-0 max-w-full"
              title={branchPreview}
            >
              <GitBranch className="w-3 h-3 text-indigo-500 shrink-0" />
              <span className="truncate">{branchPreview}</span>
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {issue.status === 'backlog' && specReadyForDev(issue) && !confirmingDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStartAutoDev(issue.id);
              setActiveTab('console');
            }}
            className="px-3.5 py-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold text-xs rounded-xl shadow flex items-center gap-1.5 transition-all"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            启动自治开发
          </button>
        )}

        {onMinimize && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMinimize();
            }}
            aria-label={analyzing ? t.minimizeWhileAnalyzing : t.minimizeIssue}
            className={`p-2 rounded-xl transition-colors ${themeConfig.textSecondary} hover:${themeConfig.textPrimary} hover:bg-black/5 dark:hover:bg-white/10`}
            title={analyzing ? t.minimizeWhileAnalyzing : t.minimizeIssue}
          >
            <Minus className="w-5 h-5" />
          </button>
        )}
        {onDeleteIssue && (
          <div className="flex items-center gap-1.5" ref={deleteWrapRef}>
            {confirmingDelete ? (
              <>
                <span className={`text-[11px] font-medium whitespace-nowrap ${themeConfig.textPrimary}`}>
                  {t.deleteIssueConfirm}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmingDelete(false);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${themeConfig.textSecondary} hover:bg-black/5 dark:hover:bg-white/10`}
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmingDelete(false);
                    onDeleteIssue(issue.id);
                  }}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-white bg-rose-500 hover:bg-rose-600"
                >
                  {t.confirm}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setConfirmingDelete(true);
                }}
                className="p-2 rounded-xl transition-colors text-rose-400 hover:bg-rose-500/10"
                title={t.deleteIssueTitle}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label={analyzing ? t.closeWhileAnalyzing : t.closeIssue}
          className={`p-2 rounded-xl transition-colors ${themeConfig.textSecondary} hover:${themeConfig.textPrimary} hover:bg-black/5 dark:hover:bg-white/10`}
          title={analyzing ? t.closeWhileAnalyzing : t.closeIssue}
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
