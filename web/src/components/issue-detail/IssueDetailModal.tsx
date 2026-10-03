import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Issue, GitRepo, ModelConfig, BranchPrefixConfig, SubRequirement, DiffComment } from '../../types';
import { Language, getTranslation, ThemeStyle } from '../../lib/i18n';
import { THEME_CONFIGS } from '../../lib/theme';
import { api } from '../../lib/api';
import { hasSubRequirements, specMarkdownForExport, reqMarkdownForExport, visibleSpec, coerceReqMarkdown, coerceDocMarkdown, coerceDevSpec, backlogBlockReason, hasUnverifiedModifies } from '../../lib/subreq';
import { formatReviewComments } from '../../lib/reviewComments';
import { saveTextFile } from '../../lib/savefile';
import { useIssueChat } from './useIssueChat';
import { IssueDetailHeader } from './IssueDetailHeader';
import { AssociatedReposBar } from './AssociatedReposBar';
import { IssueBriefBar } from './IssueBriefBar';
import { StatusFocusBanner } from './StatusFocusBanner';
import { IssueDetailTabs } from './IssueDetailTabs';
import { IssueChatTab } from './IssueChatTab';
import { IssueSpecTab } from './IssueSpecTab';
import { IssueConsoleTab } from './IssueConsoleTab';
import { IssueReviewTab } from './IssueReviewTab';
import { IssueSessionChip } from './IssueSessionChip';

export const ISSUE_SESSION_DOCK_ID = 'vc-issue-session-dock';

interface IssueDetailModalProps {
  isOpen: boolean;
  minimized?: boolean;
  onMinimize: () => void;
  onRestore: () => void;
  onDismiss: () => void;
  onBusyChange?: (busy: boolean) => void;
  onBackgroundSettled?: (result: 'success' | 'error' | 'cancelled') => void;
  issue: Issue;
  gitRepos: GitRepo[];
  modelConfig: ModelConfig;
  branchPrefixConfig?: BranchPrefixConfig;
  onUpdateIssue: (updatedIssue: Issue) => void;
  onStartAutoDev: (issueId: string, subRequirementId?: string) => void;
  onCancelAutoDev?: (issueId: string) => void;
  onDeleteIssue?: (issueId: string) => void;
  projectId?: string;
  lang?: Language;
  themeStyle?: ThemeStyle;
}

