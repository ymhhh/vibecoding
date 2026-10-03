import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileCode2, GitBranch, Loader2, MessageSquarePlus, SkipForward, Trash2, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { isCommentableDiffLine, parseUnifiedDiff, sumDiffStats } from '../lib/diffFormat';
import { truncateQuote } from '../lib/reviewComments';
import { Language, ThemeStyle, TRANSLATIONS } from '../lib/i18n';
import { THEME_CONFIGS } from '../lib/theme';
import { DiffComment, DiffFile, Issue, IssueDiff, QualityGate, RepoDiff } from '../types';
import { ThemedSelect } from './ThemedSelect';

interface DiffReviewProps {
  issueId: string;
  issue?: Issue;
  lang?: Language;
  themeStyle?: ThemeStyle;
  className?: string;
  canComment?: boolean;
  canRebase?: boolean;
  compareBases?: Record<string, string>;
  perRepoMerge?: boolean;
  branchOptions?: Record<string, string[]>;
  onMergeTargetChange?: (repoId: string, branch: string) => void;
  onCommentsChange?: (comments: DiffComment[]) => void;
}

function gateLabel(ran: boolean, passed: boolean, lang: Language) {
  const t = TRANSLATIONS[lang];
  if (!ran) return t.gateSkipped;
  return passed ? t.gatePassed : t.gateFailed;
}

function GateCell({
  title,
  ran,
  passed,
  output,
  lang,
}: {
  title: string;
  ran: boolean;
  passed: boolean;
  output?: string;
  lang: Language;
}) {
  const [open, setOpen] = useState(false);
  const ok = ran && passed;
  const Icon = !ran ? SkipForward : ok ? CheckCircle2 : XCircle;
  const color = !ran ? 'text-slate-500' : ok ? 'text-emerald-600' : 'text-rose-600';
  return (
    <div className="p-3 rounded-xl border border-black/10 dark:border-white/10 space-y-1">
      <div className="text-[10px] uppercase font-semibold text-slate-500">{title}</div>
      <div className={`font-bold font-mono text-sm flex items-center gap-1 ${color}`}>
        <Icon className="w-4 h-4" /> {gateLabel(ran, passed, lang)}
      </div>
      {ran && !passed && output ? (
        <button type="button" className="text-[10px] underline text-rose-600" onClick={() => setOpen((v) => !v)}>
          {open ? (lang === 'zh' ? '收起输出' : 'Hide output') : lang === 'zh' ? '展开输出' : 'Show output'}
        </button>
      ) : null}
      {open && output ? (
        <pre className="mt-1 max-h-40 overflow-auto text-[10px] whitespace-pre-wrap bg-black/5 dark:bg-white/5 p-2 rounded">
          {output}
        </pre>
      ) : null}
    </div>
  );
}

function lineNum(line: { kind: string; oldLine?: number; newLine?: number }) {
  if (line.kind === 'del') return line.oldLine;
  return line.newLine ?? line.oldLine;
}

