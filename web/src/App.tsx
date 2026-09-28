import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Project, Issue, ModelConfig, IssueStatus, ExecutorConfig } from './types';
import { loadLanguage, saveLanguage, loadThemeStyle, saveThemeStyle } from './lib/storage';
import { Language, ThemeStyle, getTranslation } from './lib/i18n';
import { THEME_CONFIGS } from './lib/theme';
import { api, subscribeJobEvents, getAPIToken, setAPIToken } from './lib/api';
import { hasSubRequirements, specReadyForDev, hasUnverifiedModifies, backlogBlockReason } from './lib/subreq';
import { KanbanBoard } from './components/KanbanBoard';
import { IssueDetailModal, ISSUE_SESSION_DOCK_ID } from './components/IssueDetailModal';
import { ProjectModal } from './components/ProjectModal';
import { CreateIssueModal } from './components/CreateIssueModal';
import { GlobalSettingsModal } from './components/GlobalSettingsModal';
import { StartAutoDevModal } from './components/StartAutoDevModal';
import {
  FolderKanban,
  Settings,
  Plus,
  Sliders,
  ChevronRight,
  Globe,
  Palette,
  Check,
  Loader2,
  AlertCircle,
  X,
  Maximize2,
  Trash2,
} from 'lucide-react';
import { isDesktopApp, toggleDesktopMaximize } from './lib/desktop';

const LOGO_MARK = '/logo-mark.png';

const DEFAULT_MODEL: ModelConfig = {
  useCustomOpenAI: true,
  openAIBaseUrl: 'https://api.openai.com/v1/chat/completions',
  openAIApiKey: '',
  openAIModel: 'gpt-4o',
  temperature: 0.7,
};

