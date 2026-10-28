import React, { RefObject, useMemo } from 'react';
import { Issue, ChatMessage, PendingLLMSession } from '../../types';
import { Language, getTranslation, ThemeStyle } from '../../lib/i18n';
import { THEME_CONFIGS } from '../../lib/theme';
import { MarkdownView } from '../../lib/markdown';
import { SubRequirementBar } from '../SubRequirementBar';
import { ModelProcessState, SendMessageOpts } from './useIssueChat';
import { LLMRecoveryBar } from './LLMRecoveryBar';
import { requirementAccepted, legacySpecOnly } from '../../lib/subreq';
import {
  Sparkles,
  Bot,
  User,
  Loader2,
  Eye,
  ChevronRight,
  Send,
  X,
} from 'lucide-react';

interface IssueChatTabProps {
  issue: Issue;
  splitIssue: boolean;
  visibleMessages: ChatMessage[];
  selectedScope: string;
  setSelectedScope: (scope: string) => void;
  lang: Language;
  themeStyle: ThemeStyle;
  isSending: boolean;
  chatError: string;
  inputPrompt: string;
  setInputPrompt: (value: string) => void;
  modelProcess: ModelProcessState;
  setModelProcess: React.Dispatch<React.SetStateAction<ModelProcessState>>;
  abortRef: RefObject<AbortController | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  handleSendMessage: (customPrompt?: string, opts?: SendMessageOpts) => Promise<void>;
  pendingLlm?: PendingLLMSession | null;
  onRetrySession?: () => void;
  onRegenerate?: () => void;
}

