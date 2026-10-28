import React from 'react';
import { Issue, GitRepo, BranchPrefixConfig } from '../types';
import { Language, ThemeStyle, getTranslation } from '../lib/i18n';
import { THEME_CONFIGS } from '../lib/theme';
import { branchNameForIssue, normalizeIssueKind } from '../lib/issueKind';
import { GitBranch, FileText, CheckCircle2, Play, Sparkles, Tag, GitPullRequest, ShieldCheck, ArrowRight, Layers, Paperclip, Loader2 } from 'lucide-react';
import { hasSubRequirements, readySubCount } from '../lib/subreq';

const DND_ISSUE_TYPE = 'application/x-vibecoding-issue';

interface IssueCardProps {
  issue: Issue;
  onClick: () => void;
  onStartAutoDev: (issueId: string, subRequirementId?: string) => void;
  onMoveColumn: (issueId: string, newStatus: Issue['status']) => void;
  analyzing?: boolean;
  gitRepos: GitRepo[];
  branchPrefixConfig?: BranchPrefixConfig;
  lang?: Language;
  themeStyle?: ThemeStyle;
  draggable?: boolean;
  onDragStartCard?: (issueId: string) => void;
  onDragEndCard?: () => void;
}

export const IssueCard: React.FC<IssueCardProps> = ({
  issue,
  onClick,
  onStartAutoDev,
  onMoveColumn,
  analyzing,
  gitRepos,
  branchPrefixConfig,
  lang = 'en',
  themeStyle = 'light',
  draggable = false,
  onDragStartCard,
  onDragEndCard,
}) => {
  const t = getTranslation(lang);
  const themeConfig = THEME_CONFIGS[themeStyle] || THEME_CONFIGS.light;
  const isLight = themeConfig.isLight;

  const associatedRepos = gitRepos.filter((r) => issue.associatedRepoIds.includes(r.id));

  const priorityBadge = {
    low: {
      label: t.priorityLow,
      color: isLight
        ? 'bg-slate-100 text-slate-800 border-slate-300 font-medium'
        : 'bg-slate-800/90 text-slate-200 border-slate-700 font-medium',
    },
    medium: {
      label: t.priorityMedium,
      color: isLight
        ? 'bg-indigo-100 text-indigo-900 border-indigo-300 font-semibold'
        : 'bg-indigo-950/90 text-indigo-200 border-indigo-700/80 font-semibold',
    },
    high: {
      label: t.priorityHigh,
      color: isLight
        ? 'bg-amber-100 text-amber-900 border-amber-300 font-semibold'
        : 'bg-amber-950/90 text-amber-200 border-amber-700/80 font-semibold',
    },
    urgent: {
      label: t.priorityUrgent,
      color: isLight
        ? 'bg-rose-100 text-rose-900 border-rose-300 font-bold animate-pulse'
        : 'bg-rose-950/90 text-rose-200 border-rose-700/80 font-bold animate-pulse',
    },
  }[issue.priority];

  // Derive target branch preview from issue kind → project branch prefix.
  const activeBranchName =
    issue.prInfo?.branchName || branchNameForIssue(branchPrefixConfig, issue, 4);
  const kind = normalizeIssueKind(issue.kind);
  const kindLabel =
    kind === 'bugfix' ? t.issueKindBugfix : kind === 'hotfix' ? t.issueKindHotfix : t.issueKindFeature;
  const kindBadge =
    kind === 'bugfix'
      ? isLight
        ? 'bg-orange-100 text-orange-900 border-orange-300'
        : 'bg-orange-950/90 text-orange-200 border-orange-700/80'
      : kind === 'hotfix'
        ? isLight
          ? 'bg-rose-100 text-rose-900 border-rose-300'
          : 'bg-rose-950/90 text-rose-200 border-rose-700/80'
        : isLight
          ? 'bg-sky-100 text-sky-900 border-sky-300'
          : 'bg-sky-950/90 text-sky-200 border-sky-700/80';

  const isCompleted = issue.status === 'completed';
  const isInReview = issue.status === 'in_review';

  return (
    <div
      onClick={onClick}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.setData(DND_ISSUE_TYPE, issue.id);
        e.dataTransfer.setData('text/plain', issue.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStartCard?.(issue.id);
      }}
      onDragEnd={() => onDragEndCard?.()}
      className={`p-4 rounded-xl border backdrop-blur-md transition-all shadow-sm hover:shadow-md group flex flex-col justify-between gap-3 relative overflow-hidden min-w-0 ${
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } ${
        isCompleted
          ? isLight
            ? 'border-emerald-300 bg-emerald-50/90 hover:bg-emerald-100/60 hover:border-emerald-400'
            : 'border-emerald-500/40 bg-emerald-950/30 hover:bg-emerald-950/40 hover:border-emerald-500/60'
          : isInReview
          ? isLight
            ? 'border-purple-300 bg-purple-50/90 hover:bg-purple-100/60 hover:border-purple-400'
            : 'border-purple-500/40 bg-purple-950/30 hover:bg-purple-950/40 hover:border-purple-500/60'
          : `${themeConfig.cardBg} ${themeConfig.cardHoverBg}`
      }`}
    >
      {/* Accent top bar */}
      <div
        className={`absolute top-0 left-0 right-0 h-1 ${
          isCompleted
            ? 'bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-400'
            : isInReview
            ? 'bg-gradient-to-r from-purple-500 to-indigo-500'
            : issue.status === 'in_progress'
            ? 'bg-gradient-to-r from-indigo-500 to-purple-500'
            : 'bg-transparent'
        }`}
      />

      {/* Top Header */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
            <span className={`px-2 py-0.5 rounded-md text-[10px] border shrink-0 ${priorityBadge.color}`}>
              {priorityBadge.label}
            </span>
            <span className={`px-2 py-0.5 rounded-md text-[10px] border shrink-0 ${kindBadge}`}>
              {kindLabel}
            </span>
            {isCompleted && (
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border flex items-center gap-1 min-w-0 ${
                isLight
                  ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                  : 'bg-emerald-950/90 text-emerald-200 border-emerald-700/80'
              }`}>
                <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                <span className="truncate">{t.approvedMerged}</span>
              </span>
            )}
            {isInReview && (
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border flex items-center gap-1 min-w-0 ${
                isLight
                  ? 'bg-purple-100 text-purple-900 border-purple-300'
                  : 'bg-purple-950/90 text-purple-200 border-purple-700/80'
              }`}>
                <GitPullRequest className="w-3 h-3 text-purple-400 shrink-0" />
                <span className="truncate">{t.reviewPending}</span>
              </span>
            )}
            {analyzing && (
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold border flex items-center gap-1 shrink-0 ${
                  isLight
                    ? 'bg-indigo-100 text-indigo-900 border-indigo-300'
                    : 'bg-indigo-950/90 text-indigo-200 border-indigo-700/80'
                }`}
              >
                <Loader2 className="w-3 h-3 animate-spin text-indigo-500 shrink-0" />
                <span className="truncate">{t.analyzingBadge}</span>
              </span>
            )}
            {(issue.attachments || []).length > 0 && (
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] border flex items-center gap-1 shrink-0 ${themeConfig.badgeRepoBg} ${themeConfig.badgeRepoText}`}
                title={t.attachmentCount.replace('{n}', String(issue.attachments?.length || 0))}
              >
                <Paperclip className="w-3 h-3 shrink-0" />
                {issue.attachments?.length}
              </span>
            )}
          </div>

          <span className={`text-[10px] font-mono tracking-wide shrink-0 ${themeConfig.textMuted}`}>#{issue.id}</span>
        </div>

        {/* Title */}
        <h4 className={`font-semibold text-xs transition-colors line-clamp-2 leading-snug ${themeConfig.textPrimary} group-hover:text-indigo-500 dark:group-hover:text-indigo-300`}>
          {issue.title}
        </h4>

        {/* Repos & Branch Tags */}
        <div className="flex items-center gap-1.5 flex-wrap mt-2.5 min-w-0">
          {associatedRepos.map((repo) => (
            <span
              key={repo.id}
              title={`${t.repoTooltip}: ${repo.name}`}
              className={`px-2 py-0.5 rounded-md text-[10px] font-mono border flex items-center gap-1 max-w-full min-w-0 transition-colors ${themeConfig.badgeRepoBg} ${themeConfig.badgeRepoText}`}
            >
              <GitBranch className="w-3 h-3 text-indigo-400 shrink-0" />
              <span className="truncate">{repo.name}</span>
            </span>
          ))}

          {/* Target Branch Spec Tag */}
          <span
            title={`${t.branchTooltip}: ${activeBranchName}`}
            className={`px-1.5 py-0.5 rounded-md border text-[9px] font-mono flex items-center gap-1 max-w-full min-w-0 ${themeConfig.badgeBranchBg} ${themeConfig.badgeBranchText}`}
          >
            <Tag className="w-2.5 h-2.5 text-indigo-400 shrink-0" />
            <span className="truncate">{activeBranchName}</span>
          </span>
        </div>
      </div>

      {/* Middle Spec & Progress Status */}
      <div className={`space-y-2 pt-2 border-t ${themeConfig.subtleBorder}`}>
        <div className="flex items-center justify-between gap-2 text-[11px] min-w-0">
          <span className={`flex items-center gap-1 text-[10px] font-medium min-w-0 ${themeConfig.textSecondary}`}>
            <FileText className="w-3 h-3 opacity-80 shrink-0" />
            <span className="truncate">{t.devSpecLabel}</span>
          </span>
          {hasSubRequirements(issue) ? (
            <span className={`font-semibold flex items-center gap-1 text-[10px] shrink-0 ${
              isLight ? 'text-indigo-800' : 'text-indigo-200'
            }`}>
              <Layers className="w-3 h-3 shrink-0" />
              {t.specCountLabel
                .replace('{ready}', String(readySubCount(issue).ready))
                .replace('{total}', String(readySubCount(issue).total))}
            </span>
          ) : issue.devSpec?.rawMarkdown?.trim() ? (
            <span className={`font-semibold flex items-center gap-1 text-[10px] shrink-0 ${
              isLight ? 'text-emerald-700' : 'text-emerald-300'
            }`}>
              <CheckCircle2 className="w-3 h-3 shrink-0" />
              {t.specGenerated}
            </span>
          ) : (
            <span className={`italic text-[10px] shrink-0 ${
              isLight ? 'text-amber-800' : 'text-amber-300/90'
            }`}>{t.pendingSpec}</span>
          )}
        </div>

        {/* Status badge for completed card */}
        {isCompleted && (
          <div className={`p-1.5 rounded-lg border flex items-center justify-between text-[10px] ${
            isLight
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-emerald-950/80 border-emerald-700/80 text-emerald-200'
          }`}>
            <span className="flex items-center gap-1 font-semibold">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              {t.approvedMerged}
            </span>
            <span className="font-mono text-[9px] opacity-90">PR #{issue.prInfo?.id || '104'}</span>
          </div>
        )}

        {/* Progress Bar if in progress */}
        {issue.status === 'in_progress' && (
          <div className="space-y-1">
            <div className={`flex justify-between text-[10px] font-mono font-bold ${
              isLight ? 'text-indigo-900' : 'text-indigo-200'
            }`}>
              <span className="flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-indigo-400 animate-spin" />
                {t.autoDevCoding}
              </span>
              <span>{issue.autoDevProgress}%</span>
            </div>
            <div className={`w-full h-1.5 rounded-full overflow-hidden border ${isLight ? 'bg-slate-200 border-slate-300' : 'bg-black/60 border-white/20'}`}>
              <div
                className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 h-full transition-all duration-300"
                style={{ width: `${issue.autoDevProgress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Card Footer Actions: stack so assignee and CTA never compete for width */}
      <div className={`flex flex-col gap-2 text-[11px] pt-1 ${themeConfig.textSecondary}`}>
        <div className="flex items-center gap-1.5 text-[10px] min-w-0">
          <div className={`w-4 h-4 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold ${
            isLight
              ? 'bg-indigo-100 border border-indigo-300 text-indigo-900'
              : 'bg-indigo-950/90 border border-indigo-700/80 text-indigo-200'
          }`}>
            {issue.assignee ? issue.assignee[0].toUpperCase() : 'U'}
          </div>
          <span
            title={issue.assignee}
            className={`truncate min-w-0 flex-1 font-medium ${
              isLight ? 'text-slate-700' : 'text-slate-200'
            }`}
          >
            {issue.assignee}
          </span>
        </div>

        {(issue.status === 'requirements' || issue.status === 'backlog' || issue.status === 'in_review' || isCompleted) && (
          <div className="flex w-full min-w-0" onClick={(e) => e.stopPropagation()}>
            {issue.status === 'requirements' && (
              <button
                onClick={() => onMoveColumn(issue.id, 'backlog')}
                className={`w-full justify-center px-2.5 py-1.5 border rounded-lg text-[10px] font-bold flex items-center gap-1 whitespace-nowrap transition-all ${
                  isLight
                    ? 'bg-cyan-100 hover:bg-cyan-200 border-cyan-300 text-cyan-950'
                    : 'bg-cyan-950/90 hover:bg-cyan-900/90 border-cyan-700/80 text-cyan-200'
                }`}
              >
                <Sparkles className="w-3 h-3 text-cyan-400 shrink-0" />
                {t.scheduleToBacklog}
              </button>
            )}

            {issue.status === 'backlog' && (
              <button
                onClick={() => onStartAutoDev(issue.id)}
                className="w-full justify-center px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 border border-indigo-400/50 rounded-lg text-[10px] font-bold text-white flex items-center gap-1 whitespace-nowrap shadow-md transition-all active:scale-95"
              >
                <Play className="w-3 h-3 fill-current shrink-0" />
                {t.startAutoDev}
              </button>
            )}

            {issue.status === 'in_review' && (
              <button
                onClick={onClick}
                className="w-full justify-center px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 border border-purple-400/50 text-white rounded-lg text-[10px] font-bold flex items-center gap-1 whitespace-nowrap transition-all shadow-md animate-pulse"
              >
                <GitPullRequest className="w-3 h-3 shrink-0" />
                {t.reviewPR}
              </button>
            )}

            {isCompleted && (
              <button
                onClick={onClick}
                className={`w-full justify-center px-2 py-1.5 border rounded-lg text-[10px] font-bold flex items-center gap-1 whitespace-nowrap transition-all ${
                  isLight
                    ? 'bg-emerald-100 hover:bg-emerald-200 border-emerald-300 text-emerald-950'
                    : 'bg-emerald-950/90 hover:bg-emerald-900/90 border-emerald-700/80 text-emerald-200'
                }`}
              >
                <span>{t.viewSpecDiff}</span>
                <ArrowRight className="w-3 h-3 text-emerald-400 shrink-0" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};



