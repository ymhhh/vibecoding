import React from 'react';
import { Issue } from '../../types';
import { Language, getTranslation, ThemeStyle } from '../../lib/i18n';
import {
  specReadyForDev,
  requirementAccepted,
  hasReqDoc,
  designStale,
  designAccepted,
  hasDevSpecMarkdown,
  hasUnverifiedModifies,
  legacySpecOnly,
  backlogBlockReason,
} from '../../lib/subreq';
import {
  MessageSquare,
  FileText,
  Sparkles,
  Play,
  Terminal,
  Square,
  GitPullRequest,
  ShieldCheck,
  CheckCircle2,
  Layers,
  Loader2,
} from 'lucide-react';
import { api } from '../../lib/api';
import { hasBlockingReviewComments } from '../../lib/reviewCommentStatus';

interface StatusFocusBannerProps {
  issue: Issue;
  splitIssue: boolean;
  selectedScope: string;
  associatedRepos: { id: string }[];
  lang: Language;
  isSending?: boolean;
  setActiveTab: (tab: 'chat' | 'spec' | 'console' | 'review') => void;
  handleSendMessage: (
    customPrompt?: string,
    opts?: { forceSpecSync?: boolean; forceReqDoc?: boolean; split?: boolean; scope?: string }
  ) => Promise<void>;
  onUpdateIssue: (updatedIssue: Issue) => void;
  onStartAutoDev: (issueId: string, subRequirementId?: string) => void;
  onCancelAutoDev?: (issueId: string) => void;
  handleApproveMerge: (targets?: { repoId: string; branch: string }[]) => Promise<void>;
}