/** Prefer chatReply when the bubble accidentally stored a JSON envelope. */
function displayMessageText(text: string, lang: Language): string {
  const raw = (text || '').trim();
  if (!(raw.startsWith('{') && (raw.includes('"chatReply"') || raw.includes('"rawMarkdown"')))) {
    return text;
  }
  try {
    const parsed = JSON.parse(raw) as { chatReply?: string; rawMarkdown?: string };
    if (parsed.chatReply?.trim()) return parsed.chatReply.trim();
    if (parsed.rawMarkdown?.trim()) {
      return lang === 'zh'
        ? '已更新文档，请到「需求文档 & 开发设计」查看全文。'
        : 'Document updated — open the Spec tab for the full text.';
    }
  } catch {
    const m = raw.match(/"chatReply"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (m?.[1]) {
      return m[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  }
  return lang === 'zh'
    ? '已生成结构化结果，请到文档页查看。'
    : 'Structured result ready — see the Spec tab.';
}

/** Side-rail preview: avoid dumping full JSON while streaming. */
function processBodyPreview(body: string, lang: Language): string {
  const raw = (body || '').trim();
  if (!raw) return '';
  if (raw.startsWith('{') && (raw.includes('"chatReply"') || raw.includes('"rawMarkdown"'))) {
    try {
      const parsed = JSON.parse(raw) as { chatReply?: string };
      if (parsed.chatReply?.trim()) return parsed.chatReply.trim();
    } catch {
      const m = raw.match(/"chatReply"\s*:\s*"((?:\\.|[^"\\])*)"/);
      if (m?.[1]) {
        return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').slice(0, 800);
      }
    }
    return lang === 'zh' ? '正在生成结构化文档…' : 'Generating structured document…';
  }
  return body;
}

export const IssueChatTab: React.FC<IssueChatTabProps> = ({
  issue,
  splitIssue,
  visibleMessages,
  selectedScope,
  setSelectedScope,
  lang,
  themeStyle,
  isSending,
  chatError,
  inputPrompt,
  setInputPrompt,
  modelProcess,
  setModelProcess,
  abortRef,
  messagesEndRef,
  handleSendMessage,
  pendingLlm,
  onRetrySession,
  onRegenerate,
}) => {
  const themeConfig = THEME_CONFIGS[themeStyle] || THEME_CONFIGS.light;
  const t = getTranslation(lang);
  const reqOk = requirementAccepted(issue) || legacySpecOnly(issue);
  const canDesign = reqOk && (issue.associatedRepoIds || []).length > 0;
  const hasDesign = !!(
    issue.devSpec?.rawMarkdown?.trim() ||
    (issue.subRequirements || []).some((s) => !!s.devSpec?.rawMarkdown?.trim())
  );

  const latestEntry = modelProcess.entries[modelProcess.entries.length - 1];
  const activeEntry = useMemo(() => {
    const id = modelProcess.activeId || latestEntry?.id;
    return modelProcess.entries.find((e) => e.id === id) || latestEntry;
  }, [modelProcess.activeId, modelProcess.entries, latestEntry]);

  const openProcessRail = (id?: string) => {
    setModelProcess((prev) => ({
      ...prev,
      expanded: true,
      activeId: id || prev.activeId || prev.entries[prev.entries.length - 1]?.id,
    }));
  };

  const closeProcessRail = () => {
    setModelProcess((prev) => ({ ...prev, expanded: false }));
  };

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
      {/* Main row: chat thread + optional process rail (Cursor-style) */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="flex-1 min-w-0 p-4 sm:p-5 overflow-y-auto space-y-3">
          {splitIssue && (
            <SubRequirementBar
              issue={issue}
              selectedScope={selectedScope}
              onSelect={setSelectedScope}
              lang={lang}
              themeStyle={themeStyle}
            />
          )}

          {visibleMessages.map((msg) => {
            const body = displayMessageText(msg.text, lang);
            return (
              <div
                key={msg.id}
                className={`flex items-start gap-2.5 ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}
              >
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                    msg.sender === 'user'
                      ? 'bg-indigo-600 text-white'
                      : msg.sender === 'ai'
                      ? 'bg-violet-600 text-white'
                      : `${themeConfig.cardBg} ${themeConfig.textMuted}`
                  }`}
                >
                  {msg.sender === 'user' ? (
                    <User className="w-3.5 h-3.5" />
                  ) : msg.sender === 'ai' ? (
                    <Bot className="w-3.5 h-3.5" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                </div>

                <div
                  className={`max-w-[min(720px,85%)] px-3.5 py-2.5 text-[13px] leading-relaxed ${
                    msg.sender === 'user'
                      ? 'bg-indigo-600 text-white rounded-2xl rounded-tr-md'
                      : msg.sender === 'ai'
                      ? `${themeConfig.textPrimary} rounded-2xl rounded-tl-md`
                      : `${themeConfig.textMuted} font-mono text-[12px]`
                  }`}
                >
                  <div
                    className={`flex items-center gap-2 mb-1 text-[10px] ${
                      msg.sender === 'user' ? 'text-indigo-100/80' : themeConfig.textMuted
                    }`}
                  >
                    <span className="font-medium">
                      {msg.sender === 'user'
                        ? lang === 'zh'
                          ? '你'
                          : 'You'
                        : msg.sender === 'ai'
                        ? 'Vibe'
                        : lang === 'zh'
                          ? '系统'
                          : 'System'}
                    </span>
                    <span className="opacity-70">{msg.timestamp}</span>
                    {msg.sender === 'ai' && msg.model ? (
                      <span className="opacity-60 font-mono truncate max-w-[10rem]" title={msg.model}>
                        {msg.model}
                      </span>
                    ) : null}
                  </div>
                  {msg.sender === 'ai' ? (
                    <MarkdownView text={body} />
                  ) : (
                    <div className="select-text whitespace-pre-wrap">{body}</div>
                  )}
                </div>
              </div>
            );
          })}

          {isSending && (
            <div className={`flex items-center gap-2 text-xs px-1 ${themeConfig.textMuted}`}>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
              <span>{lang === 'zh' ? '正在思考…' : 'Thinking…'}</span>
              <button
                type="button"
                className="underline text-indigo-500"
                onClick={() => abortRef.current?.abort()}
              >
                {t.cancel}
              </button>
            </div>
          )}
          {chatError && !pendingLlm && (
            <div className="text-xs text-rose-500 px-1 select-text">{chatError}</div>
          )}
          <LLMRecoveryBar
            session={pendingLlm || null}
            lang={lang}
            themeStyle={themeStyle}
            busy={isSending}
            onRetrySession={() => onRetrySession?.()}
            onRegenerate={() => onRegenerate?.()}
          />
          <div ref={messagesEndRef} />
        </div>

        {/* Process rail: one active entry, list of others as compact rows */}
        {modelProcess.expanded && modelProcess.entries.length > 0 && (
          <aside
            className={`w-[min(320px,40%)] shrink-0 border-l flex flex-col min-h-0 ${themeConfig.subtleBorder} ${themeConfig.modalHeaderBg}`}
          >
            <div className={`px-3 py-2.5 border-b flex items-center justify-between gap-2 ${themeConfig.subtleBorder}`}>
              <div className={`flex items-center gap-1.5 text-[11px] font-semibold ${themeConfig.textPrimary}`}>
                <Eye className="w-3.5 h-3.5 text-indigo-500" />
                {lang === 'zh' ? '模型过程' : 'Process'}
              </div>
              <button
                type="button"
                onClick={closeProcessRail}
                className={`p-1 rounded-md ${themeConfig.textMuted} hover:opacity-80`}
                title={lang === 'zh' ? '收起' : 'Close'}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className={`border-b max-h-[30%] overflow-y-auto ${themeConfig.subtleBorder}`}>
              {[...modelProcess.entries].reverse().map((entry) => {
                const selected = entry.id === activeEntry?.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => openProcessRail(entry.id)}
                    className={`w-full text-left px-3 py-2 flex items-start gap-2 text-[11px] border-b last:border-b-0 transition-colors ${themeConfig.subtleBorder} ${
                      selected ? 'bg-indigo-500/10' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
                    }`}
                  >
                    <ChevronRight
                      className={`w-3 h-3 mt-0.5 shrink-0 transition-transform ${selected ? 'rotate-90 text-indigo-500' : themeConfig.textMuted}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`font-mono text-[10px] ${themeConfig.textMuted}`}>{entry.at}</span>
                        <span
                          className={
                            entry.status === 'running'
                              ? 'text-indigo-500'
                              : entry.status === 'error'
                              ? 'text-rose-500'
                              : 'text-emerald-600'
                          }
                        >
                          {entry.status === 'running'
                            ? t.processStreaming
                            : entry.status === 'error'
                            ? t.processError
                            : t.processDone}
                        </span>
                      </div>
                      <div className={`truncate mt-0.5 ${themeConfig.textSecondary}`} title={entry.prompt}>
                        {entry.prompt}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {activeEntry && (
              <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
                <pre
                  ref={(el) => {
                    if (el && activeEntry.status === 'running') {
                      el.scrollTop = el.scrollHeight;
                    }
                  }}
                  className={`whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed select-text ${themeConfig.textSecondary}`}
                >
                  {processBodyPreview(activeEntry.body, lang)}
                  {activeEntry.status === 'running' ? '▌' : ''}
                </pre>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Compact status strip (like Cursor thinking bar) */}
      {modelProcess.entries.length > 0 && (
        <div
          className={`shrink-0 border-t px-3 py-1.5 flex items-center justify-between gap-2 text-[11px] ${themeConfig.subtleBorder} ${themeConfig.modalHeaderBg}`}
        >
          <button
            type="button"
            onClick={() =>
              modelProcess.expanded ? closeProcessRail() : openProcessRail(latestEntry?.id)
            }
            className={`flex items-center gap-1.5 min-w-0 ${themeConfig.textSecondary}`}
          >
            <Eye className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            {latestEntry?.status === 'running' && (
              <Loader2 className="w-3 h-3 animate-spin text-indigo-500 shrink-0" />
            )}
            <span className="truncate">
              {modelProcess.expanded
                ? lang === 'zh'
                  ? '收起过程面板'
                  : 'Hide process'
                : latestEntry?.status === 'running'
                  ? lang === 'zh'
                    ? '查看模型过程…'
                    : 'View model process…'
                  : lang === 'zh'
                    ? `模型过程 · ${modelProcess.entries.length} 条`
                    : `Process · ${modelProcess.entries.length}`}
            </span>
          </button>
          {!modelProcess.expanded && latestEntry && (
            <span
              className={`shrink-0 text-[10px] ${
                latestEntry.status === 'running'
                  ? 'text-indigo-500'
                  : latestEntry.status === 'error'
                  ? 'text-rose-500'
                  : 'text-emerald-600'
              }`}
            >
              {latestEntry.status === 'running'
                ? t.processStreaming
                : latestEntry.status === 'error'
                ? t.processError
                : t.processDone}
            </span>
          )}
        </div>
      )}

      {/* Composer */}
      <div className={`shrink-0 p-3 sm:p-4 border-t space-y-2.5 ${themeConfig.subtleBorder} ${themeConfig.modalHeaderBg}`}>
        <div className="flex items-center gap-2 overflow-x-auto text-[11px]">
          <button
            onClick={() =>
              handleSendMessage(
                lang === 'zh'
                  ? '请帮我澄清验收标准与边界条件（只分析，先不要改文档）。'
                  : 'Help clarify acceptance criteria and edge cases (analysis only, do not rewrite docs).'
              )
            }
            className={`px-2.5 py-1 rounded-lg border shrink-0 transition-colors ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText}`}
          >
            {lang === 'zh' ? '澄清验收与边界' : 'Clarify acceptance'}
          </button>
          <button
            onClick={() =>
              handleSendMessage(
                lang === 'zh'
                  ? '请根据当前讨论提炼完整需求文档（目标、范围、非目标、验收、约束）。'
                  : 'Extract a complete requirement document from this discussion.',
                { forceReqDoc: true }
              )
            }
            className={`px-2.5 py-1 rounded-lg border shrink-0 transition-colors ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText}`}
          >
            {t.extractReqBtn}
          </button>
          {canDesign && (
            <button
              type="button"
              disabled={!!isSending}
              onClick={() => {
                const custom =
                  inputPrompt.trim() ||
                  (lang === 'zh'
                    ? hasDesign
                      ? '请结合当前对话与关联仓库源码摘要，修订并写回完整开发设计文档。'
                      : '请基于关联仓库源码摘要与当前讨论，撰写完整开发设计。'
                    : hasDesign
                      ? 'Revise the Dev Spec from this discussion and associated repo excerpts; write back the full document.'
                      : 'Write a complete Dev Spec from associated repo excerpts and this discussion.');
                void handleSendMessage(custom, { forceSpecSync: true });
              }}
              className={`px-2.5 py-1 rounded-lg border shrink-0 transition-colors ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText} disabled:opacity-50`}
            >
              {lang === 'zh' ? (hasDesign ? '修订开发设计' : '生成开发设计') : hasDesign ? 'Revise design' : 'Generate design'}
            </button>
          )}
        </div>

        <div className="flex items-end gap-2">
          <textarea
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSendMessage();
              }
            }}
            rows={3}
            placeholder={
              lang === 'zh'
                ? canDesign
                  ? '输入讨论点（Enter 发送，Shift+Enter 换行）；写回设计请说「更新开发设计」…'
                  : '输入问题或讨论点…（Enter 发送，Shift+Enter 换行）'
                : canDesign
                  ? 'Discuss (Enter send, Shift+Enter newline); say “update Dev Spec” to write the design…'
                  : 'Ask or discuss… (Enter send, Shift+Enter newline)'
            }
            className={`flex-1 min-h-[4.5rem] max-h-40 px-3.5 py-2.5 border rounded-xl text-[13px] leading-relaxed resize-y focus:outline-none focus:border-indigo-500 transition-colors ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
          />
          <button
            onClick={() => handleSendMessage()}
            disabled={isSending || !inputPrompt.trim()}
            className="px-3.5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-all shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            {lang === 'zh' ? '发送' : 'Send'}
          </button>
        </div>
      </div>

    </div>
  );
};
