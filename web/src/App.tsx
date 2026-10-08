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
import { CommandPalette, isMac } from './components/CommandPalette';
import { ActivityTimeline } from './components/ActivityTimeline';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import {
  FolderKanban,
  Settings,
  Plus,
  Sliders,
  Globe,
  Palette,
  Check,
  Loader2,
  AlertCircle,
  X,
  Maximize2,
  Trash2,
  Command,
  Sparkles,
  Activity,
  ChevronDown,
} from 'lucide-react';
import { isDesktopApp, toggleDesktopMaximize } from './lib/desktop';

const LOGO_MARK = '/logo-mark.png';

const PROJECT_GRADIENTS = [
  'from-indigo-500 to-violet-600',
  'from-cyan-500 to-blue-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-fuchsia-500 to-purple-600',
];

function getProjectInitials(name: string): string {
  const parts = name.trim().split(/[\s\-_]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

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
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);

  const autoDevJobs = useRef<Map<string, string>>(new Map()); // issueId -> jobId
  const unsubscribers = useRef<Map<string, () => void>>(new Map());
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  const themeMenuRef = useRef<HTMLDivElement>(null);

  const t = getTranslation(language);
  const themeConfig = THEME_CONFIGS[themeStyle] || THEME_CONFIGS.light;
  const isLight = themeConfig.isLight;

  useEffect(() => {
    document.getElementById('boot-splash')?.remove();
  }, []);

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

  /** Skip the first activeProjectId effect after bootstrap (already loaded issues). */
  const skipActiveRefreshRef = useRef(true);

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
        skipActiveRefreshRef.current = true;
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
    if (skipActiveRefreshRef.current) {
      skipActiveRefreshRef.current = false;
      return;
    }
    refreshIssues(activeProjectId).catch((err) => showToast('error', err.message));
  }, [activeProjectId, refreshIssues, showToast]);

  const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0];
  const activeIssues = issues.filter((i) => i.projectId === activeProject?.id);

  useEffect(() => {
    if (!isProjectDropdownOpen && !isThemeMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (isProjectDropdownOpen && projectDropdownRef.current && !projectDropdownRef.current.contains(target)) {
        setIsProjectDropdownOpen(false);
      }
      if (isThemeMenuOpen && themeMenuRef.current && !themeMenuRef.current.contains(target)) {
        setIsThemeMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isProjectDropdownOpen, isThemeMenuOpen]);

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
          skipActiveRefreshRef.current = false;
          setActiveProjectId(next[0]?.id || '');
        }
        return next;
      });
      setIssues((prev) => prev.filter((i) => i.projectId !== projectId));
      setIssueCounts((prev) => {
        if (!(projectId in prev)) return prev;
        const next = { ...prev };
        delete next[projectId];
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
      setIssues((prev) => (saved.projectId === activeProjectId ? [saved, ...prev] : prev));
      setIssueCounts((prev) => ({
        ...prev,
        [saved.projectId]: (prev[saved.projectId] || 0) + 1,
      }));
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

  useKeyboardShortcuts({
    onToggleCommandPalette: () => setIsCommandPaletteOpen((v) => !v),
    onToggleActivity: () => setIsActivityOpen((v) => !v),
    onCreateIssue: () => {
      if (activeProject) setIsCreateIssueModalOpen(true);
    },
    onOpenSettings: () => setIsGlobalSettingsOpen(true),
    onRefresh: () => {
      if (activeProjectId) {
        refreshIssues(activeProjectId).catch((err) => showToast('error', err.message));
      }
    },
    isPaletteOpen: isCommandPaletteOpen,
  });

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
      const deleted = issues.find((i) => i.id === issueId);
      await api.deleteIssue(issueId);
      setIssues((prev) => prev.filter((i) => i.id !== issueId));
      if (deleted) {
        setIssueCounts((prev) => ({
          ...prev,
          [deleted.projectId]: Math.max(0, (prev[deleted.projectId] || 0) - 1),
        }));
      }
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

      <aside
        className={`w-16 border-r flex flex-col items-center py-3.5 justify-between shrink-0 z-40 overflow-visible ${themeConfig.sidebarBg} transition-colors duration-300`}
      >
        <div className="flex flex-col items-center gap-3 w-full">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center p-1.5 transition-transform hover:scale-105 cursor-pointer"
            title="Vibecoding Dashboard"
          >
            <img src={LOGO_MARK} alt="Vibecoding" className="w-full h-full object-contain" />
          </div>
          <div className={`w-8 h-px ${themeConfig.subtleBorder} border-t`} />
          <div className="flex flex-col items-center gap-1 w-full px-1.5 py-0.5 max-h-[calc(100vh-220px)] overflow-y-auto no-scrollbar">
            {projects.map((proj, idx) => {
              const isActive = proj.id === activeProject?.id;
              const initials = getProjectInitials(proj.name);
              const gradient = PROJECT_GRADIENTS[idx % PROJECT_GRADIENTS.length];
              return (
                <div key={proj.id} className="relative group flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      setDeletingProjectId(null);
                      setActiveProjectId(proj.id);
                    }}
                    title={`${proj.name} (${issueCounts[proj.id] || 0} issues)`}
                    className={`relative w-11 h-11 rounded-2xl flex items-center justify-center transition-colors outline-none ${
                      isActive
                        ? isLight
                          ? 'bg-indigo-50'
                          : 'bg-indigo-500/20'
                        : isLight
                          ? 'hover:bg-slate-200/80'
                          : 'hover:bg-white/8'
                    }`}
                  >
                    <span
                      className={`w-8 h-8 rounded-[10px] font-bold text-[11px] flex items-center justify-center text-white shadow-sm bg-gradient-to-br ${gradient} ${
                        isActive ? 'shadow-indigo-500/35' : 'opacity-80 group-hover:opacity-100'
                      }`}
                    >
                      {initials}
                    </span>
                    {isActive && (
                      <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-3.5 h-0.5 rounded-full bg-indigo-500" />
                    )}
                  </button>
                  <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 hidden group-hover:flex z-[80] pointer-events-none px-2.5 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-white text-xs whitespace-nowrap shadow-xl items-center gap-2">
                    <span className="font-semibold">{proj.name}</span>
                    <span className="text-slate-400 text-[10px]">({issueCounts[proj.id] || 0})</span>
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setEditingProject(null);
                setIsProjectModalOpen(true);
              }}
              title={t.newProject}
              className={`w-10 h-10 rounded-xl border border-dashed flex items-center justify-center transition-all ${
                isLight
                  ? 'border-slate-300 text-slate-500 hover:border-indigo-400 hover:text-indigo-500 hover:bg-indigo-50'
                  : 'border-white/20 text-slate-400 hover:border-indigo-400 hover:text-indigo-400 hover:bg-white/5'
              }`}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-col items-center gap-2.5 w-full pt-2">
          <button
            type="button"
            onClick={() => setIsCommandPaletteOpen(true)}
            className={`w-10 h-10 rounded-xl flex items-center justify-center relative transition-colors ${
              isLight
                ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                : 'text-slate-400 hover:text-white hover:bg-white/10'
            }`}
            title={`${language === 'zh' ? '全局命令面板' : 'Command Palette'} (${isMac ? '⌘K' : 'Ctrl+K'})`}
          >
            <Command className="w-4 h-4 text-indigo-400" />
          </button>
          <button
            type="button"
            onClick={() => setIsGlobalSettingsOpen(true)}
            className={`w-10 h-10 rounded-xl flex items-center justify-center relative transition-colors ${
              isLight
                ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                : 'text-slate-400 hover:text-white hover:bg-white/10'
            }`}
            title={t.globalLLMConfig}
          >
            <Sliders className="w-4 h-4" />
            <div
              className={`absolute top-2 right-2 w-2.5 h-2.5 rounded-full border ${
                effectiveLlmReady
                  ? isLight
                    ? 'bg-emerald-500 border-white'
                    : 'bg-emerald-400 border-slate-950'
                  : isLight
                    ? 'bg-amber-500 border-white'
                    : 'bg-amber-400 border-slate-950'
              }`}
            />
          </button>
          <div className="relative" ref={themeMenuRef}>
            <button
              type="button"
              onClick={() => setIsThemeMenuOpen(!isThemeMenuOpen)}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                isLight
                  ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                  : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
              title={t.switchThemeHint}
            >
              <Palette className="w-4 h-4 text-purple-400" />
            </button>
            {isThemeMenuOpen && (
                <div
                  className={`absolute left-12 bottom-0 w-44 border rounded-xl shadow-2xl p-2 z-[80] flex flex-col gap-1 ${themeConfig.modalBg}`}
                >
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
                        className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium flex items-center justify-between transition-colors ${
                          isSelected
                            ? 'bg-indigo-600 text-white font-bold shadow-sm'
                            : `${themeConfig.textSecondary} hover:bg-black/5 dark:hover:bg-white/10`
                        }`}
                      >
                        <span>{language === 'zh' ? cfg.nameZh : cfg.nameEn}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                      </button>
                    );
                  })}
                </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setLanguage((l) => (l === 'en' ? 'zh' : 'en'))}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
              isLight
                ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                : 'text-slate-400 hover:text-white hover:bg-white/10'
            }`}
            title={t.switchLanguageHint}
          >
            <Globe className="w-4 h-4 text-cyan-400" />
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col bg-transparent min-w-0">
        <header
          className={`dashboard-header relative z-20 border-b flex items-center justify-between shrink-0 min-w-0 ${themeConfig.headerBg} transition-colors duration-300 overflow-visible`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="relative z-50" ref={projectDropdownRef}>
              <button
                type="button"
                onClick={() => setIsProjectDropdownOpen((v) => !v)}
                className={`dashboard-project-btn rounded-xl border flex items-center gap-2 font-semibold transition-all ${
                  isLight
                    ? 'bg-white border-slate-300 text-slate-800 hover:border-indigo-400'
                    : 'bg-slate-900/70 border-white/15 text-slate-100 hover:border-indigo-400/60'
                }`}
              >
                <FolderKanban className="w-4 h-4 text-indigo-500 shrink-0" />
                <span className="truncate max-w-[clamp(100px,18vw,240px)]">
                  {activeProject?.name || t.workspaceFallback}
                </span>
                <ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0" />
              </button>
              {isProjectDropdownOpen && (
                  <div
                    className={`absolute left-0 top-full mt-2 w-72 border rounded-xl shadow-2xl p-2 z-[80] flex flex-col gap-1.5 ${themeConfig.modalBg}`}
                  >
                    <div className="flex items-center justify-between px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <span>{t.workspaceProjects}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setIsProjectDropdownOpen(false);
                          setEditingProject(null);
                          setIsProjectModalOpen(true);
                        }}
                        className="text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5"
                      >
                        <Plus className="w-3 h-3" />
                        <span>{t.newProject}</span>
                      </button>
                    </div>
                    <div className="space-y-1 max-h-60 overflow-y-auto">
                      {projects.map((p) => {
                        const isActive = p.id === activeProject?.id;
                        return (
                          <div
                            key={p.id}
                            onClick={() => {
                              setActiveProjectId(p.id);
                              setIsProjectDropdownOpen(false);
                            }}
                            className={`p-2 rounded-lg text-xs cursor-pointer flex items-center justify-between transition-colors ${
                              isActive
                                ? 'bg-indigo-600 text-white font-semibold'
                                : `${themeConfig.textSecondary} hover:bg-black/5 dark:hover:bg-white/10`
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-5 h-5 rounded bg-white/20 flex items-center justify-center text-[9px] font-bold shrink-0">
                                {getProjectInitials(p.name)}
                              </div>
                              <span className="truncate">{p.name}</span>
                            </div>
                            <span className="font-mono text-[10px] opacity-70 shrink-0">
                              {issueCounts[p.id] || 0}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {activeProject && (
                      <div className={`pt-2 border-t flex items-center justify-between px-1 ${themeConfig.subtleBorder}`}>
                        <button
                          type="button"
                          onClick={() => {
                            setIsProjectDropdownOpen(false);
                            setEditingProject(activeProject);
                            setIsProjectModalOpen(true);
                          }}
                          className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1"
                        >
                          <Settings className="w-3.5 h-3.5" />
                          <span>{t.projectSettings}</span>
                        </button>
                        {deletingProjectId === activeProject.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setDeletingProjectId(null)}
                              className={`px-2 py-0.5 rounded text-[10px] ${themeConfig.textSecondary}`}
                            >
                              {t.cancel}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteProject(activeProject.id)}
                              className="px-2 py-0.5 rounded text-[10px] font-bold text-white bg-rose-500"
                            >
                              {t.confirm}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDeletingProjectId(activeProject.id)}
                            className="text-xs text-rose-400 hover:text-rose-300 font-medium flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{t.deleteProject}</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
              )}
            </div>

            {activeProject && (
              <div
                className={`collapse-on-compact flex items-center gap-2 text-xs no-squeeze ${
                  isLight ? 'text-slate-600' : 'text-slate-400'
                }`}
              >
                <span>·</span>
                <span
                  className={`font-mono font-bold px-1.5 py-0.5 rounded border no-squeeze ${
                    isLight ? 'bg-slate-100 text-slate-800 border-slate-300' : 'bg-white/10 text-slate-200 border-white/10'
                  }`}
                >
                  {(activeProject.gitRepos || []).length}
                </span>
                <span className="no-squeeze">{language === 'zh' ? '个本地工程' : 'repos'}</span>
                <span>·</span>
                <span
                  className={`font-mono font-bold px-1.5 py-0.5 rounded border no-squeeze ${
                    isLight ? 'bg-slate-100 text-slate-800 border-slate-300' : 'bg-white/10 text-slate-200 border-white/10'
                  }`}
                >
                  {activeIssues.length}
                </span>
                <span className="no-squeeze">{language === 'zh' ? '个需求' : 'issues'}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0 no-squeeze">
            <button
              type="button"
              onClick={() => setIsActivityOpen((v) => !v)}
              className={`header-action-btn rounded-xl font-medium border flex items-center gap-1.5 transition-all shadow-2xs ${
                isActivityOpen
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : isLight
                    ? 'bg-slate-100/90 hover:bg-slate-200/90 border-slate-300 text-slate-700'
                    : 'bg-slate-900/80 hover:bg-slate-800 border-white/15 text-slate-300'
              }`}
              title={`${language === 'zh' ? '活动时间线' : 'Activity Timeline'} (${isMac ? '⌘J' : 'Ctrl+J'})`}
            >
              <Activity className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden xl:inline fluid-text-xs font-medium">
                {language === 'zh' ? '动态' : 'Activity'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setIsCommandPaletteOpen(true)}
              className={`header-action-btn rounded-xl font-medium border flex items-center gap-1.5 sm:gap-2 transition-all shadow-2xs ${
                isLight
                  ? 'bg-slate-100/90 hover:bg-slate-200/90 border-slate-300 text-slate-700'
                  : 'bg-slate-900/80 hover:bg-slate-800 border-white/15 text-slate-300'
              }`}
              title={`${language === 'zh' ? '打开全局命令面板' : 'Open Command Palette'} (${isMac ? '⌘K' : 'Ctrl+K'})`}
            >
              <Command className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              <span className="hidden xl:inline fluid-text-xs font-medium">
                {language === 'zh' ? '命令' : 'Commands'}
              </span>
              <kbd
                className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border leading-none ${
                  isLight
                    ? 'bg-white text-slate-700 border-slate-300'
                    : 'bg-white/10 text-slate-300 border-white/15'
                }`}
              >
                {isMac ? '⌘K' : 'Ctrl+K'}
              </kbd>
            </button>
            <button
              type="button"
              onClick={() => setIsGlobalSettingsOpen(true)}
              className={`header-action-btn rounded-xl font-medium border flex items-center gap-1.5 sm:gap-2 transition-all shadow-2xs ${
                isLight
                  ? 'bg-white hover:bg-slate-50 border-slate-300 text-slate-800'
                  : 'bg-slate-900/80 hover:bg-slate-800 border-white/15 text-slate-200'
              }`}
              title={
                effectiveLlmReady
                  ? `${effectiveModelConfig.openAIModel || 'LLM'}`
                  : language === 'zh'
                    ? '未配置大模型'
                    : 'LLM not configured'
              }
            >
              <Sparkles
                className={`w-3.5 h-3.5 shrink-0 ${effectiveLlmReady ? 'text-indigo-500' : 'text-amber-500'}`}
              />
              <span className="font-mono font-bold fluid-text-xs truncate max-w-[clamp(60px,8vw,120px)]">
                {effectiveModelConfig.openAIModel || 'LLM'}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold border shrink-0 ${
                  effectiveLlmReady
                    ? isLight
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                      : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : isLight
                      ? 'bg-amber-100 text-amber-800 border-amber-300'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                }`}
              >
                {effectiveLlmReady
                  ? language === 'zh'
                    ? '已配置'
                    : 'Ready'
                  : language === 'zh'
                    ? '未配置'
                    : 'Setup'}
              </span>
            </button>
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
              className="header-action-btn bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl font-bold shadow-md hover:shadow-lg transition-all flex items-center gap-1.5 disabled:opacity-40"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">{t.newIssue}</span>
            </button>
          </div>
        </header>

        <div className="flex-1 flex min-h-0 overflow-hidden">
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
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
          </div>
          {isActivityOpen && (
            <aside
              className={`w-80 max-w-[40vw] border-l shrink-0 ${themeConfig.sidebarBg} ${themeConfig.subtleBorder}`}
            >
              <ActivityTimeline
                activeProject={activeProject || null}
                issues={activeIssues}
                onSelectIssue={openIssue}
                onClose={() => setIsActivityOpen(false)}
                language={language}
                themeStyle={themeStyle}
                llmReady={effectiveLlmReady}
              />
            </aside>
          )}
        </div>
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

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        projects={projects}
        activeProjectId={activeProject?.id || ''}
        onSelectProject={(projectId) => setActiveProjectId(projectId)}
        issues={activeIssues}
        onSelectIssue={openIssue}
        onCreateNewIssue={() => {
          if (activeProject) setIsCreateIssueModalOpen(true);
        }}
        onCreateNewProject={() => {
          setEditingProject(null);
          setIsProjectModalOpen(true);
        }}
        onOpenProjectSettings={() => {
          if (!activeProject) return;
          setEditingProject(activeProject);
          setIsProjectModalOpen(true);
        }}
        onOpenGlobalSettings={() => setIsGlobalSettingsOpen(true)}
        onRefreshBoard={() => {
          if (activeProjectId) {
            refreshIssues(activeProjectId).catch((err) => showToast('error', err.message));
          }
        }}
        onToggleActivity={() => setIsActivityOpen((v) => !v)}
        currentTheme={themeStyle}
        onSelectTheme={setThemeStyle}
        language={language}
        onToggleLanguage={() => setLanguage((l) => (l === 'en' ? 'zh' : 'en'))}
        themeStyle={themeStyle}
      />
    </div>
  );
}