export default function App() {
  const [globalModelConfig, setGlobalModelConfig] = useState<ModelConfig>(DEFAULT_MODEL);
  const [projects, setProjects] = useState<Project[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [issueCounts, setIssueCounts] = useState<Record<string, number>>({});
  const [activeProjectId, setActiveProjectId] = useState<string>('');
  const [language, setLanguage] = useState<Language>(loadLanguage);
  const [themeStyle, setThemeStyle] = useState<ThemeStyle>(loadThemeStyle);
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [llmReady, setLlmReady] = useState(false);
  const [toast, setToast] = useState<{ type: 'error' | 'info' | 'success'; text: string } | null>(null);

  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [mountedIssueIds, setMountedIssueIds] = useState<string[]>([]);
  const [minimizedIssueIds, setMinimizedIssueIds] = useState<string[]>([]);
  const [busyIssueIds, setBusyIssueIds] = useState<Record<string, boolean>>({});
  const [sessionIssues, setSessionIssues] = useState<Record<string, Issue>>({});
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [isCreateIssueModalOpen, setIsCreateIssueModalOpen] = useState(false);
  const [isGlobalSettingsOpen, setIsGlobalSettingsOpen] = useState(false);
  const [startPick, setStartPick] = useState<{ issueId: string; subRequirementId?: string } | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);

  const autoDevJobs = useRef<Map<string, string>>(new Map()); // issueId -> jobId
  const unsubscribers = useRef<Map<string, () => void>>(new Map());

  const t = getTranslation(language);
  const themeConfig = THEME_CONFIGS[themeStyle] || THEME_CONFIGS.light;

  const showToast = useCallback((type: 'error' | 'info' | 'success', text: string) => {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const refreshIssues = useCallback(async (projectId?: string) => {
    const list = await api.listIssues(projectId);
    setIssues(list);
    if (projectId) {
      setIssueCounts((prev) => ({ ...prev, [projectId]: list.length }));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        let health = await api.health();
        if (health.authRequired && !getAPIToken()) {
          const entered = window.prompt(
            language === 'zh'
              ? '服务端需要 API Token（非本机绑定）。请输入 VIBECODING_TOKEN / --token：'
              : 'Server requires an API token (non-localhost bind). Enter VIBECODING_TOKEN / --token:'
          );
          if (entered) setAPIToken(entered.trim());
          else {
            if (!cancelled) {
              setLoadError(
                language === 'zh' ? '需要 API Token 才能连接后端' : 'API token required to connect to backend'
              );
              setLoading(false);
            }
            return;
          }
        }
        const [model, prefs, projs] = await Promise.all([
          api.getModel(),
          api.getUIPrefs(),
          api.listProjects(),
        ]);
        if (cancelled) return;
        // Refresh health after token may have been set (llmConfigured still public).
        health = await api.health();
        setLlmReady(!!health.llmConfigured);
        setGlobalModelConfig(model);
        setProjects(projs);
        const active =
          prefs.activeProjectId && projs.some((p) => p.id === prefs.activeProjectId)
            ? prefs.activeProjectId
            : projs[0]?.id || '';
        setActiveProjectId(active);
        if (prefs.language === 'en' || prefs.language === 'zh') {
          setLanguage(prefs.language);
        }
        if (prefs.themeStyle && ['glass', 'slate', 'light', 'oled', 'oat'].includes(prefs.themeStyle)) {
          setThemeStyle(prefs.themeStyle as ThemeStyle);
        }
        const allIssues = await api.listIssues();
        if (cancelled) return;
        const counts: Record<string, number> = {};
        for (const iss of allIssues) {
          counts[iss.projectId] = (counts[iss.projectId] || 0) + 1;
        }
        setIssueCounts(counts);
        setIssues(active ? allIssues.filter((iss) => iss.projectId === active) : []);
        setLoadError('');
      } catch (err: any) {
        if (!cancelled) setLoadError(err.message || getTranslation(loadLanguage()).loadBackendFailed);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      unsubscribers.current.forEach((u) => u());
      unsubscribers.current.clear();
    };
  }, []);

  useEffect(() => {
    saveLanguage(language);
  }, [language]);

  useEffect(() => {
    saveThemeStyle(themeStyle);
    if (themeConfig.isLight) {
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
    }
  }, [themeStyle, themeConfig.isLight]);

  useEffect(() => {
    if (!activeProjectId && !language && !themeStyle) return;
    api
      .putUIPrefs({ language, themeStyle, activeProjectId })
      .catch(() => undefined);
  }, [language, themeStyle, activeProjectId]);

  useEffect(() => {
    if (!activeProjectId) {
      setIssues([]);
      return;
    }
    refreshIssues(activeProjectId).catch((err) => showToast('error', err.message));
  }, [activeProjectId, refreshIssues, showToast]);

  const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0];
  const activeIssues = issues.filter((i) => i.projectId === activeProject?.id);

  useEffect(() => {
    if (!activeProjectId) return;
    if (issues.some((iss) => iss.projectId !== activeProjectId)) return;
    setIssueCounts((prev) => {
      if (prev[activeProjectId] === issues.length) return prev;
      return { ...prev, [activeProjectId]: issues.length };
    });
  }, [issues, activeProjectId]);

  const effectiveModelConfig: ModelConfig =
    activeProject?.useCustomModelConfig && activeProject?.customModelConfig
      ? activeProject.customModelConfig
      : globalModelConfig;

  // Sidebar status: project custom key OR global key (API responses mask secrets via keyConfigured).
  const effectiveLlmReady = !!(
    (activeProject?.useCustomModelConfig &&
      (activeProject.customModelConfig?.keyConfigured ||
        activeProject.customModelConfig?.openAIApiKey)) ||
    globalModelConfig.keyConfigured ||
    globalModelConfig.openAIApiKey ||
    llmReady
  );

  const patchIssueLocal = useCallback((updated: Issue) => {
    setIssues((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    setSessionIssues((prev) => (prev[updated.id] ? { ...prev, [updated.id]: updated } : prev));
  }, []);

  const handleSaveGlobalConfig = async (newConfig: ModelConfig) => {
    try {
      const saved = await api.putModel(newConfig);
      setGlobalModelConfig(saved);
      setLlmReady(!!saved.keyConfigured);
      showToast('success', t.llmSettingsSaved);
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleSaveProject = async (projectData: Partial<Project>) => {
    try {
      if (editingProject) {
        const saved = await api.updateProject(editingProject.id, { ...editingProject, ...projectData });
        setProjects((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      } else {
        const saved = await api.createProject(projectData);
        setProjects((prev) => [...prev, saved]);
        setActiveProjectId(saved.id);
      }
      setEditingProject(null);
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    try {
      await api.deleteProject(projectId);
      setDeletingProjectId(null);
      setProjects((prev) => {
        const next = prev.filter((p) => p.id !== projectId);
        if (activeProjectId === projectId) {
          setActiveProjectId(next[0]?.id || '');
        }
        return next;
      });
      showToast('success', t.projectDeleted);
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleCreateIssue = async (issueData: Partial<Issue>) => {
    try {
      const saved = await api.createIssue(issueData);
      setIssues((prev) => [saved, ...prev]);
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleUpdateIssue = useCallback(
    async (updatedIssue: Issue) => {
      // Optimistic local update with functional setState
      patchIssueLocal(updatedIssue);
      try {
        const saved = await api.updateIssue(updatedIssue.id, updatedIssue);
        patchIssueLocal(saved);
      } catch (err: any) {
        showToast('error', err.message);
        if (activeProjectId) {
          refreshIssues(activeProjectId).catch(() => undefined);
        }
      }
    },
    [activeProjectId, patchIssueLocal, refreshIssues, showToast]
  );

  const handleStartAutoDev = (issueId: string, subRequirementId?: string) => {
    const targetIssue = issues.find((i) => i.id === issueId);
    if (!targetIssue) return;
    if (targetIssue.status === 'in_progress' && autoDevJobs.current.has(issueId)) {
      showToast('info', t.autoDevAlreadyRunning);
      return;
    }
    if (!specReadyForDev(targetIssue)) {
      showToast('error', hasSubRequirements(targetIssue) ? t.autoDevNeedsSubSpecs : t.autoDevNeedsSpec);
      return;
    }
    if (!targetIssue.associatedRepoIds?.length) {
      showToast('error', t.autoDevNeedsRepo);
      return;
    }
    setStartPick({ issueId, subRequirementId });
  };

  const launchAutoDev = async (issueId: string, subRequirementId: string | undefined, executor: ExecutorConfig) => {
    const targetIssue = issues.find((i) => i.id === issueId);
    if (!targetIssue) return;

    try {
      const job = await api.startAutoDev(issueId, subRequirementId, executor);
      autoDevJobs.current.set(issueId, job.id);
      patchIssueLocal({
        ...targetIssue,
        status: 'in_progress',
        autoDevProgress: 5,
        updatedAt: new Date().toISOString(),
      });

      const unsub = subscribeJobEvents(job.id, async (ev) => {
        const apply = (iss: Issue): Issue => {
          if (iss.id !== issueId) return iss;
          let next = { ...iss };
          if (typeof ev.progress === 'number') next.autoDevProgress = ev.progress;
          if (ev.log) next.autoDevLogs = [...(next.autoDevLogs || []), ev.log];
          else if (ev.message) {
            next.autoDevLogs = [
              ...(next.autoDevLogs || []),
              {
                id: `log-${Date.now()}-${Math.random()}`,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                phase: (ev.phase as any) || 'analyzing',
                message: ev.message,
                details: ev.details,
              },
            ];
          }
          if (ev.prInfo) next.prInfo = ev.prInfo;
          if (ev.subRequirementId) next.currentSubId = ev.subRequirementId;
          if (ev.type === 'done' && ev.status === 'completed') {
            next.status = 'in_review';
            next.autoDevProgress = 100;
          }
          if (ev.type === 'error' || ev.status === 'failed') {
            next.status = 'backlog';
          }
          if (ev.status === 'cancelled') {
            next.status = 'backlog';
          }
          return next;
        };
        if (ev.type === 'error' || ev.status === 'failed') {
          showToast('error', ev.error || t.autoDevFailed);
        }
        setIssues((prev) => prev.map(apply));
        setSessionIssues((prev) => {
          const cur = prev[issueId];
          return cur ? { ...prev, [issueId]: apply(cur) } : prev;
        });

        if (ev.type === 'done' || ev.type === 'error' || ev.status === 'cancelled' || ev.status === 'failed') {
          autoDevJobs.current.delete(issueId);
          unsubscribers.current.get(issueId)?.();
          unsubscribers.current.delete(issueId);
          try {
            const fresh = await api.listIssues(activeProjectId);
            setIssues(fresh);
            setSessionIssues((prev) => {
              const cur = prev[issueId];
              if (!cur) return prev;
              const updated = fresh.find((i) => i.id === issueId);
              return updated ? { ...prev, [issueId]: updated } : prev;
            });
          } catch {
            /* ignore */
          }
        }
      });
      unsubscribers.current.set(issueId, unsub);
    } catch (err: any) {
      showToast('error', err.message || t.autoDevStartFailed);
    }
  };

  const handleCancelAutoDev = async (issueId: string) => {
    try {
      // Prefer issue-scoped cancel so it still works after refresh / lost job id.
      const res = await api.cancelAutoDevByIssue(issueId);
      autoDevJobs.current.delete(issueId);
      unsubscribers.current.get(issueId)?.();
      unsubscribers.current.delete(issueId);
      if (res.issue) {
        patchIssueLocal(res.issue);
      } else {
        const cur = issues.find((i) => i.id === issueId);
        if (cur) {
          patchIssueLocal({
            ...cur,
            status: 'backlog',
            updatedAt: new Date().toISOString(),
          });
        }
      }
      showToast('info', t.autoDevCancelRequested);
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleMoveColumn = async (issueId: string, newStatus: IssueStatus) => {
    const target = issues.find((i) => i.id === issueId);
    if (!target) return;
    if (newStatus === 'backlog') {
      if (!specReadyForDev(target)) {
        showToast(
          'error',
          backlogBlockReason(target, language) ||
            (hasSubRequirements(target) ? t.backlogNeedsSubSpecs : t.backlogNeedsSpec)
        );
        return;
      }
      if (!target.associatedRepoIds?.length) {
        showToast('error', t.backlogNeedsRepo);
        return;
      }
      if (hasUnverifiedModifies(target)) {
        const ok = window.confirm(
          language === 'zh'
            ? '开发设计中仍有未核实的修改点。确认仍要进入待执行吗？'
            : 'Some modify/delete file changes are unverified. Move to backlog anyway?'
        );
        if (!ok) return;
      }
    }
    if (newStatus === 'in_review' && !target.prInfo) {
      showToast('error', t.reviewNeedsAutoDev);
      return;
    }
    await handleUpdateIssue({ ...target, status: newStatus, updatedAt: new Date().toISOString() });
  };

  const analyzingIssueIds = new Set(
    Object.entries(busyIssueIds)
      .filter(([, busy]) => busy)
      .map(([id]) => id)
  );

  const dismissIssueSession = useCallback((issueId: string) => {
    setSelectedIssueId((prev) => (prev === issueId ? null : prev));
    setMountedIssueIds((ids) => ids.filter((id) => id !== issueId));
    setMinimizedIssueIds((ids) => ids.filter((id) => id !== issueId));
    setBusyIssueIds((prev) => {
      if (!(issueId in prev)) return prev;
      const next = { ...prev };
      delete next[issueId];
      return next;
    });
    setSessionIssues((prev) => {
      if (!prev[issueId]) return prev;
      const next = { ...prev };
      delete next[issueId];
      return next;
    });
  }, []);

  const openIssue = useCallback(
    (issue: Issue) => {
      const previousId = selectedIssueId;
      setSessionIssues((prev) => ({ ...prev, [issue.id]: issue }));
      if (previousId && previousId !== issue.id) {
        if (busyIssueIds[previousId]) {
          setMinimizedIssueIds((ids) => (ids.includes(previousId) ? ids : [...ids, previousId]));
        } else if (!minimizedIssueIds.includes(previousId)) {
          setMountedIssueIds((mounted) => mounted.filter((id) => id !== previousId));
        }
      }
      setSelectedIssueId(issue.id);
      setMinimizedIssueIds((ids) => ids.filter((id) => id !== issue.id));
      setMountedIssueIds((ids) => (ids.includes(issue.id) ? ids : [...ids, issue.id]));
    },
    [selectedIssueId, busyIssueIds, minimizedIssueIds]
  );

  const minimizeIssue = useCallback((issueId: string) => {
    setSelectedIssueId((prev) => (prev === issueId ? null : prev));
    setMinimizedIssueIds((ids) => (ids.includes(issueId) ? ids : [...ids, issueId]));
    setMountedIssueIds((ids) => (ids.includes(issueId) ? ids : [...ids, issueId]));
  }, []);

  const handleDeleteIssue = async (issueId: string) => {
    try {
      if (autoDevJobs.current.has(issueId)) {
        try {
          await api.cancelAutoDevByIssue(issueId);
        } catch {
          /* still delete the issue */
        }
        autoDevJobs.current.delete(issueId);
        unsubscribers.current.get(issueId)?.();
        unsubscribers.current.delete(issueId);
      }
      await api.deleteIssue(issueId);
      setIssues((prev) => prev.filter((i) => i.id !== issueId));
      dismissIssueSession(issueId);
      showToast('success', t.issueDeleted);
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-slate-950 text-slate-200 gap-3">
        <img src={LOGO_MARK} alt="Vibecoding" className="w-16 h-16 object-contain" />
        <div className="text-base font-bold tracking-tight">Vibecoding</div>
        <div className="flex items-center text-xs text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> {t.loadingApp}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-slate-950 text-slate-200 gap-3 p-6">
        <AlertCircle className="w-8 h-8 text-rose-400" />
        <p className="text-sm">{t.backendUnavailable}: {loadError}</p>
        <p className="text-xs text-slate-400">{t.startBackendHint}</p>
      </div>
    );
  }

  return (
    <div className={`flex h-screen w-screen overflow-hidden font-sans ${themeConfig.appBg} transition-colors duration-300`}>
      {toast && (
        <div
          className={`fixed top-4 right-4 z-[100] max-w-sm rounded-xl border px-4 py-3 text-sm shadow-xl flex items-start gap-2 ${
            toast.type === 'error'
              ? 'bg-rose-950/90 border-rose-500/40 text-rose-100'
              : toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-100'
              : 'bg-slate-900/90 border-slate-500/40 text-slate-100'
          }`}
        >
          <span className="flex-1 select-text">{toast.text}</span>
          <button onClick={() => setToast(null)}>
            <X className="w-4 h-4 opacity-70" />
          </button>
        </div>
      )}

      <aside className={`w-64 border-r flex flex-col justify-between shrink-0 z-20 ${themeConfig.sidebarBg} transition-colors duration-300`}>
        <div>
          <div className={`p-6 flex items-center justify-between border-b ${themeConfig.subtleBorder} ${themeConfig.modalHeaderBg}`}>
            <div className="flex items-center space-x-3 min-w-0">
              <img
                src={LOGO_MARK}
                alt="Vibecoding"
                className="w-9 h-9 object-contain shrink-0"
              />
              <div className="min-w-0">
                <span className={`text-base font-bold tracking-tight block ${themeConfig.textPrimary}`}>Vibecoding</span>
                <span className={`text-[10px] uppercase tracking-widest font-mono ${themeConfig.textMuted}`}>
                  {t.subtitle}
                </span>
              </div>
            </div>
          </div>

          <nav className="p-4 space-y-6">
            <div>
              <div className={`flex items-center justify-between text-[10px] uppercase tracking-widest font-bold mb-3 px-2 ${themeConfig.textMuted}`}>
                <span>{t.workspaceProjects}</span>
                <button
                  onClick={() => {
                    setEditingProject(null);
                    setIsProjectModalOpen(true);
                  }}
                  className={`p-1 rounded transition-colors ${themeConfig.sidebarItemHover}`}
                  title={t.newProject}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                {projects.length === 0 && (
                  <div className={`text-xs px-2 py-3 ${themeConfig.textMuted}`}>
                    {t.noProjectsYet}
                  </div>
                )}
                {projects.map((proj) => {
                  const isActive = proj.id === activeProject?.id;
                  const confirmingDelete = deletingProjectId === proj.id;
                  return (
                    <div
                      key={proj.id}
                      onClick={() => {
                        setDeletingProjectId(null);
                        setActiveProjectId(proj.id);
                      }}
                      className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-1 group ${
                        isActive ? themeConfig.sidebarItemActive : themeConfig.sidebarItemHover
                      }`}
                    >
                      <div className="flex items-center space-x-2.5 overflow-hidden min-w-0">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-emerald-400 animate-pulse' : 'bg-indigo-400/50'}`} />
                        <span className="text-xs font-medium truncate">{proj.name}</span>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        {!confirmingDelete && (
                          <span
                            className={`text-[10px] font-mono ${themeConfig.textMuted}`}
                            title={t.projectIssueCount.replace('{n}', String(issueCounts[proj.id] || 0))}
                          >
                            {issueCounts[proj.id] || 0}
                          </span>
                        )}
                        {!confirmingDelete && (
                          <button
                            type="button"
                            title={t.projectSettings}
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingProjectId(null);
                              setActiveProjectId(proj.id);
                              setEditingProject(proj);
                              setIsProjectModalOpen(true);
                            }}
                            className={`p-1 rounded-lg transition-opacity ${
                              isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                            } ${themeConfig.textMuted} hover:text-indigo-500 hover:bg-black/5 dark:hover:bg-white/10`}
                          >
                            <Settings className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {confirmingDelete ? (
                          <>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeletingProjectId(null);
                              }}
                              className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold ${themeConfig.textSecondary} hover:bg-black/5 dark:hover:bg-white/10`}
                            >
                              {t.cancel}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleDeleteProject(proj.id);
                              }}
                              className="px-2 py-0.5 rounded-lg text-[10px] font-bold text-white bg-rose-500 hover:bg-rose-600"
                              title={t.confirmDeleteProject.replace('{name}', proj.name)}
                            >
                              {t.confirm}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            title={t.deleteProject}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDeletingProjectId(proj.id);
                            }}
                            className={`p-1 rounded-lg transition-opacity ${
                              isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                            } text-rose-400/80 hover:text-rose-500 hover:bg-rose-500/10`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={`pt-2 border-t space-y-2 ${themeConfig.subtleBorder}`}>
              <div className={`text-[10px] uppercase tracking-widest font-bold mb-2.5 px-2 ${themeConfig.textMuted}`}>
                {t.systemSettings}
              </div>
              <button
                onClick={() => setIsGlobalSettingsOpen(true)}
                className={`w-full p-3 rounded-xl transition-colors flex items-center justify-between border border-transparent ${themeConfig.sidebarItemHover}`}
              >
                <div className="flex items-center space-x-2.5">
                  <Sliders className="w-4 h-4 text-indigo-500" />
                  <span className="text-xs font-medium">{t.globalLLMConfig}</span>
                </div>
                <ChevronRight className={`w-3.5 h-3.5 ${themeConfig.textMuted}`} />
              </button>
            </div>
          </nav>
        </div>

        <div className={`p-4 border-t ${themeConfig.subtleBorder} ${themeConfig.modalHeaderBg}`}>
          <div
            className={`rounded-xl p-3 flex items-center space-x-2.5 border ${
              effectiveLlmReady
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-amber-500/10 border-amber-500/30'
            }`}
          >
            <div className={`w-2 h-2 rounded-full shrink-0 ${effectiveLlmReady ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <div className="overflow-hidden">
              <div
                className={`text-[10px] font-mono font-semibold truncate uppercase ${
                  effectiveLlmReady ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'
                }`}
              >
                {effectiveLlmReady
                  ? `${t.openaiPrefix}: ${effectiveModelConfig.openAIModel || t.customModel}`
                  : t.llmNotConfigured}
              </div>
              <div className={`text-[9px] truncate ${themeConfig.textMuted}`}>
                {effectiveLlmReady
                  ? effectiveModelConfig.keyHint || effectiveModelConfig.openAIBaseUrl || t.llmReady
                  : t.openSettingsAddKey}
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden bg-transparent">
        <header className={`relative z-30 h-16 border-b px-8 flex items-center justify-between shrink-0 ${themeConfig.headerBg} transition-colors duration-300`}>
          <div className="flex items-center space-x-4">
            <h2 className={`text-lg font-bold tracking-tight flex items-center gap-2 ${themeConfig.textPrimary}`}>
              <FolderKanban className="w-5 h-5 text-indigo-500" />
              {activeProject?.name || t.workspaceFallback}
            </h2>
            <span className={themeConfig.textMuted}>/</span>
            <p className={`text-xs max-w-md truncate ${themeConfig.textSecondary}`}>
              {activeProject?.description || t.workspaceHint}
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => setLanguage((l) => (l === 'en' ? 'zh' : 'en'))}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5 ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText}`}
              title={t.switchLanguageHint}
            >
              <Globe className="w-3.5 h-3.5 text-cyan-500" />
              <span>{language === 'en' ? 'English' : '简体中文'}</span>
            </button>

            <div className="relative z-50">
              <button
                onClick={() => setIsThemeMenuOpen(!isThemeMenuOpen)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5 ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText}`}
                title={t.switchThemeHint}
              >
                <Palette className="w-3.5 h-3.5 text-purple-500" />
                <span>{language === 'zh' ? themeConfig.nameZh : themeConfig.nameEn}</span>
              </button>
              {isThemeMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsThemeMenuOpen(false)} />
                  <div className={`absolute right-0 mt-2 w-48 border rounded-xl shadow-2xl p-2 z-50 flex flex-col gap-1 ${themeConfig.modalBg}`}>
                    <div className={`text-[10px] font-bold uppercase px-2 py-1 tracking-wider ${themeConfig.textMuted}`}>
                      {t.themeSelection}
                    </div>
                    {(Object.keys(THEME_CONFIGS) as ThemeStyle[]).map((key) => {
                      const cfg = THEME_CONFIGS[key];
                      const isSelected = key === themeStyle;
                      return (
                        <button
                          key={key}
                          onClick={() => {
                            setThemeStyle(key);
                            setIsThemeMenuOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-between transition-colors ${
                            isSelected
                              ? 'bg-indigo-600 text-white font-bold shadow-sm'
                              : `${themeConfig.textSecondary} hover:${themeConfig.textPrimary} hover:bg-black/5 dark:hover:bg-white/10`
                          }`}
                        >
                          <span>{language === 'zh' ? cfg.nameZh : cfg.nameEn}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => void toggleDesktopMaximize()}
              className={`p-1.5 rounded-xl border transition-all ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText} ${
                isDesktopApp() ? '' : 'hidden'
              }`}
              title={language === 'zh' ? '最大化 / 还原窗口' : 'Maximize / restore window'}
            >
              <Maximize2 className="w-3.5 h-3.5 text-indigo-500" />
            </button>

            <button
              onClick={() => setIsCreateIssueModalOpen(true)}
              disabled={!activeProject}
              className="px-4 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all flex items-center gap-1.5 disabled:opacity-40"
            >
              <Plus className="w-4 h-4" />
              {t.newIssue}
            </button>
          </div>
        </header>

        {activeProject ? (
          <KanbanBoard
            issues={activeIssues}
            gitRepos={activeProject.gitRepos || []}
            branchPrefixConfig={activeProject.branchPrefixConfig}
            onSelectIssue={openIssue}
            onStartAutoDev={handleStartAutoDev}
            onMoveColumn={handleMoveColumn}
            onOpenCreateIssue={() => setIsCreateIssueModalOpen(true)}
            analyzingIssueIds={analyzingIssueIds}
            lang={language}
            themeStyle={themeStyle}
          />
        ) : (
          <div className={`flex-1 flex flex-col items-center justify-center gap-3 ${themeConfig.textSecondary}`}>
            <p className="text-sm">{t.createProjectToStart}</p>
            <button
              onClick={() => {
                setEditingProject(null);
                setIsProjectModalOpen(true);
              }}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold"
            >
              {t.newProject}
            </button>
          </div>
        )}
      </main>

      <div
        id={ISSUE_SESSION_DOCK_ID}
        className="fixed bottom-4 right-4 z-[70] flex flex-col-reverse items-end gap-2 pointer-events-none"
      />

      {mountedIssueIds.map((issueId) => {
        const issue = issues.find((i) => i.id === issueId) || sessionIssues[issueId];
        if (!issue) return null;
        return (
          <IssueDetailModal
            key={issueId}
            isOpen={selectedIssueId === issueId}
            minimized={minimizedIssueIds.includes(issueId)}
            onMinimize={() => minimizeIssue(issueId)}
            onRestore={() => openIssue(issue)}
            onDismiss={() => dismissIssueSession(issueId)}
            onBusyChange={(busy) =>
              setBusyIssueIds((prev) => (prev[issueId] === busy ? prev : { ...prev, [issueId]: busy }))
            }
            onBackgroundSettled={(result) => {
              if (result === 'cancelled') return;
              showToast(
                result === 'success' ? 'success' : 'error',
                (result === 'success' ? t.analysisDoneBackground : t.analysisFailedBackground).replace(
                  '{title}',
                  issue.title
                )
              );
            }}
            issue={issue}
            gitRepos={activeProject?.gitRepos || []}
            modelConfig={effectiveModelConfig}
            branchPrefixConfig={activeProject?.branchPrefixConfig}
            onUpdateIssue={handleUpdateIssue}
            onStartAutoDev={handleStartAutoDev}
            onCancelAutoDev={handleCancelAutoDev}
            onDeleteIssue={handleDeleteIssue}
            projectId={activeProject?.id}
            lang={language}
            themeStyle={themeStyle}
          />
        );
      })}

      {isProjectModalOpen && (
        <ProjectModal
          isOpen={isProjectModalOpen}
          onClose={() => {
            setIsProjectModalOpen(false);
            setEditingProject(null);
          }}
          onSave={handleSaveProject}
          existingProject={editingProject}
          themeStyle={themeStyle}
          lang={language}
        />
      )}

      {isCreateIssueModalOpen && activeProject && (
        <CreateIssueModal
          isOpen={isCreateIssueModalOpen}
          onClose={() => setIsCreateIssueModalOpen(false)}
          projectId={activeProject.id}
          gitRepos={activeProject.gitRepos}
          branchPrefixConfig={activeProject.branchPrefixConfig}
          onCreate={handleCreateIssue}
          lang={language}
          themeStyle={themeStyle}
        />
      )}

      {isGlobalSettingsOpen && (
        <GlobalSettingsModal
          isOpen={isGlobalSettingsOpen}
          onClose={() => setIsGlobalSettingsOpen(false)}
          config={globalModelConfig}
          onSave={handleSaveGlobalConfig}
          themeStyle={themeStyle}
          lang={language}
        />
      )}

      {startPick && (
        <StartAutoDevModal
          isOpen
          onClose={() => setStartPick(null)}
          onConfirm={(cfg) => {
            const pick = startPick;
            setStartPick(null);
            void launchAutoDev(pick.issueId, pick.subRequirementId, cfg);
          }}
          themeStyle={themeStyle}
          lang={language}
        />
      )}
    </div>
  );
}
