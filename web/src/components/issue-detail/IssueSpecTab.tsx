import React, { useState } from 'react';
import { Issue, SubRequirement, DevSpec, PendingLLMSession, SpecFileChange } from '../../types';
import { Language, ThemeStyle, getTranslation } from '../../lib/i18n';
import { THEME_CONFIGS } from '../../lib/theme';
import { MarkdownView } from '../../lib/markdown';
import { SubRequirementBar } from '../SubRequirementBar';
import { FileText, Sparkles, Loader2, Download, Edit3, CheckCircle2, AlertTriangle } from 'lucide-react';
import { LLMRecoveryBar } from './LLMRecoveryBar';
import { SendMessageOpts } from './useIssueChat';
import { requirementAccepted, hasReqDoc, briefToReqMarkdown, coerceReqMarkdown, coerceDocMarkdown, legacySpecOnly, specReadyForDev, backlogBlockReason, designAccepted, designStale, hasDevSpecMarkdown } from '../../lib/subreq';
import { api } from '../../lib/api';
import { SpecRevisionBrowser } from './SpecRevisionBrowser';

interface IssueSpecTabProps {
  issue: Issue;
  splitIssue: boolean;
  activeSub: SubRequirement | undefined;
  currentSpec: DevSpec | undefined;
  selectedScope: string;
  setSelectedScope: (scope: string) => void;
  lang: Language;
  themeStyle: ThemeStyle;
  editingSpec: boolean;
  setEditingSpec: React.Dispatch<React.SetStateAction<boolean>>;
  specMarkdown: string;
  setSpecMarkdown: (value: string) => void;
  reqMarkdown: string;
  setReqMarkdown: (value: string) => void;
  exporting: boolean;
  exportHint: string;
  chatError: string;
  isSending?: boolean;
  setActiveTab: (tab: 'chat' | 'spec' | 'console' | 'review') => void;
  handleSendMessage: (customPrompt?: string, opts?: SendMessageOpts) => Promise<void>;
  handleExportDevSpec: () => Promise<void>;
  handleExportReqDoc?: () => Promise<void>;
  handleScheduleToBacklog?: () => Promise<void> | void;
  onUpdateIssue: (updatedIssue: Issue) => void;
  pendingLlm?: PendingLLMSession | null;
  onRetrySession?: () => void;
  onRegenerate?: () => void;
}

