import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  Plus,
  FolderGit2,
  Settings,
  Sparkles,
  Palette,
  Globe,
  RefreshCw,
  ArrowRight,
  X,
  Command,
  FileText,
  Activity,
} from 'lucide-react';
import { Project, Issue, IssueStatus } from '../types';
import { Language, ThemeStyle } from '../lib/i18n';
import { THEME_CONFIGS } from '../lib/theme';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  activeProjectId: string;
  onSelectProject: (projectId: string) => void;
  issues: Issue[];
  onSelectIssue: (issue: Issue) => void;
  onCreateNewIssue: () => void;
  onCreateNewProject: () => void;
  onOpenProjectSettings: () => void;
  onOpenGlobalSettings: () => void;
  onRefreshBoard: () => void;
  onToggleActivity?: () => void;
  currentTheme: ThemeStyle;
  onSelectTheme: (theme: ThemeStyle) => void;
  language: Language;
  onToggleLanguage: () => void;
  themeStyle: ThemeStyle;
}

interface PaletteItem {
  id: string;
  category: 'action' | 'project' | 'issue' | 'theme';
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  badge?: string;
  badgeColor?: string;
  shortcut?: string;
  action: () => void;
}

export const isMac =
  typeof window !== 'undefined' &&
  /Mac|iPhone|iPod|iPad/i.test(navigator.platform || navigator.userAgent || '');

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  projects,
  activeProjectId,
  onSelectProject,
  issues,
  onSelectIssue,
  onCreateNewIssue,
  onCreateNewProject,
  onOpenProjectSettings,
  onOpenGlobalSettings,
  onRefreshBoard,
  onToggleActivity,
  currentTheme,
  onSelectTheme,
  language,
  onToggleLanguage,
  themeStyle,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const themeConfig = THEME_CONFIGS[themeStyle] || THEME_CONFIGS.light;
  const isLight = themeConfig.isLight;

  // Reset query and focus when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  // Status badge config for issue cards in palette
  const getStatusBadge = (status: IssueStatus) => {
    switch (status) {
      case 'requirements':
        return {
          label: language === 'zh' ? '需求池' : 'Reqs',
          color: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30',
        };
      case 'backlog':
        return {
          label: language === 'zh' ? '待执行' : 'Backlog',
          color: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
        };
      case 'in_progress':
        return {
          label: language === 'zh' ? '执行中' : 'In Progress',
          color: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30',
        };
      case 'in_review':
        return {
          label: language === 'zh' ? '待评审' : 'In Review',
          color: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30',
        };
      case 'completed':
        return {
          label: language === 'zh' ? '已完成' : 'Done',
          color: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
        };
      default:
        return {
          label: status,
          color: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
        };
    }
  };

  // Compile all available items
  const allItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];

    // 1. Actions
    items.push({
      id: 'action-new-issue',
      category: 'action',
      title: language === 'zh' ? '新建 Issue / 需求' : 'Create New Issue',
      subtitle: language === 'zh' ? '打开新需求创建对话框' : 'Open new issue creation dialog',
      icon: <Plus className="w-4 h-4 text-indigo-500" />,
      shortcut: isMac ? '⌘N' : 'Ctrl+N',
      action: () => {
        onClose();
        onCreateNewIssue();
      },
    });

    items.push({
      id: 'action-new-project',
      category: 'action',
      title: language === 'zh' ? '新建工程项目' : 'Create New Project',
      subtitle: language === 'zh' ? '关联本地 Git 代码仓库与分支规范' : 'Bind local Git repo and branch prefix rules',
      icon: <FolderGit2 className="w-4 h-4 text-emerald-500" />,
      action: () => {
        onClose();
        onCreateNewProject();
      },
    });

    if (activeProject) {
      items.push({
        id: 'action-project-settings',
        category: 'action',
        title: language === 'zh' ? `工程设置: ${activeProject.name}` : `Project Settings: ${activeProject.name}`,
        subtitle: language === 'zh' ? '修改关联工程与代码仓库配置' : 'Edit repos & prefix configurations',
        icon: <Settings className="w-4 h-4 text-blue-500" />,
        action: () => {
          onClose();
          onOpenProjectSettings();
        },
      });
    }

    items.push({
      id: 'action-global-settings',
      category: 'action',
      title: language === 'zh' ? '全局与大模型设置' : 'Global & LLM Settings',
      subtitle: language === 'zh' ? '配置自定义 OpenAI / DeepSeek / Gemini 端点与 API Key' : 'Configure custom OpenAI, DeepSeek, model & API Key',
      icon: <Sparkles className="w-4 h-4 text-amber-500" />,
      shortcut: isMac ? '⌘,' : 'Ctrl+,',
      action: () => {
        onClose();
        onOpenGlobalSettings();
      },
    });

    items.push({
      id: 'action-refresh',
      category: 'action',
      title: language === 'zh' ? '刷新需求看板' : 'Refresh Kanban Board',
      subtitle: language === 'zh' ? '重新从磁盘同步最新的需求状态' : 'Re-sync issue state from backend disk',
      icon: <RefreshCw className="w-4 h-4 text-cyan-500" />,
      action: () => {
        onClose();
        onRefreshBoard();
      },
    });

    if (onToggleActivity) {
      items.push({
        id: 'action-toggle-activity',
        category: 'action',
        title: language === 'zh' ? '切换活动动态时间线' : 'Toggle Activity Timeline',
        subtitle: language === 'zh' ? '侧边栏查看最新 Auto-Dev 任务执行状态与 Git 提交' : 'Show recent auto-dev jobs and git commits in sidebar',
        icon: <Activity className="w-4 h-4 text-pink-500" />,
        shortcut: isMac ? '⌘J' : 'Ctrl+J',
        action: () => {
          onClose();
          onToggleActivity();
        },
      });
    }

    items.push({
      id: 'action-toggle-language',
      category: 'action',
      title: language === 'zh' ? 'Switch Language (切换为英文)' : '切换界面语言 (Switch to Chinese)',
      subtitle: language === 'zh' ? 'Current: 简体中文' : 'Current: English',
      icon: <Globe className="w-4 h-4 text-violet-500" />,
      badge: language === 'zh' ? 'EN' : '中文',
      action: () => {
        onClose();
        onToggleLanguage();
      },
    });

    // 2. Projects
    projects.forEach((proj) => {
      const isSelected = proj.id === activeProjectId;
      items.push({
        id: `project-${proj.id}`,
        category: 'project',
        title: proj.name,
        subtitle: proj.description || `${proj.gitRepos?.length || 0} ${language === 'zh' ? '个代码仓库' : 'repositories'}`,
        icon: <FolderGit2 className="w-4 h-4 text-indigo-400" />,
        badge: isSelected ? (language === 'zh' ? '当前工程' : 'Active') : undefined,
        badgeColor: isSelected ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' : undefined,
        action: () => {
          onClose();
          onSelectProject(proj.id);
        },
      });
    });

    // 3. Issues
    issues.forEach((issue) => {
      const statusBadge = getStatusBadge(issue.status);
      items.push({
        id: `issue-${issue.id}`,
        category: 'issue',
        title: issue.title,
        subtitle: issue.description || `#${issue.id.slice(0, 8)}`,
        icon: <FileText className="w-4 h-4 text-slate-400" />,
        badge: statusBadge.label,
        badgeColor: statusBadge.color,
        action: () => {
          onClose();
          onSelectIssue(issue);
        },
      });
    });

    // 4. Themes
    (Object.keys(THEME_CONFIGS) as ThemeStyle[]).forEach((themeKey) => {
      const cfg = THEME_CONFIGS[themeKey];
      const isSelected = themeKey === currentTheme;
      items.push({
        id: `theme-${themeKey}`,
        category: 'theme',
        title: language === 'zh' ? `主题: ${cfg.nameZh}` : `Theme: ${cfg.nameEn}`,
        subtitle: cfg.isLight ? (language === 'zh' ? '清爽明亮浅色风格' : 'Crisp light mode') : (language === 'zh' ? '高质感深色/夜间风格' : 'Dark mode / low light'),
        icon: <Palette className="w-4 h-4 text-purple-400" />,
        badge: isSelected ? (language === 'zh' ? '当前主题' : 'Current') : undefined,
        badgeColor: isSelected ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' : undefined,
        action: () => {
          onClose();
          onSelectTheme(themeKey);
        },
      });
    });

    return items;
  }, [
    language,
    projects,
    activeProject,
    activeProjectId,
    issues,
    currentTheme,
    onClose,
    onCreateNewIssue,
    onCreateNewProject,
    onOpenProjectSettings,
    onOpenGlobalSettings,
  onRefreshBoard,
  onToggleActivity,
  onToggleLanguage,
  onSelectProject,
  onSelectIssue,
  onSelectTheme,
  ]);

  // Filter items based on query
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems;

    return allItems.filter((item) => {
      const titleMatch = item.title.toLowerCase().includes(q);
      const subMatch = item.subtitle ? item.subtitle.toLowerCase().includes(q) : false;
      const badgeMatch = item.badge ? item.badge.toLowerCase().includes(q) : false;
      return titleMatch || subMatch || badgeMatch;
    });
  }, [allItems, query]);

  // Auto adjust selected index if it exceeds list length
  useEffect(() => {
    if (selectedIndex >= filteredItems.length) {
      setSelectedIndex(Math.max(0, filteredItems.length - 1));
    }
  }, [filteredItems.length, selectedIndex]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selectedEl = listRef.current.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  // Handle keyboard navigation inside the palette
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const current = filteredItems[selectedIndex];
      if (current) {
        current.action();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  const categoryLabels = {
    action: language === 'zh' ? '常用命令' : 'Quick Actions',
    project: language === 'zh' ? '切换工程' : 'Projects',
    issue: language === 'zh' ? '定位需求' : 'Issues',
    theme: language === 'zh' ? '主题风格' : 'Appearance',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[75vh] ${
          isLight ? 'bg-white border-slate-300 text-slate-900 shadow-slate-900/20' : 'bg-slate-900/95 border-white/15 text-slate-100 shadow-black/60'
        }`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Top Search Input */}
        <div className={`p-3.5 sm:p-4 border-b flex items-center gap-3 shrink-0 ${isLight ? 'border-slate-200 bg-slate-50/80' : 'border-white/10 bg-slate-950/40'}`}>
          <Search className={`w-5 h-5 shrink-0 ${isLight ? 'text-slate-400' : 'text-slate-500'}`} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder={
              language === 'zh'
                ? '搜索命令、工程、需求或设置... (输入关键词)'
                : 'Search actions, projects, issues or settings...'
            }
            className={`w-full bg-transparent text-sm sm:text-base font-medium outline-hidden placeholder:text-slate-400/70 ${
              isLight ? 'text-slate-900' : 'text-slate-100'
            }`}
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSelectedIndex(0);
                inputRef.current?.focus();
              }}
              className="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-white/10 text-slate-400 hover:text-slate-600 dark:hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <span
              className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border shrink-0 ${
                isLight ? 'bg-slate-200/80 text-slate-600 border-slate-300' : 'bg-white/10 text-slate-400 border-white/10'
              }`}
            >
              ESC
            </span>
          )}
        </div>

        {/* Results List */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredItems.length === 0 ? (
            <div className="py-14 text-center">
              <Search className="w-8 h-8 mx-auto text-slate-400/40 mb-2" />
              <p className={`text-sm font-medium ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                {language === 'zh' ? '未找到匹配项' : 'No matching results found'}
              </p>
              <p className="text-xs text-slate-400/70 mt-1">
                {language === 'zh' ? '尝试搜索其他关键词或需求名称' : 'Try searching for another keyword or issue title'}
              </p>
            </div>
          ) : (
            (() => {
              const categories: ('action' | 'project' | 'issue' | 'theme')[] = ['action', 'project', 'issue', 'theme'];

              return categories.map((cat) => {
                const itemsInCat = filteredItems.filter((item) => item.category === cat);
                if (itemsInCat.length === 0) return null;

                return (
                  <div key={cat} className="space-y-1 mb-2">
                    <div className="px-3 pt-2 pb-1 text-[11px] font-bold tracking-wider uppercase text-slate-400/80 flex items-center justify-between">
                      <span>{categoryLabels[cat]}</span>
                      <span className="text-[10px] font-mono">{itemsInCat.length}</span>
                    </div>

                    {itemsInCat.map((item) => {
                      const itemIndex = filteredItems.indexOf(item);
                      const isHighlighted = itemIndex === selectedIndex;

                      return (
                        <div
                          key={item.id}
                          data-index={itemIndex}
                          onClick={item.action}
                          onMouseEnter={() => setSelectedIndex(itemIndex)}
                          className={`px-3 py-2.5 rounded-xl cursor-pointer flex items-center justify-between gap-3 transition-colors ${
                            isHighlighted
                              ? isLight
                                ? 'bg-indigo-50 border border-indigo-200 text-indigo-950 shadow-2xs'
                                : 'bg-indigo-600/25 border border-indigo-500/40 text-white shadow-2xs'
                              : isLight
                              ? 'hover:bg-slate-100/80 text-slate-800'
                              : 'hover:bg-white/5 text-slate-300'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${
                                isHighlighted
                                  ? isLight
                                    ? 'bg-white border-indigo-300 shadow-2xs'
                                    : 'bg-indigo-500/30 border-indigo-400/50 text-white'
                                  : isLight
                                  ? 'bg-slate-100 border-slate-200'
                                  : 'bg-white/5 border-white/10'
                              }`}
                            >
                              {item.icon}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-xs sm:text-sm truncate">{item.title}</span>
                                {item.badge && (
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border shrink-0 ${
                                      item.badgeColor || (isLight ? 'bg-slate-100 border-slate-200 text-slate-700' : 'bg-white/10 border-white/10 text-slate-300')
                                    }`}
                                  >
                                    {item.badge}
                                  </span>
                                )}
                              </div>
                              {item.subtitle && (
                                <p className={`text-xs truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                                  {item.subtitle}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {item.shortcut && (
                              <kbd
                                className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                                  isLight
                                    ? 'bg-slate-100 text-slate-600 border-slate-300'
                                    : 'bg-white/10 text-slate-400 border-white/10'
                                }`}
                              >
                                {item.shortcut}
                              </kbd>
                            )}
                            {isHighlighted && (
                              <ArrowRight className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              });
            })()
          )}
        </div>

        {/* Footer with Keyboard Hints */}
        <div
          className={`px-4 py-2.5 border-t text-[11px] flex items-center justify-between shrink-0 font-medium ${
            isLight ? 'bg-slate-50 border-slate-200 text-slate-500' : 'bg-slate-950/60 border-white/10 text-slate-400'
          }`}
        >
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded border bg-slate-200/50 dark:bg-white/10 font-mono text-[10px]">↑</kbd>
              <kbd className="px-1 py-0.5 rounded border bg-slate-200/50 dark:bg-white/10 font-mono text-[10px]">↓</kbd>
              <span>{language === 'zh' ? '移动' : 'Navigate'}</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded border bg-slate-200/50 dark:bg-white/10 font-mono text-[10px]">↵</kbd>
              <span>{language === 'zh' ? '执行' : 'Select'}</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded border bg-slate-200/50 dark:bg-white/10 font-mono text-[10px]">esc</kbd>
              <span>{language === 'zh' ? '退出' : 'Dismiss'}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 font-semibold">
            <Command className="w-3.5 h-3.5" />
            <span>{isMac ? '⌘K' : 'Ctrl+K'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
