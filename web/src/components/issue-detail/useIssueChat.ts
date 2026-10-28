import { useState, useRef, useEffect } from 'react';
import { Issue, GitRepo, ModelConfig, ChatMessage, PendingLLMSession } from '../../types';
import { Language, getTranslation } from '../../lib/i18n';
import { sendLLMChat, isRetryableLLMError, LLM_AUTO_ATTEMPTS } from '../../lib/llm';
import { api } from '../../lib/api';
import { promptDescription } from '../../lib/attachments';
import { coerceReqMarkdown, coerceDocMarkdown } from '../../lib/subreq';

export type ModelProcessState = {
  entries: { id: string; at: string; prompt: string; body: string; status: 'running' | 'done' | 'error' }[];
  expanded: boolean;
  /** Which process entry is open in the side rail (one at a time). */
  activeId?: string;
};

export type SendMessageOpts = {
  /** Explicitly generate / update Dev Spec (design) from source. */
  forceSpecSync?: boolean;
  /** Explicitly extract / update requirement document. */
  forceReqDoc?: boolean;
  split?: boolean;
  scope?: string;
  resume?: 'session' | 'fresh';
};

/** User phrasing that should rewrite the Dev Spec (not idle analysis chat). */
export function wantsDesignDocUpdate(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (
    /(开发设计|设计文档|dev\s*spec|design\s*doc)/i.test(t) &&
    /(改|更新|修订|改进|完善|补充|重写|重新生成|结合|基于|根据|同步|写入|落到)/i.test(t)
  ) {
    return true;
  }
  if (
    /(update|revise|improve|rewrite|regenerate|amend).{0,40}(dev\s*spec|design(\s*doc)?)/i.test(t) ||
    /(dev\s*spec|design(\s*doc)?).{0,40}(update|revise|improve|rewrite|regenerate|amend)/i.test(t)
  ) {
    return true;
  }
  if (/结合.{0,40}(源码|仓库|代码).{0,40}(改进|完善|更新|修订).{0,20}(设计|spec)/i.test(t)) {
    return true;
  }
  return false;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function useIssueChat(params: {
  issue: Issue;
  splitIssue: boolean;
  selectedScope: string;
  setSelectedScope: (scope: string) => void;
  setSpecMarkdown: (md: string) => void;
  setReqMarkdown?: (md: string) => void;
  onUpdateIssue: (updatedIssue: Issue) => void;
  modelConfig: ModelConfig;
  projectId?: string;
  lang: Language;
  associatedRepos: GitRepo[];
}) {
  const {
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
  } = params;

  const t = getTranslation(lang);

  const [inputPrompt, setInputPrompt] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState('');
  const [pendingLlm, setPendingLlm] = useState<PendingLLMSession | null>(issue.pendingLlm || null);
  /** Ephemeral model process traces — session only, never persisted. */
  const [modelProcess, setModelProcess] = useState<ModelProcessState>({
    entries: [],
    expanded: false,
    activeId: undefined,
  });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setPendingLlm(issue.pendingLlm || null);
    if (issue.pendingLlm?.error) setChatError(issue.pendingLlm.error);
  }, [issue.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const persistPending = (next: PendingLLMSession | null, base: Issue) => {
    setPendingLlm(next);
    onUpdateIssue({ ...base, pendingLlm: next || undefined, updatedAt: new Date().toISOString() });
  };

  const handleSendMessage = async (customPrompt?: string, opts?: SendMessageOpts) => {
    const resume = opts?.resume;
    const session = resume ? pendingLlm : null;
    const promptToUse = (resume ? session?.prompt : customPrompt) || customPrompt || inputPrompt;
    if (!promptToUse.trim()) return;

    const scope = opts?.scope || session?.scope || selectedScope;
    const split = opts?.split ?? session?.split ?? false;
    const targetingSub = splitIssue && scope !== 'all';
    const targetSub = targetingSub
      ? (issue.subRequirements || []).find((s) => s.id === scope)
      : undefined;
    const priorMessages = targetSub ? targetSub.chatMessages || [] : issue.chatMessages;

    const last = priorMessages[priorMessages.length - 1];
    const alreadyHaveUser =
      !!resume || (last?.sender === 'user' && last.text === promptToUse);

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      text: promptToUse,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    const updatedMessages = alreadyHaveUser ? priorMessages : [...priorMessages, userMsg];
    const tempIssue = targetSub
      ? {
          ...issue,
          subRequirements: (issue.subRequirements || []).map((s) =>
            s.id === targetSub.id ? { ...s, chatMessages: updatedMessages } : s
          ),
        }
      : { ...issue, chatMessages: updatedMessages };

    if (!alreadyHaveUser) {
      onUpdateIssue({ ...tempIssue, pendingLlm: undefined });
    } else if (!resume && issue.pendingLlm) {
      onUpdateIssue({ ...issue, pendingLlm: undefined, updatedAt: new Date().toISOString() });
    }
    if (!resume) {
      setInputPrompt('');
      setPendingLlm(null);
    }
    setIsSending(true);
    setChatError('');
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const syncReqDoc = !!(opts?.forceReqDoc || session?.syncReqDoc);
    const explicitSpec = !!(opts?.forceSpecSync || session?.syncSpec);
    // Idle chat stays analysis-only; design-revision phrasing (or explicit buttons) syncs Dev Spec.
    const syncSpec =
      explicitSpec ||
      (!syncReqDoc && !split && !(session?.split) && wantsDesignDocUpdate(promptToUse));
    const syncDocs = split || syncReqDoc || syncSpec;

    const processId = `proc-${Date.now()}`;
    const processAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setModelProcess((prev) => ({
      expanded: true,
      activeId: processId,
      entries: [
        ...prev.entries.slice(-7),
        {
          id: processId,
          at: processAt,
          prompt: promptToUse.length > 120 ? `${promptToUse.slice(0, 120)}…` : promptToUse,
          body: lang === 'zh' ? '正在请求模型…' : 'Calling model…',
          status: 'running',
        },
      ],
    }));

    const patchProcess = (body: string, status?: 'running' | 'done' | 'error') => {
      setModelProcess((prev) => ({
        // Keep the side rail open while streaming; collapse when finished.
        expanded: status === 'running' ? true : status ? false : prev.expanded,
        activeId: processId,
        entries: prev.entries.map((e) =>
          e.id === processId ? { ...e, body, ...(status ? { status } : {}) } : e
        ),
      }));
    };

    const mergeChat = (base: Issue, messages: ChatMessage[]): Issue => {
      if (targetSub) {
        return {
          ...base,
          subRequirements: (base.subRequirements || []).map((s) =>
            s.id === targetSub.id ? { ...s, chatMessages: messages } : s
          ),
        };
      }
      return { ...base, chatMessages: messages };
    };

    let lastPartial = resume === 'fresh' ? '' : session?.partial || '';

    try {
      for (let attempt = 1; attempt <= LLM_AUTO_ATTEMPTS; attempt++) {
        let streamed = '';
        const appendDelta = (chunk: string) => {
          streamed += chunk;
          patchProcess(streamed, 'running');
        };
        const resumePartial = resume === 'fresh' && attempt === 1 ? '' : lastPartial;
        const freshStart = resume === 'fresh' && attempt === 1;
        const resumeSession = !!resume || attempt > 1;
        if (attempt > 1) {
          patchProcess(
            t.llmRetrying.replace('{n}', String(attempt)).replace('{max}', String(LLM_AUTO_ATTEMPTS)),
            'running'
          );
          await sleep(1500 * (attempt - 1), ac.signal);
        }

        try {
          if (syncDocs) {
            const streamOpts = {
              signal: ac.signal,
              onDelta: appendDelta,
              onStatus: (msg: string) => {
                const label =
                  msg === 'indexing'
                    ? lang === 'zh'
                      ? '正在索引关联仓库…'
                      : 'Indexing associated repos…'
                    : msg.startsWith('reading')
                      ? lang === 'zh'
                        ? `正在读取源码摘要（${msg}）…`
                        : `Reading source excerpts (${msg})…`
                      : msg === 'writing_spec'
                        ? lang === 'zh'
                          ? '正在撰写开发设计…'
                          : 'Writing Dev Spec…'
                        : lang === 'zh'
                          ? '正在请求模型…'
                          : 'Calling model…';
                if (!streamed) patchProcess(label, 'running');
              },
            };
            const body = {
              prompt: promptToUse,
              messages: updatedMessages,
              scope: targetingSub ? ('sub' as const) : splitIssue ? ('all' as const) : undefined,
              subRequirementId: targetingSub ? scope : undefined,
              resumePartial: resumePartial || undefined,
              freshStart: freshStart || undefined,
              resume: resumeSession || undefined,
            };
            let result;
            if (split) {
              result = await api.splitIssueStream(issue.id, body, streamOpts);
            } else if (syncReqDoc) {
              result = await api.generateReqDocStream(issue.id, body, streamOpts);
            } else {
              // Design: must target a sub when split
              if (splitIssue && !targetingSub) {
                throw new Error(
                  lang === 'zh'
                    ? '请先选择一个子需求再生成开发设计'
                    : 'Pick a sub-requirement before generating design'
                );
              }
              result = await api.generateSpecStream(issue.id, body, streamOpts);
            }
            const { spec, reqDoc, text, chatReply, process, subRequirements, docPhase } = result;
            const rawReply =
              chatReply ||
              text ||
              (syncReqDoc
                ? lang === 'zh'
                  ? '已更新需求文档。'
                  : 'Requirement document updated.'
                : lang === 'zh'
                  ? '已更新开发设计文档。'
                  : 'Dev Spec updated.');
            // Never persist the full JSON envelope into the chat transcript.
            let reply = rawReply;
            const trimmed = (rawReply || '').trim();
            if (trimmed.startsWith('{') && (trimmed.includes('"chatReply"') || trimmed.includes('"rawMarkdown"'))) {
              try {
                const parsed = JSON.parse(trimmed) as { chatReply?: string };
                if (parsed.chatReply?.trim()) reply = parsed.chatReply.trim();
                else {
                  reply = syncReqDoc
                    ? lang === 'zh'
                      ? '已更新需求文档。'
                      : 'Requirement document updated.'
                    : lang === 'zh'
                      ? '已更新开发设计文档。'
                      : 'Dev Spec updated.';
                }
              } catch {
                reply = syncReqDoc
                  ? lang === 'zh'
                    ? '已更新需求文档。'
                    : 'Requirement document updated.'
                  : lang === 'zh'
                    ? '已更新开发设计文档。'
                    : 'Dev Spec updated.';
              }
            }
            patchProcess(process || streamed || text || reply, 'done');
            const aiMsg: ChatMessage = {
              id: `msg-${Date.now() + 1}`,
              sender: 'ai',
              text: reply,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              model: modelConfig?.openAIModel || undefined,
            };
            const nextSubs = subRequirements || tempIssue.subRequirements;
            const saved: Issue = {
              ...mergeChat(tempIssue, [...updatedMessages, aiMsg]),
              reqDoc: reqDoc || tempIssue.reqDoc,
              docPhase: docPhase || tempIssue.docPhase,
              // Parent design updates issue.devSpec; sub design lives in subRequirements.
              devSpec:
                !targetingSub && spec && !syncReqDoc && !split
                  ? spec
                  : tempIssue.devSpec,
              subRequirements: nextSubs,
              pendingLlm: undefined,
              updatedAt: new Date().toISOString(),
            };
            setPendingLlm(null);
            onUpdateIssue(saved);
            if (reqDoc?.rawMarkdown) setReqMarkdown?.(coerceReqMarkdown(reqDoc.rawMarkdown));
            if (spec?.rawMarkdown && !syncReqDoc && !split) setSpecMarkdown(coerceDocMarkdown(spec.rawMarkdown));
            if (split) setSelectedScope('all');
            return;
          }

          const chatRes = await sendLLMChat({
            prompt: promptToUse,
            messages: updatedMessages,
            modelConfig,
            issueTitle: issue.title,
            issueDescription: promptDescription(issue),
            associatedRepos: associatedRepos.map((r) => ({
              name: r.name,
              path: r.path,
              defaultBranch: r.defaultBranch,
            })),
            generateSpec: false,
            projectId,
            issueId: issue.id,
            resumePartial: resumePartial || undefined,
            freshStart: freshStart || undefined,
            resume: resumeSession || undefined,
            signal: ac.signal,
            onDelta: appendDelta,
            onStatus: (msg: string) => {
              const label =
                msg === 'indexing'
                  ? lang === 'zh'
                    ? '正在索引关联仓库…'
                    : 'Indexing associated repos…'
                  : msg.startsWith('reading')
                    ? lang === 'zh'
                      ? `正在读取源码摘要（${msg}）…`
                      : `Reading source excerpts (${msg})…`
                    : lang === 'zh'
                      ? '正在请求模型…'
                      : 'Calling model…';
              if (!streamed) patchProcess(label, 'running');
            },
          });
          const responseText = chatRes.text;

          patchProcess(streamed || responseText, 'done');
          const aiMsg: ChatMessage = {
            id: `msg-${Date.now() + 1}`,
            sender: 'ai',
            text: responseText,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            model: chatRes.model || modelConfig?.openAIModel || undefined,
          };
          setPendingLlm(null);
          onUpdateIssue({
            ...mergeChat(tempIssue, [...updatedMessages, aiMsg]),
            pendingLlm: undefined,
            updatedAt: new Date().toISOString(),
          });
          return;
        } catch (err: unknown) {
          lastPartial = streamed || lastPartial;
          const name = (err as { name?: string })?.name;
          if (name === 'AbortError') throw err;
          if (attempt < LLM_AUTO_ATTEMPTS && isRetryableLLMError(err)) {
            continue;
          }
          throw err;
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setChatError(t.requestCancelled);
        patchProcess(t.requestCancelled, 'error');
      } else {
        let message = err?.message || t.llmError;
        if (/accept the requirement/i.test(message)) {
          message =
            lang === 'zh'
              ? '请先点击「确认需求」，再生成开发设计。'
              : 'Accept the requirement document before generating design.';
        } else if (/associate at least one repository/i.test(message)) {
          message =
            lang === 'zh'
              ? '请先关联至少一个代码仓库，再生成开发设计。'
              : 'Associate at least one repository before generating design.';
        }
        setChatError(message);
        patchProcess(`${t.llmRetryGiveUp}\n${message}`, 'error');
        const pending: PendingLLMSession = {
          prompt: promptToUse,
          scope,
          split,
          syncSpec,
          syncReqDoc,
          partial: lastPartial.slice(0, 12000),
          error: message,
          attempts: LLM_AUTO_ATTEMPTS,
          updatedAt: new Date().toISOString(),
        };
        // Gate errors are not worth auto-retry / resume as LLM failures.
        if (!/确认需求|Accept the requirement|关联至少一个|Associate at least one/i.test(message)) {
          persistPending(pending, mergeChat(tempIssue, updatedMessages));
        }
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleRetrySession = () => handleSendMessage(undefined, { resume: 'session' });
  const handleRegenerate = () => handleSendMessage(undefined, { resume: 'fresh' });

  return {
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
  };
}
