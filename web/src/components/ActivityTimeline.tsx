import React, { useMemo, useState } from 'react';
import {
  Activity,
  GitCommit,
  GitBranch,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Clock,
  RefreshCw,
  ChevronRight,
  Bot,
  X,
} from 'lucide-react';
import { Project, Issue } from '../types';
import { Language, ThemeStyle } from '../lib/i18n';
import { THEME_CONFIGS } from '../lib/theme';

interface ActivityTimelineProps {
  activeProject: Project | null;
  issues: Issue[];
  onSelectIssue: (issue: Issue) => void;
  onClose: () => void;
  language: Language;
  themeStyle: ThemeStyle;
}

type FilterType = 'all' | 'jobs' | 'commits';

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({
  activeProject,
  issues,
  onSelectIssue,
  onClose,
  language,
  themeStyle,
}) => {
  const [filter, setFilter] = useState<FilterType>('all');
  const [lastRefreshed, setLastRefreshed] = useState<Date>(() => new Date());

  const themeConfig = THEME_CONFIGS[themeStyle] || THEME_CONFIGS.light;
  const isLight = themeConfig.isLight;

  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = Date.now();
    const diffSec = Math.floor((now - date.getTime()) / 1000);

    if (diffSec < 45) return language === 'zh' ? '刚刚' : 'Just now';
    if (diffSec < 3600) {
      const min = Math.max(1, Math.floor(diffSec / 60));
      return language === 'zh' ? `${min}分钟前` : `${min}m ago`;
    }
    if (diffSec < 86400) {
      const hours = Math.floor(diffSec / 3600);
      return language === 'zh' ? `${hours}小时前` : `${hours}h ago`;
    }
    const days = Math.floor(diffSec / 86400);
    if (days === 1) return language === 'zh' ? '昨天' : 'Yesterday';
    if (days < 7) return language === 'zh' ? `${days}天前` : `${days}d ago`;
    return date.toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', {
      month: 'numeric',
      day: 'numeric',
    });
  };

  const autoDevJobs = useMemo(() => {
    return issues
      .filter((i) => {
        return (
          i.autoDevProgress > 0 ||
          (i.autoDevLogs && i.autoDevLogs.length > 0) ||
          i.status === 'in_progress' ||
          i.status === 'in_review' ||
          Boolean(i.prInfo)
        );
      })
      .map((issue) => {
        const isRunning = issue.status === 'in_progress' && issue.autoDevProgress < 100;
        const isCompleted =
          issue.status === 'in_review' || issue.status === 'completed' || issue.autoDevProgress >= 100;
        const isFailed =
          issue.status === 'requirements' && (issue.autoDevLogs || []).some((l) => l.phase === 'failed');

        const latestLog =
          issue.autoDevLogs && issue.autoDevLogs.length > 0
            ? issue.autoDevLogs[issue.autoDevLogs.length - 1]
            : null;

        return {
          issue,
          isRunning,
          isCompleted,
          isFailed,
          progress: issue.autoDevProgress,
          latestLog,
          phase: latestLog?.phase || (isRunning ? 'coding' : 'completed'),
          updatedAt: issue.updatedAt || issue.createdAt,
        };
      })
      .sort((a, b) => {
        if (a.isRunning && !b.isRunning) return -1;
        if (!a.isRunning && b.isRunning) return 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [issues]);

  const runningCount = autoDevJobs.filter((j) => j.isRunning).length;
  const commitsCount = 0;

  const phaseLabels: Record<string, { zh: string; en: string; color: string }> = {
    analyzing: { zh: '解析文档', en: 'Analyzing', color: 'text-cyan-500 bg-cyan-500/10 border-cyan-500/30' },
    branching: { zh: '隔离分支', en: 'Branching', color: 'text-sky-500 bg-sky-500/10 border-sky-500/30' },
    setup: { zh: '环境构建', en: 'Setup', color: 'text-blue-500 bg-blue-500/10 border-blue-500/30' },
    coding: { zh: 'AI自治改码', en: 'Coding', color: 'text-indigo-500 bg-indigo-500/10 border-indigo-500/30' },
    agent: { zh: '执行测试', en: 'Testing', color: 'text-purple-500 bg-purple-500/10 border-purple-500/30' },
    testing: { zh: '单元测试', en: 'Unit Tests', color: 'text-violet-500 bg-violet-500/10 border-violet-500/30' },
    linting: { zh: '代码规约', en: 'Linting', color: 'text-amber-500 bg-amber-500/10 border-amber-500/30' },
    committing: { zh: '提交PR', en: 'Committing', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30' },
    completed: { zh: '任务就绪', en: 'Completed', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30' },
    failed: { zh: '执行中断', en: 'Failed', color: 'text-rose-500 bg-rose-500/10 border-rose-500/30' },
  };

  return (
    <div className="flex flex-col h-full w-full select-none overflow-hidden text-xs">
      <div
        className={`px-3.5 py-3 border-b flex items-center justify-between gap-2 shrink-0 ${
          isLight ? 'bg-slate-50/90 border-slate-200' : 'bg-slate-900/90 border-white/10'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center shrink-0">
            <Activity className="w-3.5 h-3.5 text-indigo-500" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={`font-bold text-xs truncate ${themeConfig.textPrimary}`}>
                {language === 'zh' ? '动态时间线' : 'Activity Timeline'}
              </span>
              {runningCount > 0 && (
                <span className="flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-500 border border-amber-500/40 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  <span>{runningCount}</span>
                </span>
              )}
            </div>
            <p className={`text-[10px] truncate ${themeConfig.textMuted}`}>
              {activeProject?.name || (language === 'zh' ? '未选择工程' : 'No project')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setLastRefreshed(new Date())}
            className={`p-1.5 rounded-lg border transition-all ${
              isLight
                ? 'hover:bg-slate-200/80 text-slate-500 hover:text-slate-800 border-slate-200'
                : 'hover:bg-white/10 text-slate-400 hover:text-white border-white/10'
            }`}
            title={language === 'zh' ? '刷新动态记录' : 'Refresh activity'}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className={`p-1.5 rounded-lg border transition-all ${
              isLight
                ? 'hover:bg-slate-200/80 text-slate-500 hover:text-slate-800 border-slate-200'
                : 'hover:bg-white/10 text-slate-400 hover:text-white border-white/10'
            }`}
            title={language === 'zh' ? '收起时间线面板' : 'Collapse timeline'}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div
        className={`px-3 py-2 border-b flex items-center justify-between gap-1 shrink-0 ${
          isLight ? 'bg-slate-100/60 border-slate-200' : 'bg-slate-950/40 border-white/10'
        }`}
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-all ${
              filter === 'all'
                ? isLight
                  ? 'bg-white text-indigo-600 shadow-2xs border border-slate-300 font-bold'
                  : 'bg-indigo-600 text-white shadow-2xs font-bold'
                : isLight
                  ? 'text-slate-600 hover:bg-slate-200/60'
                  : 'text-slate-400 hover:bg-white/5'
            }`}
          >
            {language === 'zh' ? '全部' : 'All'}
          </button>
          <button
            type="button"
            onClick={() => setFilter('jobs')}
            className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-all ${
              filter === 'jobs'
                ? isLight
                  ? 'bg-white text-indigo-600 shadow-2xs border border-slate-300 font-bold'
                  : 'bg-indigo-600 text-white shadow-2xs font-bold'
                : isLight
                  ? 'text-slate-600 hover:bg-slate-200/60'
                  : 'text-slate-400 hover:bg-white/5'
            }`}
          >
            <Bot className="w-3 h-3 text-indigo-400" />
            <span>{language === 'zh' ? 'AI 任务' : 'Jobs'}</span>
            <span className="font-mono text-[10px] opacity-75">({autoDevJobs.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setFilter('commits')}
            className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-all ${
              filter === 'commits'
                ? isLight
                  ? 'bg-white text-indigo-600 shadow-2xs border border-slate-300 font-bold'
                  : 'bg-indigo-600 text-white shadow-2xs font-bold'
                : isLight
                  ? 'text-slate-600 hover:bg-slate-200/60'
                  : 'text-slate-400 hover:bg-white/5'
            }`}
          >
            <GitCommit className="w-3 h-3 text-emerald-400" />
            <span>{language === 'zh' ? 'Git 提交' : 'Commits'}</span>
            <span className="font-mono text-[10px] opacity-75">({commitsCount})</span>
          </button>
        </div>
        <span className={`text-[10px] font-mono ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
          {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {(filter === 'all' || filter === 'jobs') && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-bold tracking-wider uppercase text-slate-400">
              <span className="flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5 text-indigo-500" />
                <span>{language === 'zh' ? 'Auto-Dev 自治执行' : 'Auto-Dev Execution'}</span>
              </span>
              <span className="font-mono text-[10px] font-normal">{autoDevJobs.length}</span>
            </div>

            {autoDevJobs.length === 0 ? (
              <div
                className={`p-3 rounded-xl border border-dashed text-center text-xs ${
                  isLight ? 'border-slate-200 bg-slate-50/50 text-slate-500' : 'border-white/10 bg-white/2 text-slate-400'
                }`}
              >
                <Sparkles className="w-4 h-4 mx-auto text-slate-400 mb-1 opacity-60" />
                <p>{language === 'zh' ? '暂无进行中或已记录的自治任务' : 'No active or recent auto-dev jobs'}</p>
                <p className="text-[10px] text-slate-400/80 mt-0.5">
                  {language === 'zh' ? '在待执行列点击 Auto-Dev 即可启动' : 'Click Auto-Dev on backlog cards to trigger'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {autoDevJobs.map((job) => {
                  const phaseInfo = phaseLabels[job.phase] || phaseLabels.coding;
                  return (
                    <div
                      key={job.issue.id}
                      onClick={() => onSelectIssue(job.issue)}
                      className={`p-2.5 rounded-xl border transition-all cursor-pointer group ${
                        job.isRunning
                          ? isLight
                            ? 'bg-indigo-50/80 border-indigo-300 hover:border-indigo-400 shadow-2xs'
                            : 'bg-indigo-950/30 border-indigo-500/40 hover:border-indigo-400 shadow-2xs'
                          : isLight
                            ? 'bg-white hover:bg-slate-50 border-slate-200 hover:border-slate-300 shadow-2xs'
                            : 'bg-slate-900/60 hover:bg-slate-800/80 border-white/10 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {job.isRunning ? (
                              <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin shrink-0" />
                            ) : job.isCompleted ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            ) : (
                              <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                            )}
                            <h4
                              className={`font-semibold text-xs truncate transition-colors ${
                                isLight
                                  ? 'text-slate-900 group-hover:text-indigo-600'
                                  : 'text-slate-100 group-hover:text-indigo-400'
                              }`}
                              title={job.issue.title}
                            >
                              {job.issue.title}
                            </h4>
                          </div>
                        </div>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border shrink-0 ${phaseInfo.color}`}>
                          {language === 'zh' ? phaseInfo.zh : phaseInfo.en}
                        </span>
                      </div>

                      {job.progress > 0 && (
                        <div className="mt-2 space-y-1">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className={`truncate max-w-[170px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                              {job.latestLog?.message || (job.isRunning ? '执行中...' : '已就绪')}
                            </span>
                            <span
                              className={`font-mono font-bold shrink-0 ${
                                job.isRunning ? 'text-indigo-500' : 'text-emerald-500'
                              }`}
                            >
                              {job.progress}%
                            </span>
                          </div>
                          <div
                            className={`w-full h-1.5 rounded-full overflow-hidden ${
                              isLight ? 'bg-slate-200' : 'bg-black/30'
                            }`}
                          >
                            <div
                              className={`h-full transition-all duration-300 rounded-full ${
                                job.isRunning
                                  ? 'bg-gradient-to-r from-indigo-500 to-purple-500 animate-pulse'
                                  : 'bg-emerald-500'
                              }`}
                              style={{ width: `${Math.min(100, Math.max(5, job.progress))}%` }}
                            />
                          </div>
                        </div>
                      )}

                      <div className="mt-2 pt-1.5 border-t border-slate-200/60 dark:border-white/5 flex items-center justify-between text-[10px]">
                        <div className="flex items-center gap-1.5 text-slate-400 truncate">
                          {job.issue.prInfo?.branchName ? (
                            <span className="flex items-center gap-1 font-mono text-indigo-400 font-semibold truncate">
                              <GitBranch className="w-2.5 h-2.5 shrink-0" />
                              <span className="truncate">{job.issue.prInfo.branchName}</span>
                            </span>
                          ) : (
                            <span className="font-mono">#{job.issue.id.slice(0, 8)}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-slate-400 shrink-0">
                          <Clock className="w-2.5 h-2.5" />
                          <span>{formatTime(job.updatedAt)}</span>
                          <ChevronRight className="w-3 h-3 opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all text-indigo-500" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {(filter === 'all' || filter === 'commits') && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between text-[11px] font-bold tracking-wider uppercase text-slate-400">
              <span className="flex items-center gap-1.5">
                <GitCommit className="w-3.5 h-3.5 text-emerald-500" />
                <span>{language === 'zh' ? '最新 Git 提交记录' : 'Recent Git Commits'}</span>
              </span>
              <span className="font-mono text-[10px] font-normal">{commitsCount}</span>
            </div>
            <div
              className={`p-3 rounded-xl border border-dashed text-center text-xs ${
                isLight ? 'border-slate-200 bg-slate-50/50 text-slate-500' : 'border-white/10 bg-white/2 text-slate-400'
              }`}
            >
              <GitBranch className="w-4 h-4 mx-auto text-slate-400 mb-1 opacity-60" />
              <p>{language === 'zh' ? '暂未同步到本地工程 Git 提交' : 'No git commits recorded'}</p>
              <p className="text-[10px] text-slate-400/80 mt-0.5">
                {language === 'zh'
                  ? '提交列表待项目 commits API 就绪后接入'
                  : 'Commit feed waits on the project commits API'}
              </p>
            </div>
          </div>
        )}
      </div>

      <div
        className={`px-3 py-2 border-t text-[10px] flex items-center justify-between shrink-0 font-medium ${
          isLight ? 'bg-slate-50 border-slate-200 text-slate-500' : 'bg-slate-950/60 border-white/10 text-slate-400'
        }`}
      >
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>{language === 'zh' ? 'Git 与执行器就绪' : 'Git & Executor Ready'}</span>
        </span>
        <span className="font-mono text-slate-400/80">
          {(activeProject?.gitRepos || []).length} {language === 'zh' ? '工程仓库' : 'repos'}
        </span>
      </div>
    </div>
  );
};