export const IssueSpecTab: React.FC<IssueSpecTabProps> = ({
  issue,
  splitIssue,
  activeSub,
  currentSpec,
  selectedScope,
  setSelectedScope,
  lang,
  themeStyle,
  editingSpec,
  setEditingSpec,
  specMarkdown,
  setSpecMarkdown,
  reqMarkdown,
  setReqMarkdown,
  exporting,
  exportHint,
  chatError,
  isSending,
  setActiveTab,
  handleSendMessage,
  handleExportDevSpec,
  handleExportReqDoc,
  handleScheduleToBacklog,
  onUpdateIssue,
  pendingLlm,
  onRetrySession,
  onRegenerate,
}) => {
  const themeConfig = THEME_CONFIGS[themeStyle] || THEME_CONFIGS.light;
  const t = getTranslation(lang);
  const [docPane, setDocPane] = useState<'req' | 'design'>(
    hasReqDoc(issue) && !requirementAccepted(issue) ? 'req' : 'design'
  );
  const [editingReq, setEditingReq] = useState(false);
  const [convertingBrief, setConvertingBrief] = useState(false);
  const [acceptingDesign, setAcceptingDesign] = useState(false);
  const changes: SpecFileChange[] = currentSpec?.fileChanges || [];

  const canConfirmDesign =
    issue.status === 'requirements' &&
    hasDevSpecMarkdown(issue) &&
    (requirementAccepted(issue) || legacySpecOnly(issue)) &&
    !designStale(issue) &&
    !designAccepted(issue);

  const acceptDesign = async () => {
    setAcceptingDesign(true);
    try {
      const saved = await api.acceptDesign(issue.id);
      onUpdateIssue(saved);
    } catch (e: any) {
      window.alert(e?.message || 'accept design failed');
    } finally {
      setAcceptingDesign(false);
    }
  };

  const convertBriefToMarkdown = async () => {
    setConvertingBrief(true);
    try {
      const saved = await api.reqDocFromBrief(issue.id);
      onUpdateIssue(saved);
      setReqMarkdown(saved.reqDoc?.rawMarkdown || '');
      setEditingReq(true);
    } catch {
      const md = briefToReqMarkdown(issue);
      const now = new Date().toISOString();
      onUpdateIssue({
        ...issue,
        reqDoc: {
          title: issue.title,
          summary: (issue.description || '').slice(0, 200),
          rawMarkdown: md,
          updatedAt: now,
        },
        docPhase: 'requirement',
        updatedAt: now,
      });
      setReqMarkdown(md);
      setEditingReq(true);
    } finally {
      setConvertingBrief(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 p-6 overflow-y-auto gap-4 text-[11px]">
      {splitIssue && (
        <SubRequirementBar
          issue={issue}
          selectedScope={selectedScope}
          onSelect={(scope) => {
            setSelectedScope(scope);
            setEditingSpec(false);
          }}
          lang={lang}
          themeStyle={themeStyle}
        />
      )}
      <div
        className={`inline-flex flex-row flex-wrap items-center gap-1 p-1 rounded-xl border w-fit max-w-full ${themeConfig.subtleBorder} ${themeConfig.cardBg}`}
        role="tablist"
        aria-label={lang === 'zh' ? '文档切换' : 'Document switch'}
      >
        <button
          type="button"
          role="tab"
          aria-selected={docPane === 'req'}
          onClick={() => setDocPane('req')}
          className={`inline-flex flex-row items-center justify-center gap-1.5 whitespace-nowrap shrink-0 px-3 py-1.5 rounded-lg border font-semibold transition-colors ${
            docPane === 'req'
              ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-800 dark:text-cyan-200'
              : `border-transparent ${themeConfig.btnSecondaryText} hover:bg-black/5 dark:hover:bg-white/5`
          }`}
        >
          <span>{t.docTabReq}</span>
          {issue.reqDoc?.acceptedAt && requirementAccepted(issue) && (
            <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={docPane === 'design'}
          onClick={() => setDocPane('design')}
          className={`inline-flex flex-row items-center justify-center gap-1.5 whitespace-nowrap shrink-0 px-3 py-1.5 rounded-lg border font-semibold transition-colors ${
            docPane === 'design'
              ? 'border-amber-500/50 bg-amber-500/15 text-amber-900 dark:text-amber-200'
              : `border-transparent ${themeConfig.btnSecondaryText} hover:bg-black/5 dark:hover:bg-white/5`
          }`}
        >
          <span>{t.docTabDesign}</span>
        </button>
      </div>
      <p className={`text-[11px] ${themeConfig.textMuted}`}>{t.sourceScanNotice}</p>

      {isSending && (
        <div className="flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-300">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{lang === 'zh' ? '模型处理中…' : 'Model is working…'}</span>
        </div>
      )}
      {chatError && !pendingLlm && (
        <div className="text-[11px] text-rose-500 select-text">{chatError}</div>
      )}
      <LLMRecoveryBar
        session={pendingLlm || null}
        lang={lang}
        themeStyle={themeStyle}
        busy={!!isSending}
        onRetrySession={() => onRetrySession?.()}
        onRegenerate={() => onRegenerate?.()}
      />

      {(!!issue.reqDoc?.rawMarkdown ||
        !!issue.currentRequirementRevisionId ||
        !!issue.currentDevelopmentRevisionId) && (
        <div className="mb-3">
          <SpecRevisionBrowser
            issue={issue}
            lang={lang}
            themeStyle={themeStyle}
            refreshKey={`${issue.currentRequirementRevisionId || ''}:${issue.currentDevelopmentRevisionId || ''}:${issue.updatedAt}`}
          />
        </div>
      )}

      {docPane === 'req' ? (
        !issue.reqDoc?.rawMarkdown ? (
          <div className={`p-12 text-center border-2 border-dashed rounded-2xl ${themeConfig.subtleBorder} ${themeConfig.cardBg}`}>
            <FileText className={`w-12 h-12 mx-auto mb-3 ${themeConfig.textMuted}`} />
            <h3 className={`text-base font-semibold ${themeConfig.textPrimary}`}>{t.noReqDocYet}</h3>
            <p className={`text-xs max-w-md mx-auto mt-1 mb-4 ${themeConfig.textMuted}`}>{t.noReqDocHint}</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={() => void convertBriefToMarkdown()}
                disabled={convertingBrief}
                className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs rounded-xl shadow-lg flex items-center gap-2 transition-all disabled:opacity-50"
              >
                {convertingBrief ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FileText className="w-4 h-4" />
                )}
                {t.convertBriefToReqMd}
              </button>
              <button
                onClick={() => {
                  setActiveTab('chat');
                  handleSendMessage(
                    lang === 'zh'
                      ? '请根据当前讨论提炼完整需求文档（目标、范围、非目标、验收标准、约束），输出 Markdown。'
                      : 'Extract a complete requirement document as Markdown.',
                    { forceReqDoc: true }
                  );
                }}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl shadow-lg flex items-center gap-2 transition-all"
              >
                <Sparkles className="w-4 h-4" />
                {t.extractReqBtn}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => handleExportReqDoc?.()}
                disabled={exporting || !handleExportReqDoc}
                className={`px-3 py-1.5 border font-semibold text-xs rounded-lg flex items-center gap-1.5 disabled:opacity-50 ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText}`}
              >
                {exporting ? (
                  <Loader2 className="w-3.5 h-3.5 text-emerald-500 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5 text-emerald-500" />
                )}
                {t.exportReqDoc}
              </button>
              <button
                onClick={() => {
                  if (!editingReq) setReqMarkdown(issue.reqDoc?.rawMarkdown || '');
                  setEditingReq(!editingReq);
                }}
                className={`px-3 py-1.5 border font-semibold text-xs rounded-lg flex items-center gap-1.5 ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText}`}
              >
                <Edit3 className="w-3.5 h-3.5 text-cyan-500" />
                {editingReq
                  ? lang === 'zh'
                    ? '退出编辑'
                    : 'Cancel'
                  : lang === 'zh'
                    ? '编辑 Markdown'
                    : 'Edit Markdown'}
              </button>
            </div>
            {exportHint && docPane === 'req' && (
              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 select-text break-all">
                {exportHint}
              </div>
            )}
            {editingReq ? (
              <div className="space-y-2">
                <textarea
                  value={reqMarkdown}
                  onChange={(e) => setReqMarkdown(e.target.value)}
                  spellCheck={false}
                  className={`min-h-[360px] w-full p-4 border rounded-xl font-mono text-xs ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setReqMarkdown(issue.reqDoc?.rawMarkdown || '');
                      setEditingReq(false);
                    }}
                    className={`px-3 py-1.5 text-xs rounded-lg border ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText}`}
                  >
                    {lang === 'zh' ? '取消' : 'Cancel'}
                  </button>
                  <button
                    onClick={() => {
                      const now = new Date().toISOString();
                      onUpdateIssue({
                        ...issue,
                        reqDoc: {
                          ...(issue.reqDoc || { rawMarkdown: '' }),
                          rawMarkdown: reqMarkdown,
                          updatedAt: now,
                          acceptedAt: undefined,
                        },
                        docPhase: 'requirement',
                        updatedAt: now,
                      });
                      setEditingReq(false);
                    }}
                    className="px-3 py-1.5 text-xs rounded-lg bg-cyan-600 text-white font-semibold"
                  >
                    {lang === 'zh' ? '保存 Markdown' : 'Save Markdown'}
                  </button>
                </div>
              </div>
            ) : (
              <div className={`rounded-xl border p-4 ${themeConfig.cardBg}`}>
                <p className={`text-[10px] uppercase tracking-wider mb-2 ${themeConfig.textMuted}`}>
                  Markdown
                </p>
                <MarkdownView text={coerceReqMarkdown(issue.reqDoc.rawMarkdown)} />
              </div>
            )}
          </div>
        )
      ) : !currentSpec?.rawMarkdown && !currentSpec?.summary ? (
        <div className={`p-12 text-center border-2 border-dashed rounded-2xl ${themeConfig.subtleBorder} ${themeConfig.cardBg}`}>
          <FileText className={`w-12 h-12 mx-auto mb-3 ${themeConfig.textMuted}`} />
          <h3 className={`text-base font-semibold ${themeConfig.textPrimary}`}>
            {lang === 'zh' ? '暂未生成开发设计 (Dev Spec)' : 'No Dev Spec yet'}
          </h3>
          <p className={`text-xs max-w-md mx-auto mt-1 mb-4 ${themeConfig.textMuted}`}>
            {!requirementAccepted(issue) && hasReqDoc(issue)
              ? lang === 'zh'
                ? '请先在上方点击「确认需求」，再基于源码生成开发设计。'
                : 'Accept the requirement above, then generate design from source excerpts.'
              : lang === 'zh'
                ? '确认需求后，点击「基于源码生成设计」。会读取关联仓库摘要发给模型。'
                : 'After accepting the requirement, generate design from local source excerpts.'}
          </p>
          {!requirementAccepted(issue) && hasReqDoc(issue) ? (
            <button
              onClick={async () => {
                try {
                  const saved = await api.acceptRequirement(issue.id);
                  onUpdateIssue(saved);
                } catch (e: any) {
                  window.alert(e?.message || (lang === 'zh' ? '确认需求失败' : 'Accept failed'));
                }
              }}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-xl shadow-lg flex items-center gap-2 mx-auto transition-all"
            >
              <CheckCircle2 className="w-4 h-4" />
              {t.acceptReqBtn}
            </button>
          ) : (
            <button
              type="button"
              disabled={!!isSending}
              onClick={() => {
                if (isSending) return;
                if (!requirementAccepted(issue) && !legacySpecOnly(issue)) {
                  window.alert(
                    lang === 'zh'
                      ? '请先确认需求文档，再生成开发设计。'
                      : 'Accept the requirement document before generating design.'
                  );
                  return;
                }
                if (splitIssue && selectedScope === 'all') {
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
                    ? '请基于关联仓库源码摘要，撰写完整开发设计。'
                    : 'Write a complete Dev Spec from local source excerpts.',
                  {
                    forceSpecSync: true,
                    scope: splitIssue && selectedScope !== 'all' ? selectedScope : undefined,
                  }
                );
              }}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl shadow-lg flex items-center gap-2 mx-auto transition-all disabled:opacity-50"
            >
              {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {isSending
                ? lang === 'zh'
                  ? '正在生成设计…'
                  : 'Generating…'
                : t.extractSpecBtn}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4 h-full flex flex-col min-h-0">
          <div className={`pb-3 border-b shrink-0 space-y-2 ${themeConfig.subtleBorder}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className={`text-base font-bold truncate ${themeConfig.textPrimary}`}>
                  {currentSpec?.title ||
                    activeSub?.title ||
                    (selectedScope === 'all' && splitIssue
                      ? lang === 'zh'
                        ? '总览文档'
                        : 'Overview'
                      : lang === 'zh'
                        ? '开发设计'
                        : 'Dev Spec')}
                </h3>
                <p className={`text-[11px] mt-0.5 ${themeConfig.textMuted}`}>
                  Markdown · {lang === 'zh' ? '更新' : 'Updated'}{' '}
                  {currentSpec?.updatedAt ? new Date(currentSpec.updatedAt).toLocaleString() : '—'}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                {canConfirmDesign && (
                  <button
                    type="button"
                    onClick={() => void acceptDesign()}
                    disabled={acceptingDesign}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    title={t.acceptDesignBtn}
                  >
                    {acceptingDesign ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                    {t.acceptDesignBtn}
                  </button>
                )}
                {issue.status === 'requirements' && designAccepted(issue) && handleScheduleToBacklog && (
                  <button
                    type="button"
                    onClick={() => void handleScheduleToBacklog()}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-colors"
                    title={
                      specReadyForDev(issue)
                        ? t.acceptSpecBacklog
                        : backlogBlockReason(issue, lang)
                    }
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {t.acceptSpecBacklog}
                  </button>
                )}
                {issue.status === 'requirements' && designAccepted(issue) && currentSpec?.acceptedAt && (
                  <span className={`text-[10px] font-semibold ${themeConfig.textMuted}`}>
                    {lang === 'zh' ? '设计已确认' : 'Design confirmed'}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleExportDevSpec}
                  disabled={exporting}
                  className={`px-3 py-1.5 border font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50 ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText}`}
                >
                  {exporting ? (
                    <Loader2 className="w-3.5 h-3.5 text-emerald-500 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5 text-emerald-500" />
                  )}
                  {exporting ? (lang === 'zh' ? '保存中…' : 'Saving…') : lang === 'zh' ? '导出下载' : 'Export'}
                </button>
                <button
                  onClick={() => {
                    if (!editingSpec) setSpecMarkdown(currentSpec?.rawMarkdown || '');
                    setEditingSpec(!editingSpec);
                  }}
                  className={`px-3 py-1.5 border font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-colors ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText}`}
                >
                  <Edit3 className="w-3.5 h-3.5 text-indigo-500" />
                  {editingSpec
                    ? lang === 'zh'
                      ? '退出编辑'
                      : 'Cancel'
                    : lang === 'zh'
                      ? '编辑 Markdown'
                      : 'Edit Markdown'}
                </button>
              </div>
            </div>
            {exportHint && (
              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 select-text break-all">
                {exportHint}
              </div>
            )}
          </div>

          {changes.length > 0 && (
            <div className={`rounded-xl border p-3 space-y-2 ${themeConfig.cardBg}`}>
              <div className={`text-xs font-bold ${themeConfig.textPrimary}`}>{t.changeMapTitle}</div>
              <ul className="space-y-1.5">
                {changes.map((ch, i) => (
                  <li
                    key={`${ch.repoName}-${ch.filePath}-${i}`}
                    className={`flex items-start gap-2 text-[11px] font-mono ${themeConfig.textSecondary}`}
                  >
                    {ch.verified || ch.action === 'create' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                    )}
                    <span>
                      <span className="font-semibold">[{ch.action}]</span> {ch.repoName}/{ch.filePath}
                      {ch.symbol ? ` · ${ch.symbol}` : ''}
                      <span className="ml-2 opacity-70">
                        {ch.action === 'create' || ch.verified ? t.verifiedBadge : t.unverifiedBadge}
                      </span>
                      {ch.summary ? (
                        <span className={`block font-sans opacity-80 ${themeConfig.textMuted}`}>{ch.summary}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {editingSpec ? (
            <div className="space-y-3 flex-1 flex flex-col min-h-0">
              <textarea
                value={specMarkdown}
                onChange={(e) => setSpecMarkdown(e.target.value)}
                spellCheck={false}
                className={`flex-1 min-h-[360px] w-full p-4 border rounded-xl font-mono text-xs focus:outline-none focus:border-indigo-500 leading-relaxed resize-y ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
              />
              <div className="flex justify-end gap-2 shrink-0">
                <button
                  onClick={() => {
                    setSpecMarkdown(currentSpec?.rawMarkdown || '');
                    setEditingSpec(false);
                  }}
                  className={`px-3 py-1.5 text-xs rounded-lg border ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText}`}
                >
                  {lang === 'zh' ? '取消' : 'Cancel'}
                </button>
                <button
                  onClick={() => {
                    const md = specMarkdown;
                    const titleMatch = md.match(/^#\s+(.+)$/m);
                    const nextSpec = {
                      title: titleMatch?.[1]?.trim() || currentSpec?.title || activeSub?.title || issue.title,
                      summary: currentSpec?.summary || '',
                      architectureDesign: currentSpec?.architectureDesign || '',
                      fileChanges: currentSpec?.fileChanges || [],
                      implementationSteps: currentSpec?.implementationSteps || [],
                      testCases: currentSpec?.testCases || [],
                      rawMarkdown: md,
                      updatedAt: new Date().toISOString(),
                      acceptedAt: undefined,
                    };
                    if (activeSub) {
                      onUpdateIssue({
                        ...issue,
                        subRequirements: (issue.subRequirements || []).map((s) =>
                          s.id === activeSub.id ? { ...s, title: nextSpec.title, devSpec: nextSpec } : s
                        ),
                        updatedAt: new Date().toISOString(),
                      });
                    } else {
                      onUpdateIssue({
                        ...issue,
                        devSpec: nextSpec,
                        updatedAt: new Date().toISOString(),
                      });
                    }
                    setEditingSpec(false);
                  }}
                  className="px-3 py-1.5 text-xs rounded-lg bg-indigo-600 text-white font-semibold"
                >
                  {lang === 'zh' ? '保存' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <MarkdownView text={coerceDocMarkdown(currentSpec?.rawMarkdown || '')} />
          )}
        </div>
      )}
    </div>
  );
};
