import React, { useEffect, useState } from 'react';
import { Issue } from '../../types';
import { Language, getTranslation, ThemeStyle } from '../../lib/i18n';
import { THEME_CONFIGS } from '../../lib/theme';
import { DiffReview } from '../DiffReview';
import { api } from '../../lib/api';
import { hasBlockingReviewComments } from '../../lib/reviewCommentStatus';
import {
  GitPullRequest,
  RotateCcw,
  GitMerge,
  AlertTriangle,
  Upload,
} from 'lucide-react';
import { ThemedSelect } from '../ThemedSelect';

interface IssueReviewTabProps {
  issue: Issue;
  splitIssue: boolean;
  lang: Language;
  themeStyle: ThemeStyle;
  showReworkBox: boolean;
  setShowReworkBox: React.Dispatch<React.SetStateAction<boolean>>;
  reworkFeedback: string;
  setReworkFeedback: React.Dispatch<React.SetStateAction<string>>;
  syncReworkToSpec: boolean;
  setSyncReworkToSpec: React.Dispatch<React.SetStateAction<boolean>>;
  reworkScope: string;
  setReworkScope: React.Dispatch<React.SetStateAction<string>>;
  handleReworkSubmit: () => Promise<void>;
  handleReworkByComments: () => Promise<void>;
  handleApproveMerge: (targets: { repoId: string; branch: string }[]) => Promise<void>;
  handlePublishRemote: () => Promise<void>;
  publishingRemote?: boolean;
  onCommentsChange: (comments: Issue['reviewComments']) => void;
}

