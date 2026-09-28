import React, { useState } from 'react';
import { Project, GitRepo, ModelConfig, BranchPrefixConfig } from '../types';
import { DEFAULT_GLOBAL_MODEL_CONFIG, DEFAULT_BRANCH_PREFIX_CONFIG } from '../data/initialData';
import { Language, ThemeStyle, getTranslation } from '../lib/i18n';
import { THEME_CONFIGS } from '../lib/theme';
import { api } from '../lib/api';
import { ThemedSelect } from './ThemedSelect';
import { testOpenAPIConnection, fetchAvailableModels } from '../lib/llm';
import {
  X,
  FolderPlus,
  GitBranch,
  Trash2,
  Plus,
  Globe,
  Settings2,
  Code,
  FileCode,
  GitFork,
  Sparkles,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Sliders,
  RefreshCw,
  BookOpen,
} from 'lucide-react';

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (projectData: Partial<Project>) => void;
  existingProject?: Project | null;
  themeStyle?: ThemeStyle;
  lang?: Language;
}

export const ProjectModal: React.FC<ProjectModalProps> = ({
  isOpen,
  onClose,
  onSave,
  existingProject,
  themeStyle = 'light',
  lang = 'zh',
}) => {
  const themeConfig = THEME_CONFIGS[themeStyle] || THEME_CONFIGS.light;
  const isLight = themeConfig.isLight;
  const t = getTranslation(lang);

  const [name, setName] = useState(existingProject?.name || '');
  const [description, setDescription] = useState(existingProject?.description || '');
  const [gitRepos, setGitRepos] = useState<GitRepo[]>(existingProject?.gitRepos || []);
  const [repoMsg, setRepoMsg] = useState('');
  const [validatingIdx, setValidatingIdx] = useState<number | null>(null);

  const [branchPrefixConfig, setBranchPrefixConfig] = useState<BranchPrefixConfig>(
    existingProject?.branchPrefixConfig || DEFAULT_BRANCH_PREFIX_CONFIG
  );

  const [useCustomModelConfig, setUseCustomModelConfig] = useState(
    existingProject?.useCustomModelConfig || false
  );
  const [customModelConfig, setCustomModelConfig] = useState<ModelConfig>(() => {
    const base = existingProject?.customModelConfig || DEFAULT_GLOBAL_MODEL_CONFIG;
    // Never put the server secret into the controlled input; blank means "keep existing".
    return { ...base, openAIApiKey: '' };
  });
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const keyAlreadyConfigured = !!(
    existingProject?.customModelConfig?.keyConfigured ||
    existingProject?.customModelConfig?.openAIApiKey
  );
  const [testingLLM, setTestingLLM] = useState(false);
  const [llmTestResult, setLlmTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsMsg, setModelsMsg] = useState('');

  const handleFetchModels = async () => {
    setFetchingModels(true);
    setModelsMsg('');
    const res = await fetchAvailableModels({
      openAIBaseUrl: customModelConfig.openAIBaseUrl.trim(),
      // Blank key → server uses this project's stored custom key.
      openAIApiKey: apiKeyDraft.trim(),
      projectId: existingProject?.id,
    });
    setFetchingModels(false);
    if (res.error) {
      setAvailableModels([]);
      setModelsMsg(t.fetchModelsFail.replace('{error}', res.error));
      return;
    }
    if (res.models.length === 0) {
      setAvailableModels([]);
      setModelsMsg(t.fetchModelsEmpty);
      return;
    }
    setAvailableModels(res.models);
    setModelsMsg(t.fetchModelsOk.replace('{count}', String(res.models.length)));
  };


  const [activeTab, setActiveTab] = useState<'basic' | 'repos' | 'branches' | 'llm'>('basic');

  const handleTestProjectLLM = async () => {
    setTestingLLM(true);
    setLlmTestResult(null);
    const res = await testOpenAPIConnection({
      openAIBaseUrl: customModelConfig.openAIBaseUrl.trim(),
      openAIApiKey: apiKeyDraft.trim(),
      openAIModel: customModelConfig.openAIModel.trim(),
      apiProtocol: customModelConfig.apiProtocol,
      // Blank key → server uses this project's stored custom key.
      projectId: existingProject?.id,
    });
    setTestingLLM(false);
    if (res.success) {
      setLlmTestResult({
        success: true,
        message: t.testOpenAPIOk.replace('{message}', res.message || ''),
      });
    } else {
      setLlmTestResult({
        success: false,
        message: t.testOpenAPIFail.replace('{error}', res.error || ''),
      });
    }
  };

  if (!isOpen) return null;

  const dirNameFromPath = (p: string) => {
    const cleaned = p.trim().replace(/[\\/]+$/, '');
    if (!cleaned) return '';
    const parts = cleaned.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || '';
  };

  const isAutoRepoName = (name: string, path: string) => {
    const n = name.trim();
    if (!n) return true;
    if (/^repo-\d+$/.test(n)) return true;
    const dir = dirNameFromPath(path);
    return !!dir && n === dir;
  };

  const handleAddRepo = () => {
    const newRepo: GitRepo = {
      id: `repo-${Date.now()}`,
      name: '',
      path: '',
      defaultBranch: 'main',
      language: '',
      description: '',
      filesCount: 0,
    };
    setGitRepos([...gitRepos, newRepo]);
  };

  const handleUpdateRepo = (index: number, field: keyof GitRepo, value: any) => {
    const updated = [...gitRepos];
    const prev = updated[index];
    if (field === 'path') {
      const nextPath = String(value);
      const nextDir = dirNameFromPath(nextPath);
      const keepAuto = isAutoRepoName(prev.name, prev.path);
      updated[index] = {
        ...prev,
        path: nextPath,
        name: keepAuto && nextDir ? nextDir : prev.name,
      };
    } else {
      updated[index] = { ...prev, [field]: value };
    }
    setGitRepos(updated);
  };

  const handleRemoveRepo = (id: string) => {
    setGitRepos(gitRepos.filter((r) => r.id !== id));
  };

  const handleValidateRepo = async (idx: number) => {
    const path = gitRepos[idx]?.path?.trim();
    if (!path) {
      setRepoMsg(t.pathRequired);
      return;
    }
    setValidatingIdx(idx);
    setRepoMsg('');
    try {
      const res = await api.validateRepo(path);
      if (!res.ok) {
        setRepoMsg(res.error || t.invalidRepository);
        return;
      }
      const resolved = res.path || path;
      const prev = gitRepos[idx];
      const nextDir = dirNameFromPath(resolved);
      const updated = [...gitRepos];
      const branch = res.defaultBranch || res.currentBranch || prev.defaultBranch || 'main';
      updated[idx] = {
        ...prev,
        path: resolved,
        name: isAutoRepoName(prev.name, prev.path) && nextDir ? nextDir : prev.name || nextDir,
        defaultBranch: branch,
        filesCount: res.filesCount || 0,
      };
      setGitRepos(updated);
      let msg = `${t.validatedRepo}: ${res.path} (${res.filesCount || 0} ${t.filesLabel}, ${t.branchLabel} ${branch})`;
      if (res.hasCommits === false || res.warning) {
        msg += ` — ${lang === 'zh' ? '仓库还没有提交，启动自动开发时会自动创建初始 commit' : res.warning || 'no commits yet; Auto-Dev will initialize'}`;
      }
      setRepoMsg(msg);
    } catch (err: any) {
      setRepoMsg(err.message || t.validationFailed);
    } finally {
      setValidatingIdx(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setRepoMsg('请输入项目名称');
      return;
    }

    onSave({
      id: existingProject?.id || `proj-${Date.now()}`,
      name: name.trim(),
      description: description.trim(),
      gitRepos,
      branchPrefixConfig,
      useCustomModelConfig,
      customModelConfig: {
        ...customModelConfig,
        // Empty draft keeps the server-side key (same as global LLM settings).
        openAIApiKey: apiKeyDraft.trim(),
      },
      createdAt: existingProject?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <div className={`w-full max-w-3xl border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${themeConfig.modalBg}`}>
        {/* Header */}
        <div className={`p-6 border-b flex items-center justify-between ${themeConfig.subtleBorder} ${themeConfig.modalHeaderBg}`}>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-500">
              <FolderPlus className="w-6 h-6" />
            </div>
            <div>
              <h2 className={`text-xl font-bold ${themeConfig.textPrimary}`}>
                {existingProject ? '编辑项目工程' : '创建新 Vibecoding 项目'}
              </h2>
              <p className={`text-xs mt-0.5 ${themeConfig.textSecondary}`}>
                项目是 Git 仓库群与 Issue 协同落地的顶层工作单元
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg transition-colors ${themeConfig.textSecondary} hover:${themeConfig.textPrimary} hover:bg-black/5 dark:hover:bg-white/10`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Header */}
        <div className={`flex border-b px-6 gap-6 text-xs font-medium ${themeConfig.subtleBorder} ${themeConfig.modalHeaderBg}`}>
          <button
            type="button"
            onClick={() => setActiveTab('basic')}
            className={`py-3 border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'basic'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-300 font-bold'
                : `border-transparent ${themeConfig.textSecondary} hover:${themeConfig.textPrimary}`
            }`}
          >
            <Code className="w-4 h-4" />
            基本信息
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('repos')}
            className={`py-3 border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'repos'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-300 font-bold'
                : `border-transparent ${themeConfig.textSecondary} hover:${themeConfig.textPrimary}`
            }`}
          >
            <GitBranch className="w-4 h-4" />
            关联 Git 仓库 ({gitRepos.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('branches')}
            className={`py-3 border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'branches'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-300 font-bold'
                : `border-transparent ${themeConfig.textSecondary} hover:${themeConfig.textPrimary}`
            }`}
          >
            <GitFork className="w-4 h-4" />
            分支前缀规范
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('llm')}
            className={`py-3 border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'llm'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-300 font-bold'
                : `border-transparent ${themeConfig.textSecondary} hover:${themeConfig.textPrimary}`
            }`}
          >
            <Globe className="w-4 h-4" />
            独立 OpenAPI 设置
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6 text-sm">
          {activeTab === 'basic' && (
            <div className="space-y-4">
              <div>
                <label className={`block text-xs font-semibold mb-1.5 ${themeConfig.textPrimary}`}>
                  项目名称 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如: 电商微服务架构重构"
                  className={`w-full px-3.5 py-2.5 border rounded-xl focus:outline-none transition-colors ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                />
              </div>

              <div>
                <label className={`block text-xs font-semibold mb-1.5 ${themeConfig.textPrimary}`}>
                  项目描述 / 架构定义
                </label>
                <textarea
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="简述项目业务目标、主技术栈以及自治开发约束规范..."
                  className={`w-full px-3.5 py-2.5 border rounded-xl focus:outline-none transition-colors text-xs leading-relaxed ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                />
              </div>
            </div>
          )}

          {activeTab === 'repos' && (
            <div className="space-y-4">
              <div
                className={`rounded-xl border px-3.5 py-3 flex gap-2.5 ${
                  isLight
                    ? 'bg-amber-50 border-amber-200/80 text-amber-950'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-100'
                }`}
              >
                <BookOpen className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-300" />
                <div className="min-w-0 space-y-1">
                  <div className="text-xs font-semibold">{t.agentsMdBannerTitle}</div>
                  <p className="text-[11px] leading-relaxed opacity-90">{t.agentsMdBannerBody}</p>
                  <p className={`text-[10px] font-mono ${isLight ? 'text-amber-800/80' : 'text-amber-200/80'}`}>
                    {'<repo>/AGENTS.md'}
                    <span className="mx-1.5 opacity-50">→</span>
                    {'CLAUDE.md'}
                    <span className="mx-1.5 opacity-50">+</span>
                    {'README.md'}
                  </p>
                </div>
              </div>
              <div className={`flex items-center justify-between pb-2 border-b ${themeConfig.subtleBorder}`}>
                <div>
                  <h3 className={`text-xs font-semibold ${themeConfig.textPrimary}`}>关联的本地 Git 代码工程列表</h3>
                  <p className={`text-[11px] ${themeConfig.textMuted}`}>
                    同一个项目下可关联多个本地磁盘 Git 目录路径，Auto-Dev Agent 将直接访问本地工程进行读取、代码修改与 Git 提交
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddRepo}
                  className="px-3 py-1.5 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 rounded-xl text-xs font-semibold text-indigo-700 dark:text-indigo-200 flex items-center gap-1.5 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  添加 Git 仓库
                </button>
              </div>

              <div className="space-y-3">
                {gitRepos.map((repo, idx) => (
                  <div
                    key={repo.id}
                    className={`p-4 rounded-xl border space-y-3 relative group ${themeConfig.cardBg} ${themeConfig.cardBorder}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 flex-1">
                        <FileCode className="w-4 h-4 text-indigo-500 shrink-0" />
                        <input
                          type="text"
                          value={repo.name}
                          onChange={(e) => handleUpdateRepo(idx, 'name', e.target.value)}
                          placeholder="默认取路径末级目录名，可手动修改"
                          className={`flex-1 px-2.5 py-1 border rounded text-xs font-semibold focus:border-indigo-500 ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveRepo(repo.id)}
                        className={`p-1.5 rounded transition-colors hover:text-rose-500 ${themeConfig.textMuted}`}
                        title="删除该仓库"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2">
                        <label className="block text-[10px] font-semibold text-indigo-600 dark:text-indigo-300 mb-1 flex items-center gap-1">
                          <span>本地 Git 代码目录路径 (Local Repository Path)</span>
                          <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={repo.path || ''}
                          onChange={(e) => handleUpdateRepo(idx, 'path', e.target.value)}
                          placeholder="例如: /Users/username/projects/web-frontend 或 C:\workspace\my-app"
                          className={`w-full px-2.5 py-1.5 border rounded text-xs font-mono focus:outline-none focus:border-indigo-500 ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                        />
                      </div>
                      <div>
                        <label className={`block text-[10px] mb-1 ${themeConfig.textMuted}`}>默认 Git 分支</label>
                        <input
                          type="text"
                          value={repo.defaultBranch}
                          onChange={(e) => handleUpdateRepo(idx, 'defaultBranch', e.target.value)}
                          className={`w-full px-2.5 py-1.5 border rounded text-xs font-mono focus:outline-none focus:border-indigo-500 ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                        />
                        <button
                          type="button"
                          onClick={() => handleValidateRepo(idx)}
                          className="mt-2 w-full px-2 py-1 text-[10px] rounded-lg border border-indigo-500/40 text-indigo-700 dark:text-indigo-200 flex items-center justify-center gap-1"
                        >
                          {validatingIdx === idx ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-3 h-3" />
                          )}
                          {t.validatePath}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className={`block text-[10px] mb-1 ${themeConfig.textMuted}`}>{t.setupCommandLabel}</label>
                      <input
                        type="text"
                        value={repo.setupCommand || ''}
                        onChange={(e) => handleUpdateRepo(idx, 'setupCommand', e.target.value)}
                        placeholder="npm install"
                        className={`w-full px-2.5 py-1.5 border rounded text-xs font-mono focus:outline-none focus:border-indigo-500 ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                      />
                      <p className={`text-[10px] mt-1 ${themeConfig.textMuted}`}>{t.setupCommandHint}</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className={`block text-[10px] mb-1 ${themeConfig.textMuted}`}>{t.testCommandLabel}</label>
                        <input
                          type="text"
                          value={repo.testCommand || ''}
                          onChange={(e) => handleUpdateRepo(idx, 'testCommand', e.target.value)}
                          placeholder="make test"
                          className={`w-full px-2.5 py-1.5 border rounded text-xs font-mono focus:outline-none focus:border-indigo-500 ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                        />
                        <p className={`text-[10px] mt-1 ${themeConfig.textMuted}`}>{t.testCommandHint}</p>
                      </div>
                      <div>
                        <label className={`block text-[10px] mb-1 ${themeConfig.textMuted}`}>{t.lintCommandLabel}</label>
                        <input
                          type="text"
                          value={repo.lintCommand || ''}
                          onChange={(e) => handleUpdateRepo(idx, 'lintCommand', e.target.value)}
                          placeholder="golangci-lint run"
                          className={`w-full px-2.5 py-1.5 border rounded text-xs font-mono focus:outline-none focus:border-indigo-500 ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                        />
                        <p className={`text-[10px] mt-1 ${themeConfig.textMuted}`}>{t.lintCommandHint}</p>
                      </div>
                    </div>
                  </div>
                ))}
                {repoMsg && (
                  <p
                    className={`text-xs select-text ${
                      repoMsg.includes(t.validatedRepo) || repoMsg.includes('Validated')
                        ? 'text-emerald-500'
                        : 'text-rose-400'
                    }`}
                  >
                    {repoMsg}
                  </p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'branches' && (
            <div className="space-y-5">
              <div className="p-4 rounded-xl border border-indigo-500/30 bg-indigo-500/10 flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xs font-bold text-indigo-800 dark:text-indigo-200 flex items-center gap-1.5">
                    <GitFork className="w-4 h-4 text-indigo-500" />
                    工程级 Git 分支前缀规范 (Branch Prefix Conventions)
                  </h3>
                  <p className={`text-[11px] mt-1 leading-relaxed ${themeConfig.textSecondary}`}>
                    为当前工程统一配置各个开发场景下的 Git 分支命名前缀。Auto-Dev Agent 自动排期改码、创建 Pull Request 和分支隔离时将强制遵循此约定。
                  </p>
                </div>
                {/* Presets */}
                <div className={`shrink-0 flex items-center gap-1 p-1.5 rounded-xl border ${themeConfig.inputBg} ${themeConfig.inputBorder}`}>
                  <span className={`text-[10px] px-1 font-mono ${themeConfig.textMuted}`}>快速预设:</span>
                  <button
                    type="button"
                    onClick={() =>
                      setBranchPrefixConfig({
                        featurePrefix: 'feature/',
                        bugfixPrefix: 'fix/',
                        hotfixPrefix: 'hotfix/',
                        refactorPrefix: 'refactor/',
                        autoDevPrefix: 'ai-dev/',
                        releasePrefix: 'release/',
                      })
                    }
                    className={`px-2 py-1 text-[10px] font-semibold rounded-lg border transition-colors ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText}`}
                    title="Git Flow 规范 (feature/, fix/, ai-dev/)"
                  >
                    Git Flow
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setBranchPrefixConfig({
                        featurePrefix: 'feat/',
                        bugfixPrefix: 'fix/',
                        hotfixPrefix: 'hotfix/',
                        refactorPrefix: 'refactor/',
                        autoDevPrefix: 'vibe-dev/',
                        releasePrefix: 'rel/',
                      })
                    }
                    className={`px-2 py-1 text-[10px] font-semibold rounded-lg border transition-colors ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText}`}
                    title="Conventional Commits 简短规范 (feat/, fix/, vibe-dev/)"
                  >
                    Conventional
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Feature Prefix */}
                <div className={`p-3.5 border rounded-xl space-y-2 ${themeConfig.cardBg} ${themeConfig.cardBorder}`}>
                  <div className="flex items-center justify-between">
                    <label className={`text-xs font-semibold ${themeConfig.textPrimary}`}>开发需求前缀 (Feature · 需求类型)</label>
                    <span className="text-[10px] font-mono text-indigo-700 dark:text-indigo-300 bg-indigo-500/20 px-1.5 py-0.5 rounded border border-indigo-500/30">
                      例: {branchPrefixConfig.featurePrefix || 'feature/'}issue-101
                    </span>
                  </div>
                  <input
                    type="text"
                    value={branchPrefixConfig.featurePrefix}
                    onChange={(e) => setBranchPrefixConfig({ ...branchPrefixConfig, featurePrefix: e.target.value })}
                    placeholder="例如: feature/ 或 feat/"
                    className={`w-full px-3 py-1.5 border rounded-lg text-xs font-mono focus:outline-none focus:border-indigo-500 ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                  />
                  <p className={`text-[10px] ${themeConfig.textMuted}`}>用于常规需求与新特性开发的 Git 分支</p>
                </div>

                {/* Bugfix Prefix */}
                <div className={`p-3.5 border rounded-xl space-y-2 ${themeConfig.cardBg} ${themeConfig.cardBorder}`}>
                  <div className="flex items-center justify-between">
                    <label className={`text-xs font-semibold ${themeConfig.textPrimary}`}>缺陷修复前缀 (Bugfix · 需求类型)</label>
                    <span className="text-[10px] font-mono text-indigo-700 dark:text-indigo-300 bg-indigo-500/20 px-1.5 py-0.5 rounded border border-indigo-500/30">
                      例: {branchPrefixConfig.bugfixPrefix || 'fix/'}issue-102
                    </span>
                  </div>
                  <input
                    type="text"
                    value={branchPrefixConfig.bugfixPrefix}
                    onChange={(e) => setBranchPrefixConfig({ ...branchPrefixConfig, bugfixPrefix: e.target.value })}
                    placeholder="例如: fix/ 或 bugfix/"
                    className={`w-full px-3 py-1.5 border rounded-lg text-xs font-mono focus:outline-none focus:border-indigo-500 ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                  />
                  <p className={`text-[10px] ${themeConfig.textMuted}`}>用于日常 Bug 修复与回归测试分支</p>
                </div>

                {/* AutoDev Prefix */}
                <div className="p-3.5 bg-indigo-500/10 border border-indigo-500/30 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-indigo-800 dark:text-indigo-200 flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                      AI 自治开发前缀 (Auto-Dev)
                    </label>
                    <span className="text-[10px] font-mono text-indigo-800 dark:text-indigo-300 bg-indigo-500/30 px-1.5 py-0.5 rounded border border-indigo-500/40">
                      例: {branchPrefixConfig.autoDevPrefix || 'ai-dev/'}issue-100
                    </span>
                  </div>
                  <input
                    type="text"
                    value={branchPrefixConfig.autoDevPrefix}
                    onChange={(e) => setBranchPrefixConfig({ ...branchPrefixConfig, autoDevPrefix: e.target.value })}
                    placeholder="例如: ai-dev/ 或 vibe-dev/"
                    className={`w-full px-3 py-1.5 border rounded-lg text-xs font-mono focus:outline-none focus:border-indigo-500 ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                  />
                  <p className="text-[10px] text-indigo-700 dark:text-indigo-300/80">VibeBot 启动自治开发改码时自动切换此分支</p>
                </div>

                {/* Hotfix Prefix */}
                <div className={`p-3.5 border rounded-xl space-y-2 ${themeConfig.cardBg} ${themeConfig.cardBorder}`}>
                  <div className="flex items-center justify-between">
                    <label className={`text-xs font-semibold ${themeConfig.textPrimary}`}>紧急修复前缀 (Hotfix · 需求类型)</label>
                    <span className="text-[10px] font-mono text-amber-800 dark:text-amber-300 bg-amber-500/20 px-1.5 py-0.5 rounded border border-amber-500/30">
                      例: {branchPrefixConfig.hotfixPrefix || 'hotfix/'}patch-v1.2
                    </span>
                  </div>
                  <input
                    type="text"
                    value={branchPrefixConfig.hotfixPrefix}
                    onChange={(e) => setBranchPrefixConfig({ ...branchPrefixConfig, hotfixPrefix: e.target.value })}
                    placeholder="例如: hotfix/"
                    className={`w-full px-3 py-1.5 border rounded-lg text-xs font-mono focus:outline-none focus:border-indigo-500 ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                  />
                  <p className={`text-[10px] ${themeConfig.textMuted}`}>生产环境突发故障的抢修补丁分支</p>
                </div>

                {/* Refactor Prefix */}
                <div className={`p-3.5 border rounded-xl space-y-2 ${themeConfig.cardBg} ${themeConfig.cardBorder}`}>
                  <div className="flex items-center justify-between">
                    <label className={`text-xs font-semibold ${themeConfig.textPrimary}`}>代码重构前缀 (Refactor)</label>
                    <span className="text-[10px] font-mono text-purple-800 dark:text-purple-300 bg-purple-500/20 px-1.5 py-0.5 rounded border border-purple-500/30">
                      例: {branchPrefixConfig.refactorPrefix || 'refactor/'}core-module
                    </span>
                  </div>
                  <input
                    type="text"
                    value={branchPrefixConfig.refactorPrefix}
                    onChange={(e) => setBranchPrefixConfig({ ...branchPrefixConfig, refactorPrefix: e.target.value })}
                    placeholder="例如: refactor/"
                    className={`w-full px-3 py-1.5 border rounded-lg text-xs font-mono focus:outline-none focus:border-indigo-500 ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                  />
                  <p className={`text-[10px] ${themeConfig.textMuted}`}>无改变外部行为的架构清理与性能优化分支</p>
                </div>

                {/* Release Prefix */}
                <div className={`p-3.5 border rounded-xl space-y-2 ${themeConfig.cardBg} ${themeConfig.cardBorder}`}>
                  <div className="flex items-center justify-between">
                    <label className={`text-xs font-semibold ${themeConfig.textPrimary}`}>版本发布前缀 (Release)</label>
                    <span className="text-[10px] font-mono text-emerald-800 dark:text-emerald-300 bg-emerald-500/20 px-1.5 py-0.5 rounded border border-emerald-500/30">
                      例: {branchPrefixConfig.releasePrefix || 'release/'}v2.0.0
                    </span>
                  </div>
                  <input
                    type="text"
                    value={branchPrefixConfig.releasePrefix}
                    onChange={(e) => setBranchPrefixConfig({ ...branchPrefixConfig, releasePrefix: e.target.value })}
                    placeholder="例如: release/ 或 rel/"
                    className={`w-full px-3 py-1.5 border rounded-lg text-xs font-mono focus:outline-none focus:border-indigo-500 ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                  />
                  <p className={`text-[10px] ${themeConfig.textMuted}`}>里程碑版本预封包与发布测试分支</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'llm' && (
            <div className="space-y-5">
              <div className={`p-4 rounded-xl border flex items-center justify-between ${themeConfig.cardBg} ${themeConfig.cardBorder}`}>
                <div>
                  <h3 className={`text-xs font-semibold ${themeConfig.textPrimary}`}>使用项目自定义 OpenAPI 配置</h3>
                  <p className={`text-[11px] ${themeConfig.textMuted}`}>
                    关闭时将继承系统全局 LLM 大模型配置；开启后本项目将优先使用下方指定的 OpenAPI 端点。
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useCustomModelConfig}
                    onChange={(e) => setUseCustomModelConfig(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 dark:bg-black/40 border border-slate-300 dark:border-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>

              {useCustomModelConfig && (
                <div className="space-y-4 p-4 rounded-xl border border-indigo-500/30 bg-indigo-500/10">
                  <div className="flex items-center gap-2 text-indigo-800 dark:text-indigo-300 font-medium">
                    <Settings2 className="w-4 h-4 text-indigo-500" />
                    <span>项目专属 OpenAPI 设置</span>
                  </div>

                  <div>
                    <label className={`block text-xs font-medium mb-1 ${themeConfig.textPrimary}`}>{t.baseUrlLabel}</label>
                    <input
                      type="text"
                      value={customModelConfig.openAIBaseUrl}
                      onChange={(e) =>
                        setCustomModelConfig({ ...customModelConfig, openAIBaseUrl: e.target.value })
                      }
                      placeholder="http://llm-gw.jd.local/v1/chat/completions"
                      className={`w-full px-3 py-2 border rounded-lg text-xs font-mono ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                    />
                    <p className={`text-[11px] mt-1 ${themeConfig.textMuted}`}>{t.baseUrlHint}</p>
                  </div>

                  <div>
                    <label className={`block text-xs font-medium mb-1 ${themeConfig.textPrimary}`}>{t.apiProtocolLabel}</label>
                    <ThemedSelect
                      value={customModelConfig.apiProtocol || 'chat_completions'}
                      onChange={(e) =>
                        setCustomModelConfig({
                          ...customModelConfig,
                          apiProtocol: e.target.value as 'chat_completions' | 'responses',
                        })
                      }
                      isLight={isLight}
                      chevronClassName={themeConfig.textSecondary}
                      className={`w-full px-3 py-2 border rounded-lg text-xs ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                    >
                      <option value="chat_completions">Chat Completions</option>
                      <option value="responses">Responses</option>
                    </ThemedSelect>
                    <p className={`text-[11px] mt-1 ${themeConfig.textMuted}`}>{t.apiProtocolHint}</p>
                  </div>

                  <div>
                    <label className={`block text-xs font-medium mb-1 ${themeConfig.textPrimary}`}>{t.apiKeyLabel}</label>
                    <input
                      type="password"
                      value={apiKeyDraft}
                      onChange={(e) => setApiKeyDraft(e.target.value)}
                      placeholder={
                        keyAlreadyConfigured
                          ? t.keyConfiguredKeep.replace(
                              '{hint}',
                              existingProject?.customModelConfig?.keyHint || '****'
                            )
                          : t.keyPlaceholderServer
                      }
                      className={`w-full px-3 py-2 border rounded-lg text-xs font-mono ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                      autoComplete="new-password"
                    />
                    {keyAlreadyConfigured && (
                      <p className="text-[11px] mt-1 text-emerald-600 dark:text-emerald-300">
                        {t.keyStoredHint.replace(
                          '{hint}',
                          existingProject?.customModelConfig?.keyHint || '****'
                        )}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className={`block text-xs font-medium mb-1 ${themeConfig.textPrimary}`}>{t.modelNameLabel}</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        list="project-model-options"
                        value={customModelConfig.openAIModel}
                        onChange={(e) =>
                          setCustomModelConfig({ ...customModelConfig, openAIModel: e.target.value })
                        }
                        className={`flex-1 min-w-0 px-3 py-2 border rounded-lg text-xs font-mono ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                      />
                      <datalist id="project-model-options">
                        {availableModels.map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                      <button
                        type="button"
                        onClick={handleFetchModels}
                        disabled={
                          fetchingModels ||
                          !customModelConfig.openAIBaseUrl.trim() ||
                          (!apiKeyDraft.trim() && !keyAlreadyConfigured)
                        }
                        title={t.fetchModelsBtn}
                        className="shrink-0 px-3 py-2 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 rounded-lg text-xs font-semibold text-indigo-800 dark:text-indigo-200 flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        {fetchingModels ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5 text-indigo-500" />
                        )}
                        <span className="hidden sm:inline">{fetchingModels ? t.fetchModelsRunning : t.fetchModelsBtn}</span>
                      </button>
                    </div>
                    {modelsMsg && (
                      <p className={`text-[11px] mt-1 break-all ${availableModels.length > 0 ? 'text-emerald-600 dark:text-emerald-300' : themeConfig.textMuted}`}>
                        {modelsMsg}
                      </p>
                    )}
                  </div>

                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={handleTestProjectLLM}
                      disabled={
                        testingLLM ||
                        !customModelConfig.openAIBaseUrl.trim() ||
                        (!apiKeyDraft.trim() && !keyAlreadyConfigured)
                      }
                      className="px-4 py-2 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 rounded-xl text-xs font-semibold text-indigo-800 dark:text-indigo-200 flex items-center gap-2 transition-colors disabled:opacity-50"
                    >
                      {testingLLM ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                          {t.testOpenAPIRunning}
                        </>
                      ) : (
                        <>
                          <Sliders className="w-3.5 h-3.5 text-indigo-500" />
                          {t.testOpenAPI}
                        </>
                      )}
                    </button>
                    {llmTestResult && (
                      <div
                        className={`mt-3 p-3 rounded-xl border text-xs flex items-start gap-2 ${
                          llmTestResult.success
                            ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-800 dark:text-emerald-200'
                            : 'bg-rose-500/20 border-rose-500/30 text-rose-800 dark:text-rose-200'
                        }`}
                      >
                        {llmTestResult.success ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                        )}
                        <div className="break-all select-text">{llmTestResult.message}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Footer Submit */}
          <div className={`pt-4 border-t flex items-center justify-end gap-3 ${themeConfig.subtleBorder}`}>
            <button
              type="button"
              onClick={onClose}
              className={`px-4 py-2 rounded-xl text-xs font-medium border transition-colors ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText}`}
            >
              取消
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md transition-all"
            >
              保存项目
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