export const StatusFocusBanner: React.FC<StatusFocusBannerProps> = ({
  issue,
  splitIssue,
  selectedScope,
  associatedRepos,
  lang,
  isSending,
  setActiveTab,
  handleSendMessage,
  onUpdateIssue,
  onStartAutoDev,
  onCancelAutoDev,
  handleApproveMerge,
}) => {
  const t = getTranslation(lang);
  const reqOk = requirementAccepted(issue) || legacySpecOnly(issue);
  const canDesign = reqOk && associatedRepos.length > 0;
  const targetingSub = splitIssue && selectedScope !== 'all';
  const mergeBlocked = hasBlockingReviewComments(issue.reviewComments);

  const startDesignFromSource = () => {
    if (isSending) return;
    if (!canDesign) {
      window.alert(
        !reqOk
          ? lang === 'zh'
            ? '请先确认需求文档，再生成开发设计。'
            : 'Accept the requirement document before generating design.'
          : lang === 'zh'
            ? '请先关联至少一个代码仓库。'
            : 'Associate at least one repository first.'
      );
      return;
    }
    if (splitIssue && !targetingSub) {
      window.alert(
        lang === 'zh'
          ? '请先选择一个子需求再生成开发设计'
          : 'Pick a sub-requirement before generating design'
      );
      return;
    }
    setActiveTab('chat');
    void handleSendMessage(
      lang === 'zh'
        ? '请基于关联仓库源码摘要，撰写完整开发设计（架构、改动文件、实施步骤与测试用例）。'
        : 'Write a complete Dev Spec from local source excerpts (architecture, file changes, steps, tests).',
      {
        forceSpecSync: true,
        scope: targetingSub ? selectedScope : undefined,
      }
    );
  };

  const moveToBacklog = async () => {
    if (!specReadyForDev(issue)) {
      window.alert(
        backlogBlockReason(issue, lang) ||
          (lang === 'zh' ? t.backlogNeedsSpec : t.backlogNeedsSpec)
      );
      return;
    }
    if (associatedRepos.length === 0) {
      window.alert(t.backlogNeedsRepo);
      return;
    }
    if (hasUnverifiedModifies(issue)) {
      const ok = window.confirm(
        lang === 'zh'
          ? '开发设计中仍有未核实的修改点（文件可能不存在）。确认仍要进入待执行吗？'
          : 'Some modify/delete file changes are unverified. Move to backlog anyway?'
      );
      if (!ok) return;
    }
    onUpdateIssue({
      ...issue,
      status: 'backlog',
      updatedAt: new Date().toISOString(),
    });
  };

  const acceptRequirement = async () => {
    if (!hasReqDoc(issue) && !legacySpecOnly(issue)) {
      window.alert(lang === 'zh' ? '请先提炼需求文档' : 'Extract a requirement document first');
      return;
    }
    try {
      const saved = await api.acceptRequirement(issue.id);
      onUpdateIssue(saved);
      setActiveTab('spec');
    } catch (e: any) {
      window.alert(e?.message || 'accept failed');
    }
  };

  const acceptDesign = async () => {
    if (!hasDevSpecMarkdown(issue)) {
      window.alert(lang === 'zh' ? '请先生成开发设计' : 'Generate a Dev Spec first');
      return;
    }
    try {
      const saved = await api.acceptDesign(issue.id);
      onUpdateIssue(saved);
      setActiveTab('spec');
    } catch (e: any) {
      window.alert(e?.message || 'accept design failed');
    }
  };

  const canConfirmDesign =
    hasDevSpecMarkdown(issue) &&
    (requirementAccepted(issue) || legacySpecOnly(issue)) &&
    !designStale(issue) &&
    !designAccepted(issue);

  return (
    <>
      {issue.status === 'requirements' && (
        <div className="px-5 py-2.5 bg-cyan-500/10 border-b border-cyan-500/30 flex items-center justify-between text-xs text-cyan-800 dark:text-cyan-200 gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <MessageSquare className="w-4 h-4 text-cyan-500 shrink-0" />
            <div className="min-w-0">
              <span className="font-bold">{t.stageFocusReqTitle}</span>
              <span className="ml-2 hidden sm:inline opacity-80">{t.stageFocusReqDesc}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <button
              onClick={() => {
                if (splitIssue && !window.confirm(t.splitSubsConfirm)) return;
                setActiveTab('chat');
                handleSendMessage(
                  lang === 'zh'
                    ? '请将当前需求拆分成若干可独立实施的子需求（只要标题与说明，不要写开发设计），按实施顺序排列。'
                    : 'Split this requirement into ordered slices (title + description only, no Dev Spec yet).',
                  { split: true }
                );
              }}
              className="px-2.5 py-1 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 rounded-lg text-indigo-800 dark:text-indigo-200 font-semibold text-[11px] flex items-center gap-1 transition-all"
              title={t.splitSubsHint}
            >
              <Layers className="w-3 h-3 text-indigo-500" />
              {t.splitSubsBtn}
            </button>
            <button
              onClick={() => {
                setActiveTab('chat');
                handleSendMessage(
                  lang === 'zh'
                    ? '请根据当前讨论提炼完整需求文档（目标、范围、非目标、验收标准、约束）。不要写架构或改文件清单。'
                    : 'Extract a complete requirement document (goals, scope, non-goals, acceptance, constraints). No architecture or file list.',
                  { forceReqDoc: true }
                );
              }}
              className="px-2.5 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 rounded-lg text-cyan-800 dark:text-cyan-200 font-semibold text-[11px] flex items-center gap-1 transition-all"
            >
              <Sparkles className="w-3 h-3 text-cyan-500" />
              {t.extractReqBtn}
            </button>
            {hasReqDoc(issue) && !requirementAccepted(issue) && (
              <button
                onClick={acceptRequirement}
                className="px-2.5 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 rounded-lg text-emerald-900 dark:text-emerald-200 font-semibold text-[11px] transition-all"
              >
                {t.acceptReqBtn}
              </button>
            )}
            {canDesign && (
              <button
                type="button"
                onClick={startDesignFromSource}
                disabled={!!isSending}
                className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg text-amber-900 dark:text-amber-200 font-semibold text-[11px] flex items-center gap-1 transition-all disabled:opacity-50"
                title={t.extractSpecHint || t.sourceScanNotice}
              >
                {isSending ? (
                  <Loader2 className="w-3 h-3 text-amber-500 animate-spin" />
                ) : (
                  <FileText className="w-3 h-3 text-amber-500" />
                )}
                {isSending
                  ? lang === 'zh'
                    ? '正在生成设计…'
                    : 'Generating…'
                  : t.extractSpecBtn}
              </button>
            )}
            {canConfirmDesign && (
              <button
                onClick={acceptDesign}
                className="px-2.5 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 rounded-lg text-emerald-900 dark:text-emerald-200 font-semibold text-[11px] transition-all"
              >
                {t.acceptDesignBtn}
              </button>
            )}
            {specReadyForDev(issue) && associatedRepos.length > 0 && (
              <button
                onClick={moveToBacklog}
                className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg text-amber-900 dark:text-amber-200 font-semibold text-[11px] transition-all"
              >
                {t.acceptSpecBacklog}
              </button>
            )}
            {designStale(issue) && (
              <span className="text-[10px] text-rose-600 dark:text-rose-300 font-semibold">
                {lang === 'zh' ? '设计已过期，请重新生成' : 'Design stale — regenerate'}
              </span>
            )}
          </div>
        </div>
      )}

      {issue.status === 'backlog' && (
        <div className="px-5 py-2.5 bg-amber-500/10 border-b border-amber-500/30 flex items-center justify-between text-xs text-amber-800 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-amber-500 shrink-0" />
            <div>
              <span className="font-bold">{t.stageFocusBacklogTitle}</span>
              <span className="ml-2 hidden sm:inline opacity-80">{t.stageFocusBacklogDesc}</span>
            </div>
          </div>
          <button
            onClick={() => {
              onStartAutoDev(issue.id);
              setActiveTab('console');
            }}
            className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold text-[11px] flex items-center gap-1.5 shadow transition-all shrink-0"
          >
            <Play className="w-3 h-3 fill-current" />
            {t.startAutoDev}
          </button>
        </div>
      )}

      {issue.status === 'in_progress' && (
        <div className="px-5 py-2.5 bg-indigo-500/10 border-b border-indigo-500/30 flex items-center justify-between text-xs text-indigo-800 dark:text-indigo-200">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-500 animate-spin shrink-0" />
            <div>
              <span className="font-bold">
                {t.stageFocusProgressTitle} ({issue.autoDevProgress}%)
              </span>
              <span className="ml-2 hidden sm:inline opacity-80">{t.stageFocusProgressDesc}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onCancelAutoDev && (
              <button
                onClick={() => onCancelAutoDev(issue.id)}
                className="px-2.5 py-1 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 rounded-lg text-rose-800 dark:text-rose-200 font-semibold text-[11px] flex items-center gap-1 transition-all"
              >
                <Square className="w-3 h-3" />
                {t.cancel}
              </button>
            )}
            <button
              onClick={() => setActiveTab('console')}
              className="px-2.5 py-1 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 rounded-lg text-indigo-800 dark:text-indigo-200 font-semibold text-[11px] flex items-center gap-1 transition-all"
            >
              <Terminal className="w-3 h-3 text-indigo-500" />
              {t.viewLogsBtn}
            </button>
          </div>
        </div>
      )}

      {issue.status === 'in_review' && (
        <div className="px-5 py-2.5 bg-purple-500/10 border-b border-purple-500/30 flex items-center justify-between text-xs text-purple-800 dark:text-purple-200">
          <div className="flex items-center gap-2">
            <GitPullRequest className="w-4 h-4 text-purple-500 shrink-0" />
            <div>
              <span className="font-bold">{t.stageFocusReviewTitle}</span>
              <span className="ml-2 hidden sm:inline opacity-80">{t.stageFocusReviewDesc}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              disabled={mergeBlocked}
              title={mergeBlocked ? t.mergeBlockedByComments : undefined}
              onClick={() => {
                if (mergeBlocked) {
                  setActiveTab('review');
                  return;
                }
                void handleApproveMerge([]);
                setActiveTab('review');
              }}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-[11px] flex items-center gap-1 shadow transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              {t.approveMergeBtn}
            </button>
          </div>
        </div>
      )}

      {issue.status === 'completed' && (
        <div className="px-5 py-2.5 bg-emerald-500/10 border-b border-emerald-500/30 flex items-center justify-between text-xs text-emerald-800 dark:text-emerald-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <div>
              <span className="font-bold">{t.stageFocusCompletedTitle}</span>
              <span className="ml-2 hidden sm:inline opacity-80">{t.stageFocusCompletedDesc}</span>
            </div>
          </div>
          <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-mono text-[10px] font-bold shrink-0">
            {t.scoreMerged}
          </span>
        </div>
      )}
    </>
  );
};