export const IssueReviewTab: React.FC<IssueReviewTabProps> = ({
  issue,
  splitIssue,
  lang,
  themeStyle,
  showReworkBox,
  setShowReworkBox,
  reworkFeedback,
  setReworkFeedback,
  syncReworkToSpec,
  setSyncReworkToSpec,
  reworkScope,
  setReworkScope,
  handleReworkSubmit,
  handleReworkByComments,
  handleApproveMerge,
  handlePublishRemote,
  publishingRemote,
  onCommentsChange,
}) => {
  const themeConfig = THEME_CONFIGS[themeStyle] || THEME_CONFIGS.light;
  const t = getTranslation(lang);
  const mergeBlocked = hasBlockingReviewComments(issue.reviewComments);
  const openCommentCount = (issue.reviewComments || []).filter((c) => {
    const st = (c.status || 'open').trim();
    return st === 'open' || st === 'fixing' || st === '';
  }).length;
  type RepoBranches = { repoId: string; repoName: string; default?: string; branches: string[] };
  const [repoBranches, setRepoBranches] = useState<RepoBranches[]>([]);
  const [targets, setTargets] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    api
      .listIssueBranches(issue.id)
      .then((res) => {
        if (cancelled) return;
        const repos: RepoBranches[] =
          res.repos && res.repos.length > 0
            ? res.repos
            : [
                {
                  repoId: issue.associatedRepoIds?.[0] || '',
                  repoName: '',
                  default: res.default,
                  branches: res.branches || [],
                },
              ];
        setRepoBranches(repos);
        setTargets((prev) => {
          const next: Record<string, string> = {};
          for (const repo of repos) {
            if (!repo.repoId) continue;
            next[repo.repoId] =
              prev[repo.repoId] || repo.default || repo.branches[0] || issue.prInfo?.baseBranch || '';
          }
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [issue.id]);

  const multiRepo = repoBranches.filter((r) => r.repoId).length > 1;
  const onlyRepo = repoBranches.length === 1 ? repoBranches[0] : undefined;
  const onlyTarget = onlyRepo ? targets[onlyRepo.repoId] || onlyRepo.default || '' : '';
  const branchOptions = Object.fromEntries(repoBranches.map((r) => [r.repoId, r.branches || []]));

  return (
    <div className="flex-1 p-6 overflow-y-auto space-y-6">
      {/* PR Status & Action Header */}
      <div className={`p-4 rounded-xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-4 ${themeConfig.cardBg} ${themeConfig.cardBorder}`}>
        <div>
          <div className="flex items-center gap-2">
            <GitPullRequest className="w-5 h-5 text-purple-500" />
            <h3 className={`font-bold text-sm ${themeConfig.textPrimary}`}>
              {issue.prInfo?.title || `Pull Request: feature/issue-${issue.id}`}
            </h3>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold border font-mono ${
                issue.status === 'completed'
                  ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40'
                  : 'bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-500/40'
              }`}
            >
              {issue.status === 'completed' ? 'MERGED (已合并)' : 'OPEN (待评审)'}
            </span>
          </div>
          <div className={`text-xs mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 ${themeConfig.textMuted}`}>
            {!multiRepo ? (
              <span className="inline-flex items-center gap-1.5">
                {t.mergeInto}
                {issue.status === 'in_review' && onlyRepo && (onlyRepo.branches || []).length > 0 ? (
                  <span className="min-w-[10rem]">
                    <ThemedSelect
                      value={onlyTarget || issue.prInfo?.baseBranch || ''}
                      onChange={(e) =>
                        setTargets((prev) => ({ ...prev, [onlyRepo.repoId]: e.target.value }))
                      }
                      isLight={themeConfig.isLight}
                      chevronClassName={themeConfig.textSecondary}
                      className={`px-2 py-0.5 border rounded-md text-[11px] font-mono ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                    >
                      {onlyTarget && !(onlyRepo.branches || []).includes(onlyTarget) ? (
                        <option value={onlyTarget}>{onlyTarget}</option>
                      ) : null}
                      {(onlyRepo.branches || []).map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </ThemedSelect>
                  </span>
                ) : (
                  <code className="text-indigo-600 dark:text-indigo-300 font-mono">
                    {onlyTarget || issue.prInfo?.baseBranch || '—'}
                  </code>
                )}
              </span>
            ) : null}
            <span>
              {lang === 'zh' ? '特性分支' : 'feature'}:{' '}
              <code className="text-indigo-600 dark:text-indigo-300 font-mono">
                {issue.prInfo?.branchName || `feature/issue-${issue.id}`}
              </code>
            </span>
            <span>
              {lang === 'zh' ? '提交者' : 'author'}: {issue.prInfo?.author || 'AI Auto-Dev Agent'}
            </span>
            {issue.prInfo?.remoteUrl ? (
              <a href={issue.prInfo.remoteUrl} target="_blank" rel="noreferrer" className="text-sky-600 underline">
                {issue.prInfo.remoteUrl}
              </a>
            ) : null}
          </div>
          {splitIssue && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(issue.subRequirements || []).map((sub) => (
                <span
                  key={sub.id}
                  className={`px-2 py-0.5 rounded-md text-[10px] border ${themeConfig.inputBorder} ${themeConfig.textSecondary}`}
                >
                  {sub.order}. {sub.title}
                  {sub.commitSha ? ` · ${sub.commitSha}` : ` · ${sub.status}`}
                </span>
              ))}
            </div>
          )}
        </div>

        {issue.status === 'in_review' && (
          <div className="flex flex-col items-end gap-2">
          <label className={`flex items-center gap-1.5 text-[10px] cursor-pointer ${themeConfig.textMuted}`}>
            <input
              type="checkbox"
              checked={syncReworkToSpec}
              onChange={(e) => setSyncReworkToSpec(e.target.checked)}
              className="rounded border-slate-300"
            />
            {t.syncReworkToSpec}
          </label>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              type="button"
              onClick={() => void handleReworkByComments()}
              disabled={!openCommentCount}
              className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-800 dark:text-amber-200 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t.reworkByComments}
            </button>
            <button
              onClick={() => setShowReworkBox(true)}
              className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-800 dark:text-amber-200 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              二次修改 (提意见打回)
            </button>
            <button
              type="button"
              onClick={() => void handlePublishRemote()}
              disabled={!!publishingRemote}
              title={t.publishRemoteHint}
              className="px-4 py-2 bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/30 text-sky-800 dark:text-sky-200 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors disabled:opacity-40"
            >
              <Upload className="w-3.5 h-3.5" />
              {publishingRemote ? t.publishingRemote : t.publishRemote}
            </button>
            <button
              disabled={mergeBlocked}
              title={mergeBlocked ? t.mergeBlockedByComments : undefined}
              onClick={() =>
                void handleApproveMerge(
                  repoBranches
                    .filter((r) => r.repoId)
                    .map((r) => ({
                      repoId: r.repoId,
                      branch: targets[r.repoId] || r.default || issue.prInfo?.baseBranch || '',
                    }))
                )
              }
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-xl shadow-lg flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-600"
            >
              <GitMerge className="w-4 h-4" />
              合并代码 (移至已完成)
            </button>
          </div>
          </div>
        )}
      </div>
      {issue.status === 'in_review' && mergeBlocked ? (
        <p className="text-[11px] text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {t.mergeBlockedByComments}
        </p>
      ) : null}

      {/* Real diff review */}
      <DiffReview
        issueId={issue.id}
        issue={issue}
        lang={lang}
        canComment={issue.status === 'in_review'}
        canRebase={issue.status === 'in_review' || issue.status === 'backlog'}
        themeStyle={themeStyle}
        compareBases={targets}
        perRepoMerge={multiRepo && issue.status === 'in_review'}
        branchOptions={branchOptions}
        onMergeTargetChange={(repoId, branch) => setTargets((prev) => ({ ...prev, [repoId]: branch }))}
        onCommentsChange={onCommentsChange}
      />

      {showReworkBox && (
        <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 space-y-3">
          <div className="text-xs font-bold text-amber-800 dark:text-amber-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            {lang === 'zh' ? '开发者二次修改意见反馈' : 'Rework feedback'}
          </div>
          {splitIssue && (
            <label className="block text-[11px] space-y-1">
              <span className={themeConfig.textMuted}>{t.reworkScope}</span>
              <ThemedSelect
                value={reworkScope}
                onChange={(e) => setReworkScope(e.target.value)}
                isLight={themeConfig.isLight}
                chevronClassName={themeConfig.textSecondary}
                className={`p-2 border rounded-lg text-xs ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
              >
                <option value="all">{t.reworkAll}</option>
                {(issue.subRequirements || []).map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.order}. {sub.title}
                  </option>
                ))}
              </ThemedSelect>
            </label>
          )}
          <textarea
            rows={3}
            value={reworkFeedback}
            onChange={(e) => setReworkFeedback(e.target.value)}
            placeholder="指出问题所在（例如: 高并发下请求锁过期时间过短，请补全 Redis 续期与告警）"
            className={`w-full p-3 border rounded-lg text-xs focus:outline-none focus:border-amber-500 ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
          />
          <label className={`flex items-start gap-2 text-[11px] cursor-pointer ${themeConfig.textSecondary}`}>
            <input
              type="checkbox"
              checked={syncReworkToSpec}
              onChange={(e) => setSyncReworkToSpec(e.target.checked)}
              className="mt-0.5 rounded border-slate-300"
            />
            <span>
              <span className={`font-semibold ${themeConfig.textPrimary}`}>{t.syncReworkToSpec}</span>
              <span className={`block mt-0.5 ${themeConfig.textMuted}`}>{t.syncReworkToSpecHint}</span>
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowReworkBox(false)}
              className={`px-3 py-1.5 text-xs rounded-lg border ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText}`}
            >
              取消
            </button>
            <button
              onClick={handleReworkSubmit}
              className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs rounded-lg shadow"
            >
              {t.reworkThenDev}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