export const DiffReview: React.FC<DiffReviewProps> = ({
  issueId,
  issue,
  lang = 'zh' as Language,
  themeStyle = 'light',
  className,
  canComment = false,
  canRebase = false,
  compareBases,
  perRepoMerge = false,
  branchOptions,
  onMergeTargetChange,
  onCommentsChange,
}) => {
  const t = TRANSLATIONS[lang];
  const themeConfig = THEME_CONFIGS[themeStyle] || THEME_CONFIGS.light;
  const [data, setData] = useState<IssueDiff | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [openPath, setOpenPath] = useState<Record<string, string>>({});
  const [focus, setFocus] = useState<{ repoId: string; path: string } | null>(null);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const [editorMsg, setEditorMsg] = useState('');
  const [anchor, setAnchor] = useState<number | null>(null);
  const [head, setHead] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState('');
  const [rebasingRepo, setRebasingRepo] = useState('');
  const basesKey = JSON.stringify(compareBases || {});

  const comments = issue?.reviewComments || [];

  const loadDiff = useCallback(() => {
    let cancelled = false;
    setError('');
    api
      .getIssueDiff(issueId, compareBases)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setOpenPath((prev) => {
          const next = { ...prev };
          for (const repo of d.repos || []) {
            const files = repo.files || [];
            if (!files.some((f) => f.path === next[repo.repoId])) {
              next[repo.repoId] = files[0]?.path || '';
            }
          }
          return next;
        });
      })
      .catch((e: { message?: string }) => {
        if (!cancelled) setError(e?.message || String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [issueId, basesKey]);

  useEffect(() => loadDiff(), [loadDiff]);

  useEffect(() => {
    const up = () => setDragging(false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  useEffect(() => {
    setAnchor(null);
    setHead(null);
    setDraft('');
  }, [focus?.repoId, focus?.path]);

  const totals = useMemo(() => sumDiffStats(data?.repos || []), [data]);
  const quality: QualityGate | undefined = data?.quality;

  const sel = useMemo(() => {
    if (anchor == null || head == null) return null;
    return { a: Math.min(anchor, head), b: Math.max(anchor, head) };
  }, [anchor, head]);

  const commentsFor = useCallback(
    (repoId: string, path: string) => comments.filter((c) => c.repoId === repoId && c.path === path),
    [comments]
  );

  if (loading && !data) {
    return (
      <div className={`flex items-center gap-2 text-sm text-slate-500 ${className || ''}`}>
        <Loader2 className="w-4 h-4 animate-spin" />
        {t.diffLoading}
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className={`p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-sm ${className || ''}`}>
        <div className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-200">
          <AlertTriangle className="w-4 h-4" />
          {t.diffLoadFailed}
        </div>
        <p className="mt-1 text-xs opacity-80">{error}</p>
      </div>
    );
  }
  if (!data) return null;

  const openEditor = async (app: 'cursor' | 'vscode', repoId: string) => {
    setEditorMsg('');
    try {
      const res = await api.openEditor(issueId, app, repoId);
      setEditorMsg(`${app}: ${res.path}`);
    } catch (e: unknown) {
      setEditorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const doRebase = async (repo: RepoDiff) => {
    setRebasingRepo(repo.repoId);
    setEditorMsg('');
    try {
      await api.rebaseIssue(issueId, {
        repoId: repo.repoId,
        base: compareBases?.[repo.repoId] || repo.baseBranch,
      });
      setEditorMsg(t.rebaseOk);
      loadDiff();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setEditorMsg(`${msg}. ${t.rebaseNeedEditor}`);
    } finally {
      setRebasingRepo('');
    }
  };

  const pickLine = (lines: ReturnType<typeof parseUnifiedDiff>, i: number, extend: boolean) => {
    if (!canComment || !isCommentableDiffLine(lines[i])) return;
    if (!extend || anchor == null) {
      setAnchor(i);
      setHead(i);
      return;
    }
    setHead(i);
  };

  const addComment = (repoId: string, file: DiffFile, patchLines: ReturnType<typeof parseUnifiedDiff>) => {
    if (!sel || !onCommentsChange || !draft.trim()) return;
    if (!focus || focus.repoId !== repoId || focus.path !== file.path) return;
    const slice = patchLines.slice(sel.a, sel.b + 1).filter(isCommentableDiffLine);
    if (!slice.length) return;
    const first = slice[0];
    const side: 'new' | 'old' = first.kind === 'del' ? 'old' : 'new';
    const nums = slice
      .map((l) => (side === 'old' ? l.oldLine : l.newLine))
      .filter((n): n is number => typeof n === 'number');
    if (!nums.length) return;
    const comment: DiffComment = {
      id: `cmt-${Date.now().toString(36)}`,
      repoId,
      path: file.path,
      side,
      startLine: Math.min(...nums),
      endLine: Math.max(...nums),
      quote: truncateQuote(slice.map((l) => l.text).join('\n')),
      body: draft.trim(),
      createdAt: new Date().toISOString(),
    };
    onCommentsChange([...comments, comment]);
    setDraft('');
    setAnchor(null);
    setHead(null);
  };

  const removeComment = (id: string) => {
    if (!onCommentsChange) return;
    onCommentsChange(comments.filter((c) => c.id !== id));
  };

  return (
    <div className={`space-y-4 ${className || ''}`}>
      {error ? (
        <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-200">
          {t.diffLoadFailed}: {error}
        </div>
      ) : null}
      {data.executor ? (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">
            {t.executorLabel}: {data.executor}
          </span>
        </div>
      ) : null}
      {editorMsg ? <p className="text-[11px] text-slate-500 font-mono">{editorMsg}</p> : null}
      {canComment ? <p className="text-[11px] text-slate-500">{t.diffCommentHint}</p> : null}

      {(data.repos || []).map((repo) => {
        const files = repo.files || [];
        const path = openPath[repo.repoId] || '';
        const file = files.find((f) => f.path === path) || null;
        const patchLines = parseUnifiedDiff(file?.patch || '');
        const focused = focus?.repoId === repo.repoId && focus?.path === file?.path;
        const fileComments = file ? commentsFor(repo.repoId, file.path) : [];
        const options = branchOptions?.[repo.repoId] || [];
        const mergeValue = compareBases?.[repo.repoId] || repo.baseBranch || '';
        const repoEmpty = files.length === 0;
        return (
          <section key={repo.repoId} className="space-y-3 rounded-xl border border-black/10 dark:border-white/10 p-3">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="font-semibold">{repo.repoName}</span>
              <span className="inline-flex items-center gap-1.5 font-mono">
                <GitBranch className="w-3.5 h-3.5" />
                {repo.baseBranch || 'base'}…{data.branchName}
              </span>
              <span className="font-mono text-emerald-600">+{repo.stats?.additions || 0}</span>
              <span className="font-mono text-rose-600">-{repo.stats?.deletions || 0}</span>
              <span className="text-slate-500">
                {repo.stats?.filesChanged || 0} {t.diffFiles}
              </span>
              <span className="text-slate-500">
                ahead {repo.ahead} / behind {repo.behind}
              </span>
              {repo.error ? <span className="text-rose-600">{repo.error}</span> : null}
              {perRepoMerge && options.length > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  {t.mergeInto}
                  <span className="min-w-[9rem]">
                    <ThemedSelect
                      value={mergeValue}
                      onChange={(e) => onMergeTargetChange?.(repo.repoId, e.target.value)}
                      isLight={themeConfig.isLight}
                      chevronClassName={themeConfig.textSecondary}
                      className="px-2 py-0.5 border rounded-md text-[11px] font-mono border-black/10 dark:border-white/10 bg-transparent"
                    >
                      {mergeValue && !options.includes(mergeValue) ? (
                        <option value={mergeValue}>{mergeValue}</option>
                      ) : null}
                      {options.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </ThemedSelect>
                  </span>
                </span>
              ) : null}
              {canRebase && repo.behind > 0 ? (
                <button
                  type="button"
                  disabled={rebasingRepo === repo.repoId}
                  onClick={() => void doRebase(repo)}
                  className="px-2 py-0.5 rounded border border-amber-500/40 text-amber-800 dark:text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
                >
                  {rebasingRepo === repo.repoId
                    ? t.rebasing
                    : t.rebaseOnto.replace('{base}', repo.baseBranch || 'base')}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => openEditor('cursor', repo.repoId)}
                className="px-2 py-0.5 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
              >
                {t.openInCursor}
              </button>
              <button
                type="button"
                onClick={() => openEditor('vscode', repo.repoId)}
                className="px-2 py-0.5 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
              >
                {t.openInVSCode}
              </button>
            </div>
            {repoEmpty ? <p className="text-xs text-slate-500">{t.diffEmpty}</p> : null}
            <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-3 min-h-[220px]">
              <div className="border rounded-xl overflow-auto max-h-[420px] text-xs">
                {files.map((f) => {
                  const active = f.path === file?.path;
                  const n = comments.filter((c) => c.repoId === repo.repoId && c.path === f.path).length;
                  return (
                    <button
                      key={f.path}
                      type="button"
                      onClick={() => {
                        setOpenPath((prev) => ({ ...prev, [repo.repoId]: f.path }));
                        setFocus({ repoId: repo.repoId, path: f.path });
                      }}
                      className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-indigo-500/10 ${
                        active ? 'bg-indigo-500/15' : ''
                      }`}
                    >
                      <FileCode2 className="w-3.5 h-3.5 shrink-0 opacity-60" />
                      <span className="truncate font-mono">{f.path}</span>
                      {n > 0 ? (
                        <span className="text-[10px] px-1 rounded bg-amber-500/20 text-amber-800 dark:text-amber-200">{n}</span>
                      ) : null}
                      <span className="ml-auto font-mono text-[10px] text-slate-500">{f.status}</span>
                    </button>
                  );
                })}
              </div>
              <div className="border rounded-xl overflow-hidden max-h-[420px] flex flex-col bg-black/[0.03] dark:bg-white/[0.03]">
                <pre className="p-3 overflow-auto flex-1 text-[11px] font-mono leading-5 select-none">
                  {!file?.patch ? (
                    <span className="text-slate-500">
                      {file?.truncated
                        ? lang === 'zh'
                          ? '补丁过大，已截断（仅保留统计）'
                          : 'Patch truncated (stats only)'
                        : lang === 'zh'
                          ? '选择左侧文件查看 unified diff'
                          : 'Select a file to view unified diff'}
                    </span>
                  ) : null}
                  {patchLines.map((l, i) => {
                    const active = focused && sel && i >= sel.a && i <= sel.b && isCommentableDiffLine(l);
                    const num = lineNum(l);
                    const marked = fileComments.some((c) => {
                      const sideNum = c.side === 'old' ? l.oldLine : l.newLine;
                      return typeof sideNum === 'number' && sideNum >= c.startLine && sideNum <= c.endLine;
                    });
                    return (
                      <div
                        key={i}
                        onMouseDown={(e) => {
                          if (!canComment || !file) return;
                          e.preventDefault();
                          const next = { repoId: repo.repoId, path: file.path };
                          focusRef.current = next;
                          setFocus(next);
                          setDragging(true);
                          pickLine(patchLines, i, false);
                        }}
                        onMouseEnter={() => {
                          const cur = focusRef.current;
                          if (
                            dragging &&
                            file &&
                            cur?.repoId === repo.repoId &&
                            cur.path === file.path
                          ) {
                            pickLine(patchLines, i, true);
                          }
                        }}
                        className={`flex gap-2 px-1 rounded ${
                          l.kind === 'add'
                            ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200'
                            : l.kind === 'del'
                              ? 'bg-rose-500/15 text-rose-800 dark:text-rose-200'
                              : l.kind === 'hunk' || l.kind === 'meta'
                                ? 'text-slate-500'
                                : ''
                        } ${active ? 'ring-1 ring-amber-400 bg-amber-400/20' : ''} ${
                          canComment && isCommentableDiffLine(l) ? 'cursor-text' : ''
                        } ${marked && !active ? 'border-l-2 border-amber-500' : ''}`}
                      >
                        <span className="w-8 shrink-0 text-right text-slate-400 tabular-nums">
                          {typeof num === 'number' ? num : ''}
                        </span>
                        <span className="whitespace-pre-wrap break-all">{l.text || ' '}</span>
                      </div>
                    );
                  })}
                </pre>
                {canComment && focused && sel && file ? (
                  <div className="border-t p-2 space-y-2 bg-amber-500/10">
                    <textarea
                      rows={2}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={t.diffCommentPlaceholder}
                      className="w-full text-xs p-2 rounded-lg border border-amber-500/40 bg-white/80 dark:bg-black/30"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setAnchor(null);
                          setHead(null);
                          setDraft('');
                        }}
                        className="px-2 py-1 text-[11px] rounded border border-black/10 dark:border-white/10"
                      >
                        {t.cancel}
                      </button>
                      <button
                        type="button"
                        disabled={!draft.trim()}
                        onClick={() => addComment(repo.repoId, file, patchLines)}
                        className="px-3 py-1 text-[11px] rounded bg-amber-600 text-white disabled:opacity-40 flex items-center gap-1"
                      >
                        <MessageSquarePlus className="w-3 h-3" />
                        {t.diffCommentAdd}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        );
      })}

      {comments.length > 0 ? (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-500">{t.diffCommentsTitle}</div>
          {comments.map((c) => {
            const repoName = data.repos.find((r) => r.repoId === c.repoId)?.repoName || c.repoId;
            return (
              <div
                key={c.id}
                className="text-xs p-2 rounded-lg border border-amber-500/30 bg-amber-500/5 flex gap-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[10px] text-slate-500 truncate">
                    [{repoName}] {c.path}:{c.side}:{c.startLine}-{c.endLine}
                  </div>
                  {c.quote ? (
                    <pre className="mt-1 text-[10px] whitespace-pre-wrap text-slate-500 max-h-16 overflow-auto">{c.quote}</pre>
                  ) : null}
                  <p className="mt-1">{c.body}</p>
                </div>
                {canComment ? (
                  <button
                    type="button"
                    onClick={() => removeComment(c.id)}
                    className="shrink-0 p-1 text-slate-400 hover:text-rose-500"
                    title={t.diffCommentRemove}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <GateCell
          title={t.gateTests}
          ran={!!quality?.testsRan}
          passed={!!quality?.testsPassed}
          output={quality?.testsOutput}
          lang={lang}
        />
        <GateCell
          title={t.gateLint}
          ran={!!quality?.lintRan}
          passed={!!quality?.lintPassed}
          output={quality?.lintOutput}
          lang={lang}
        />
        <div className="p-3 rounded-xl border border-black/10 dark:border-white/10 space-y-1">
          <div className="text-[10px] uppercase font-semibold text-slate-500">{t.gateRepairRounds}</div>
          <div className="font-bold font-mono text-sm">{quality?.repairRounds ?? 0}</div>
        </div>
        <div className="p-3 rounded-xl border border-black/10 dark:border-white/10 space-y-1">
          <div className="text-[10px] uppercase font-semibold text-slate-500">{t.gateRealChanges}</div>
          <div className="font-bold font-mono text-sm">
            <span className="text-emerald-600">+{totals.additions}</span>
            {' / '}
            <span className="text-rose-600">-{totals.deletions}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