export const IssueDetailModal: React.FC<IssueDetailModalProps> = ({
  isOpen,
  minimized = false,
  onMinimize,
  onRestore,
  onDismiss,
  onBusyChange,
  onBackgroundSettled,
  issue,
  gitRepos,
  modelConfig,
  branchPrefixConfig,
  onUpdateIssue,
  onStartAutoDev,
  onCancelAutoDev,
  onDeleteIssue,
  projectId,
  lang = 'en' as Language,
  themeStyle = 'light',
}) => {
  const themeConfig = THEME_CONFIGS[themeStyle] || THEME_CONFIGS.light;
  const t = getTranslation(lang);

  const [activeTab, setActiveTab] = useState<'chat' | 'spec' | 'console' | 'review'>('chat');
  const [editingSpec, setEditingSpec] = useState(false);

  const [specMarkdown, setSpecMarkdown] = useState(issue.devSpec?.rawMarkdown || '');
  const [reqMarkdown, setReqMarkdown] = useState(issue.reqDoc?.rawMarkdown || '');
  const [reworkFeedback, setReworkFeedback] = useState('');
  const [showReworkBox, setShowReworkBox] = useState(false);
  const [editingRepos, setEditingRepos] = useState(false);
  const [selectedScope, setSelectedScope] = useState<string>('all');
  const [reworkScope, setReworkScope] = useState<string>('all');
  const [exporting, setExporting] = useState(false);
  const [exportHint, setExportHint] = useState('');
  const [publishingRemote, setPublishingRemote] = useState(false);
  const [dockEl, setDockEl] = useState<HTMLElement | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const splitIssue = hasSubRequirements(issue);
  const activeSub: SubRequirement | undefined =
    splitIssue && selectedScope !== 'all'
      ? (issue.subRequirements || []).find((s) => s.id === selectedScope)
      : undefined;
  const visibleMessages = activeSub ? activeSub.chatMessages || [] : issue.chatMessages;
  const currentSpec = visibleSpec(issue, selectedScope);

  const associatedRepos = gitRepos.filter((r) => issue.associatedRepoIds.includes(r.id));
  const canEditRepos = issue.status === 'requirements' || issue.status === 'backlog';

  const {
    inputPrompt,
    setInputPrompt,
    isSending,
    chatError,
    setChatError,
    modelProcess,
    setModelProcess,
    abortRef,
    handleSendMessage,
    pendingLlm,
    handleRetrySession,
    handleRegenerate,
  } = useIssueChat({
    issue,
    splitIssue,
    selectedScope,
    setSelectedScope,
    setSpecMarkdown,
    setReqMarkdown,
    onUpdateIssue,
    modelConfig,
    projectId,
    lang,
    associatedRepos,
  });

  // Reset per-issue UI when this session first mounts / switches issue, not when hiding.
  useEffect(() => {
    setEditingRepos(false);
    setSelectedScope('all');
    setReworkScope('all');
    setExportHint('');
    if (issue.status === 'requirements') {
      setActiveTab('chat');
    } else if (issue.status === 'backlog') {
      setActiveTab('spec');
    } else if (issue.status === 'in_progress') {
      setActiveTab('console');
    } else if (issue.status === 'in_review' || issue.status === 'completed') {
      setActiveTab('review');
    }
  }, [issue.id]);

  useEffect(() => {
    const spec = visibleSpec(issue, selectedScope);
    if (spec?.rawMarkdown) {
      setSpecMarkdown(coerceDocMarkdown(spec.rawMarkdown));
    }
  }, [issue.devSpec, issue.subRequirements, selectedScope]);

  useEffect(() => {
    if (issue.reqDoc?.rawMarkdown) {
      setReqMarkdown(coerceReqMarkdown(issue.reqDoc.rawMarkdown));
    }
  }, [issue.reqDoc?.rawMarkdown]);

  // Heal ReqDocs / DevSpecs that accidentally stored the model JSON envelope as markdown.
  useEffect(() => {
    const rawReq = issue.reqDoc?.rawMarkdown || '';
    const fixedReq = coerceReqMarkdown(rawReq);
    const healReq = !!fixedReq && fixedReq !== rawReq.trim();

    let next = issue;
    let changed = false;
    if (healReq && issue.reqDoc) {
      next = {
        ...next,
        reqDoc: { ...issue.reqDoc, rawMarkdown: fixedReq },
      };
      changed = true;
    }

    if (hasSubRequirements(issue)) {
      let subsChanged = false;
      const subs = (issue.subRequirements || []).map((sub) => {
        const healed = coerceDevSpec(sub.devSpec);
        if (!healed || !sub.devSpec) return sub;
        if (
          healed.rawMarkdown === sub.devSpec.rawMarkdown &&
          (healed.fileChanges?.length || 0) === (sub.devSpec.fileChanges?.length || 0) &&
          healed.title === sub.devSpec.title
        ) {
          return sub;
        }
        subsChanged = true;
        return { ...sub, devSpec: healed };
      });
      if (subsChanged) {
        next = { ...next, subRequirements: subs };
        changed = true;
      }
    } else {
      const healed = coerceDevSpec(issue.devSpec);
      if (
        healed &&
        issue.devSpec &&
        (healed.rawMarkdown !== issue.devSpec.rawMarkdown ||
          (healed.fileChanges?.length || 0) !== (issue.devSpec.fileChanges?.length || 0) ||
          healed.title !== issue.devSpec.title)
      ) {
        next = { ...next, devSpec: healed };
        changed = true;
      }
    }

    if (changed) {
      onUpdateIssue({ ...next, updatedAt: new Date().toISOString() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- heal once per bad payload
  }, [issue.id, issue.reqDoc?.rawMarkdown, issue.devSpec?.rawMarkdown, issue.subRequirements]);

  const handleScheduleToBacklog = async () => {
    const reason = backlogBlockReason(issue, lang);
    if (reason) {
      setChatError(reason);
      window.alert(reason);
      return;
    }
    if (!(issue.associatedRepoIds || []).length) {
      const msg = t.backlogNeedsRepo;
      setChatError(msg);
      window.alert(msg);
      return;
    }
    if (hasUnverifiedModifies(issue)) {
      const ok = window.confirm(
        lang === 'zh'
          ? '开发设计中仍有未核实的修改点。确认仍要进入待执行吗？'
          : 'Some modify/delete file changes are unverified. Move to backlog anyway?'
      );
      if (!ok) return;
    }
    setChatError('');
    onUpdateIssue({
      ...issue,
      status: 'backlog',
      docPhase: 'design',
      updatedAt: new Date().toISOString(),
    });
    setActiveTab('console');
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleMessages, activeTab]);

  useEffect(() => {
    onBusyChange?.(isSending);
  }, [isSending, onBusyChange]);

  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const sendingRef = useRef(isSending);
  useEffect(() => {
    const wasSending = sendingRef.current;
    sendingRef.current = isSending;
    if (!wasSending || isSending || isOpenRef.current) return;
    const cancelled = chatError === t.requestCancelled;
    onBackgroundSettled?.(cancelled ? 'cancelled' : chatError ? 'error' : 'success');
  }, [isSending, chatError, onBackgroundSettled, t.requestCancelled]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isSending) onMinimize();
      else onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isSending, onMinimize, onDismiss]);

  const handleHeaderClose = () => {
    if (isSending) onMinimize();
    else onDismiss();
  };

  const handleChipDismiss = () => {
    abortRef.current?.abort();
    onDismiss();
  };

  useEffect(() => {
    setDockEl(document.getElementById(ISSUE_SESSION_DOCK_ID));
  }, [isOpen, minimized, isSending]);
  const showChip = !isOpen && (minimized || isSending);
  const chip =
    showChip && dockEl
      ? createPortal(
          <IssueSessionChip
            title={issue.title}
            busy={isSending}
            error={chatError || undefined}
            lang={lang}
            themeStyle={themeStyle}
            onRestore={onRestore}
            onDismiss={handleChipDismiss}
          />,
          dockEl
        )
      : null;

  if (!isOpen) return chip;

  const toggleAssociatedRepo = (repoId: string) => {
    if (!canEditRepos) return;
    const current = issue.associatedRepoIds || [];
    const next = current.includes(repoId)
      ? current.filter((id) => id !== repoId)
      : [...current, repoId];
    if (next.length === 0) {
      setChatError(lang === 'zh' ? '请至少保留一个关联仓库' : 'Keep at least one associated repository');
      return;
    }
    setChatError('');
    onUpdateIssue({
      ...issue,
      associatedRepoIds: next,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleReworkSubmit = async () => {
    if (!reworkFeedback.trim()) {
      setChatError(lang === 'zh' ? '请输入评审修改意见' : 'Enter review feedback');
      return;
    }
    await submitRework(reworkFeedback, false);
  };

  const handleReworkByComments = async () => {
    const comments = issue.reviewComments || [];
    if (!comments.length) {
      setChatError(t.reworkByCommentsNeed);
      return;
    }
    const repoName = (id: string) => gitRepos.find((r) => r.id === id)?.name || id;
    const formatted = formatReviewComments(comments, repoName);
    const extra = reworkFeedback.trim();
    const combined = extra ? `${extra}\n\n${formatted}` : formatted;
    await submitRework(combined, true);
  };

  const handleCommentsChange = (next: DiffComment[] | undefined) => {
    onUpdateIssue({
      ...issue,
      reviewComments: next || [],
      updatedAt: new Date().toISOString(),
    });
  };

  const submitRework = async (feedback: string, fromComments: boolean) => {
    setShowReworkBox(false);
    setActiveTab('chat');
    const scope = reworkScope;
    setSelectedScope(scope);

    const targetLabel =
      scope === 'all'
        ? lang === 'zh'
          ? '整单需求'
          : 'whole requirement'
        : (issue.subRequirements || []).find((s) => s.id === scope)?.title || scope;

    const prompt =
      lang === 'zh'
        ? `开发者在评审中指出了以下问题，需要二次修改代码与开发文档（范围: ${targetLabel}）:\n"${feedback}"\n请重新分析并更新对应待开发文档。`
        : `Reviewer requested rework for ${targetLabel}:\n"${feedback}"\nPlease revise the Dev Spec(s) accordingly.`;

    const updatedIssue: Issue = {
      ...issue,
      reviewFeedback: feedback,
      reworkSubId: scope === 'all' ? '' : scope,
      reviewComments: fromComments ? [] : issue.reviewComments,
      autoDevLogs: [
        ...issue.autoDevLogs,
        {
          id: `rework-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          phase: 'analyzing',
          message:
            lang === 'zh'
              ? `收到二次评审意见（${targetLabel}）: "${feedback}". 正在更新 Dev Spec...`
              : `Rework feedback (${targetLabel}): "${feedback}". Updating Dev Spec...`,
        },
      ],
    };

    onUpdateIssue(updatedIssue);
    setReworkFeedback('');

    await handleSendMessage(prompt, { forceSpecSync: true, scope });
    onStartAutoDev(issue.id, scope === 'all' ? undefined : scope);
  };

  const handleApproveMerge = async (targets: { repoId: string; branch: string }[]) => {
    try {
      const saved = await api.approveMerge(issue.id, {
        targets,
        targetBranch: targets.length === 1 ? targets[0].branch : undefined,
      });
      onUpdateIssue(saved);
    } catch (err: any) {
      setChatError(err.message || t.mergeFailed);
    }
  };

  const handlePublishRemote = async () => {
    setPublishingRemote(true);
    setChatError('');
    try {
      const res = await api.publishRemote(issue.id);
      if (res.issue) onUpdateIssue(res.issue);
      const warns = res.warnings?.filter(Boolean) || [];
      if (!res.ok) {
        setChatError(res.error || warns.join('\n') || t.publishRemoteWarn);
        return;
      }
      if (res.prUrl) {
        setExportHint(t.publishRemotePR.replace('{url}', res.prUrl));
      } else {
        setExportHint(t.publishRemoteOk);
      }
      if (warns.length) {
        setChatError(warns.join('\n'));
      }
    } catch (err: any) {
      setChatError(err.message || t.publishRemoteWarn);
    } finally {
      setPublishingRemote(false);
    }
  };

  const handleExportDevSpec = async () => {
    const { filename, markdown } = specMarkdownForExport(
      issue,
      selectedScope,
      editingSpec ? specMarkdown : undefined
    );
    if (!markdown.trim()) {
      setChatError(t.noSpecToExport);
      setExportHint('');
      return;
    }
    setChatError('');
    setExportHint('');
    setExporting(true);
    try {
      const result = await saveTextFile(filename, markdown);
      if (result.status === 'cancelled') {
        setExportHint(lang === 'zh' ? '已取消导出' : 'Export cancelled');
        return;
      }
      if (result.status === 'copied') {
        setExportHint(t.exportCopied);
        return;
      }
      setExportHint(
        result.path ? t.exportSavedTo.replace('{path}', result.path) : t.exportSaved
      );
    } catch (err: any) {
      setChatError(err?.message || t.exportFailed);
    } finally {
      setExporting(false);
    }
  };

  const handleExportReqDoc = async () => {
    const { filename, markdown } = reqMarkdownForExport(issue, reqMarkdown);
    if (!markdown.trim()) {
      setChatError(t.noReqToExport);
      setExportHint('');
      return;
    }
    setChatError('');
    setExportHint('');
    setExporting(true);
    try {
      const result = await saveTextFile(filename, markdown);
      if (result.status === 'cancelled') {
        setExportHint(lang === 'zh' ? '已取消导出' : 'Export cancelled');
        return;
      }
      if (result.status === 'copied') {
        setExportHint(t.exportCopied);
        return;
      }
      setExportHint(
        result.path ? t.exportSavedTo.replace('{path}', result.path) : t.exportSaved
      );
    } catch (err: any) {
      setChatError(err?.message || t.exportFailed);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onMinimize();
      }}
    >
      <div
        className={`w-full max-w-5xl border rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[90vh] ${themeConfig.modalBg}`}
        onClick={(e) => e.stopPropagation()}
      >
        <IssueDetailHeader
          issue={issue}
          lang={lang}
          themeStyle={themeStyle}
          branchPrefixConfig={branchPrefixConfig}
          onClose={handleHeaderClose}
          onMinimize={onMinimize}
          analyzing={isSending}
          onStartAutoDev={onStartAutoDev}
          onDeleteIssue={onDeleteIssue}
          onUpdateIssue={onUpdateIssue}
          setActiveTab={setActiveTab}
        />

        <AssociatedReposBar
          issue={issue}
          gitRepos={gitRepos}
          associatedRepos={associatedRepos}
          canEditRepos={canEditRepos}
          editingRepos={editingRepos}
          setEditingRepos={setEditingRepos}
          toggleAssociatedRepo={toggleAssociatedRepo}
          lang={lang}
          themeStyle={themeStyle}
        />

        <IssueBriefBar
          issue={issue}
          canEdit={canEditRepos}
          onUpdateIssue={onUpdateIssue}
          lang={lang}
          themeStyle={themeStyle}
        />

        <StatusFocusBanner
          issue={issue}
          splitIssue={splitIssue}
          selectedScope={selectedScope}
          associatedRepos={associatedRepos}
          lang={lang}
          isSending={isSending}
          setActiveTab={setActiveTab}
          handleSendMessage={handleSendMessage}
          onUpdateIssue={onUpdateIssue}
          onStartAutoDev={onStartAutoDev}
          onCancelAutoDev={onCancelAutoDev}
          handleApproveMerge={handleApproveMerge}
        />

        <IssueDetailTabs
          issue={issue}
          splitIssue={splitIssue}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          lang={lang}
          themeStyle={themeStyle}
        />

        {/* Tab Content Body */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {activeTab === 'chat' && (
            <IssueChatTab
              issue={issue}
              splitIssue={splitIssue}
              visibleMessages={visibleMessages}
              selectedScope={selectedScope}
              setSelectedScope={setSelectedScope}
              lang={lang}
              themeStyle={themeStyle}
              isSending={isSending}
              chatError={chatError}
              inputPrompt={inputPrompt}
              setInputPrompt={setInputPrompt}
              modelProcess={modelProcess}
              setModelProcess={setModelProcess}
              abortRef={abortRef}
              messagesEndRef={messagesEndRef}
              handleSendMessage={handleSendMessage}
              pendingLlm={pendingLlm}
              onRetrySession={handleRetrySession}
              onRegenerate={handleRegenerate}
            />
          )}

          {activeTab === 'spec' && (
            <IssueSpecTab
              issue={issue}
              splitIssue={splitIssue}
              activeSub={activeSub}
              currentSpec={currentSpec}
              selectedScope={selectedScope}
              setSelectedScope={setSelectedScope}
              lang={lang}
              themeStyle={themeStyle}
              editingSpec={editingSpec}
              setEditingSpec={setEditingSpec}
              specMarkdown={specMarkdown}
              setSpecMarkdown={setSpecMarkdown}
              reqMarkdown={reqMarkdown}
              setReqMarkdown={setReqMarkdown}
              exporting={exporting}
              exportHint={exportHint}
              chatError={chatError}
              isSending={isSending}
              setActiveTab={setActiveTab}
              handleSendMessage={handleSendMessage}
              handleExportDevSpec={handleExportDevSpec}
              handleExportReqDoc={handleExportReqDoc}
              handleScheduleToBacklog={handleScheduleToBacklog}
              onUpdateIssue={onUpdateIssue}
              pendingLlm={pendingLlm}
              onRetrySession={handleRetrySession}
              onRegenerate={handleRegenerate}
            />
          )}

          {activeTab === 'console' && (
            <IssueConsoleTab
              issue={issue}
              splitIssue={splitIssue}
              selectedScope={selectedScope}
              setSelectedScope={setSelectedScope}
              lang={lang}
              themeStyle={themeStyle}
              onStartAutoDev={onStartAutoDev}
            />
          )}

          {activeTab === 'review' && (
            <IssueReviewTab
              issue={issue}
              splitIssue={splitIssue}
              lang={lang}
              themeStyle={themeStyle}
              showReworkBox={showReworkBox}
              setShowReworkBox={setShowReworkBox}
              reworkFeedback={reworkFeedback}
              setReworkFeedback={setReworkFeedback}
              reworkScope={reworkScope}
              setReworkScope={setReworkScope}
              handleReworkSubmit={handleReworkSubmit}
              handleReworkByComments={handleReworkByComments}
              handleApproveMerge={handleApproveMerge}
              handlePublishRemote={handlePublishRemote}
              publishingRemote={publishingRemote}
              onCommentsChange={handleCommentsChange}
            />
          )}
        </div>
      </div>
    </div>
  );
};
