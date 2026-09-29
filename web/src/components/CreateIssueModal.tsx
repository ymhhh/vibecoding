import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Issue, IssueAttachment, GitRepo, Priority, IssueStatus, IssueKind, BranchPrefixConfig } from '../types';
import { Language, ThemeStyle, getTranslation } from '../lib/i18n';
import { THEME_CONFIGS } from '../lib/theme';
import {
  filesToAttachments,
  formatFileSize,
  MAX_ISSUE_ATTACHMENTS,
} from '../lib/attachments';
import { pickAttachmentFiles } from '../lib/pickfiles';
import { branchNameForIssue, normalizeIssueKind } from '../lib/issueKind';
import { ThemedSelect } from './ThemedSelect';
import { AttachmentPreview } from './AttachmentPreview';
import {
  X,
  PlusCircle,
  GitBranch,
  AlertCircle,
  Sparkles,
  Check,
  Repeat,
  Paperclip,
  FileText,
  Image as ImageIcon,
  File,
  Maximize2,
  Minimize2,
  Upload,
  Eye,
} from 'lucide-react';

interface CreateIssueModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  gitRepos: GitRepo[];
  branchPrefixConfig?: BranchPrefixConfig;
  onCreate: (issue: Partial<Issue>) => void;
  lang?: Language;
  themeStyle?: ThemeStyle;
}

export const CreateIssueModal: React.FC<CreateIssueModalProps> = ({
  isOpen,
  onClose,
  projectId,
  gitRepos,
  branchPrefixConfig,
  onCreate,
  lang = 'en',
  themeStyle = 'light',
}) => {
  const t = getTranslation(lang);
  const themeConfig = THEME_CONFIGS[themeStyle] || THEME_CONFIGS.light;
  const isLight = themeConfig.isLight;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [kind, setKind] = useState<IssueKind>('feature');
  const [status, setStatus] = useState<IssueStatus>('requirements');
  const [selectedRepoIds, setSelectedRepoIds] = useState<string[]>(
    gitRepos.map((r) => r.id)
  );
  const [assignee, setAssignee] = useState(
    lang === 'zh' ? t.defaultAssignee : 'AI Auto-Dev Agent'
  );
  const [keepOpenAfterCreate, setKeepOpenAfterCreate] = useState(false);
  const [createdCount, setCreatedCount] = useState(0);
  const [attachments, setAttachments] = useState<IssueAttachment[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [attachErrors, setAttachErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [maximized, setMaximized] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const descRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isOpen) setMaximized(false);
  }, [isOpen]);

  const addFiles = useCallback(
    async (fileList: File[] | FileList) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;
      const { attachments: next, errors } = await filesToAttachments(files, attachments, lang);
      setAttachments(next);
      setAttachErrors(errors);
    },
    [attachments, lang]
  );

  const browseFiles = useCallback(async () => {
    try {
      const picked = await pickAttachmentFiles();
      if (picked.mode === 'browser') {
        fileInputRef.current?.click();
        return;
      }
      if (picked.files.length) void addFiles(picked.files);
    } catch (err: unknown) {
      setAttachErrors([err instanceof Error ? err.message : String(err)]);
    }
  }, [addFiles]);

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const toggleRepoSelection = (repoId: string) => {
    if (selectedRepoIds.includes(repoId)) {
      if (selectedRepoIds.length <= 1) {
        alert(t.createIssueNeedOneRepo);
        return;
      }
      setSelectedRepoIds(selectedRepoIds.filter((id) => id !== repoId));
    } else {
      setSelectedRepoIds([...selectedRepoIds, repoId]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      alert(t.createIssueNeedTitle);
      return;
    }
    if (selectedRepoIds.length === 0) {
      alert(t.createIssueNeedRepo);
      return;
    }

    const newIssue: Partial<Issue> = {
      id: `ISSUE-${Date.now().toString().slice(-4)}`,
      projectId,
      title: title.trim(),
      description: description.trim() || (lang === 'zh' ? '暂无详细描述信息' : 'No description provided.'),
      attachments: attachments.length ? attachments : undefined,
      status,
      priority,
      kind: normalizeIssueKind(kind),
      assignee,
      associatedRepoIds: selectedRepoIds,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      autoDevProgress: status === 'in_progress' ? 15 : 0,
      chatMessages: [
        {
          id: `msg-${Date.now()}`,
          sender: 'system',
          text:
            lang === 'zh'
              ? `系统提示: Issue 已成功创建，关联仓库: ${selectedRepoIds.map((id) => gitRepos.find((r) => r.id === id)?.name).join(', ')}。可在此对话框输入需求细节，并随时按 [提炼 Dev Spec] 生成规范文档。`
              : `System: Issue created and linked to repo(s): ${selectedRepoIds.map((id) => gitRepos.find((r) => r.id === id)?.name).join(', ')}. Detail your requirement here and click [Extract Dev Spec] anytime.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ],
      autoDevLogs: [
        {
          id: `log-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          phase: 'analyzing',
          message: t.issueInitLog.replace('{status}', status),
        },
      ],
    };

    onCreate(newIssue);
    setCreatedCount((prev) => prev + 1);

    if (keepOpenAfterCreate) {
      setTitle('');
      setDescription('');
      setAttachments([]);
      setAttachErrors([]);
      setKind('feature');
    } else {
      onClose();
    }
  };

  const statusOptions: { id: IssueStatus; label: string; badgeStyle: string }[] = [
    {
      id: 'requirements',
      label: lang === 'zh' ? '需求列表' : 'Requirements',
      badgeStyle: isLight
        ? 'bg-cyan-100 text-cyan-900 border-cyan-300'
        : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    },
  ];

  if (!isOpen) return null;

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    if (e.dataTransfer.types.includes('Files')) setDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const onDropFiles = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragging(false);
    if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md ${
        maximized ? 'p-0' : 'p-4 sm:p-6'
      }`}
    >
      <div
        className={`border shadow-2xl overflow-hidden flex flex-col ${themeConfig.modalBg} ${
          maximized
            ? 'w-full h-full max-w-none max-h-none rounded-none'
            : 'w-full max-w-5xl max-h-[92vh] rounded-3xl'
        }`}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDropFiles}
      >
        <div className={`px-7 py-5 border-b flex items-center justify-between ${themeConfig.subtleBorder} ${themeConfig.modalHeaderBg}`}>
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="p-3 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-500">
              <PlusCircle className="w-7 h-7" />
            </div>
            <div className="min-w-0">
              <h2 className={`text-2xl font-bold flex items-center gap-2 flex-wrap ${themeConfig.textPrimary}`}>
                {t.createIssueTitle}
                {createdCount > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30 font-normal">
                    {t.createIssueBatchBadge.replace('{n}', String(createdCount))}
                  </span>
                )}
              </h2>
              <p className={`text-sm mt-1 ${themeConfig.textSecondary}`}>{t.createIssueHint}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setMaximized((v) => !v)}
              className={`p-2 rounded-xl transition-colors ${themeConfig.textSecondary} hover:${themeConfig.textPrimary} hover:bg-black/5 dark:hover:bg-white/10`}
              title={maximized ? 'Restore' : 'Maximize'}
            >
              {maximized ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className={`p-2 rounded-xl transition-colors ${themeConfig.textSecondary} hover:${themeConfig.textPrimary} hover:bg-black/5 dark:hover:bg-white/10`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 px-7 py-6">
              <div className="lg:col-span-3 space-y-5">
                <div>
                  <label className={`block text-sm font-semibold mb-2 ${themeConfig.textPrimary}`}>
                    Issue {lang === 'zh' ? '标题' : 'title'} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t.createIssueTitlePlaceholder}
                    className={`w-full px-4 py-3 text-base border rounded-2xl focus:outline-none transition-colors ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                  />
                </div>

                <div>
                  <div className="flex items-end justify-between gap-3 mb-2">
                    <label className={`block text-sm font-semibold ${themeConfig.textPrimary}`}>
                      {t.createIssueDesc}
                    </label>
                    <span className={`text-[11px] ${themeConfig.textMuted}`}>
                      {description.trim().length} {lang === 'zh' ? '字' : 'chars'}
                    </span>
                  </div>
                  <p className={`text-xs mb-2 ${themeConfig.textMuted}`}>{t.createIssueDescHint}</p>
                  <div className="relative">
                    <textarea
                      ref={descRef}
                      rows={maximized ? 18 : 12}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      onPaste={onPaste}
                      placeholder={t.createIssueDescPlaceholder}
                      className={`w-full min-h-[280px] px-4 py-3.5 border rounded-2xl focus:outline-none transition-colors text-sm leading-relaxed resize-y ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                    />
                    {dragging && (
                      <div className="absolute inset-0 rounded-2xl border-2 border-dashed border-indigo-400 bg-indigo-500/15 flex items-center justify-center pointer-events-none">
                        <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-200 font-semibold text-sm">
                          <Upload className="w-5 h-5" />
                          {t.createIssueAttachDrop}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className={`block text-sm font-semibold mb-2 flex items-center justify-between ${themeConfig.textPrimary}`}>
                    <span className="flex items-center gap-1.5">
                      <Paperclip className="w-4 h-4 text-indigo-500" />
                      {t.createIssueAttach}
                    </span>
                    <span className={`text-[11px] font-normal ${themeConfig.textMuted}`}>
                      {attachments.length}/{MAX_ISSUE_ATTACHMENTS}
                    </span>
                  </label>
                  <p className={`text-xs mb-2 ${themeConfig.textMuted}`}>{t.createIssueAttachHint}</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) void addFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void browseFiles()}
                    className={`w-full px-4 py-4 rounded-2xl border border-dashed text-sm flex items-center justify-center gap-2 transition-colors ${themeConfig.inputBg} ${themeConfig.inputBorder} ${themeConfig.textSecondary} hover:border-indigo-400 hover:text-indigo-500`}
                  >
                    <Upload className="w-4 h-4" />
                    {t.createIssueAttachDrop}
                  </button>

                  {attachErrors.length > 0 && (
                    <div className="mt-2 text-xs text-rose-500 space-y-0.5">
                      {attachErrors.map((err) => (
                        <div key={err}>{err}</div>
                      ))}
                    </div>
                  )}

                  {attachments.length > 0 && (
                    <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {attachments.map((att) => (
                        <li
                          key={att.id}
                          className={`flex items-center gap-1 px-2 py-1.5 rounded-xl border ${themeConfig.inputBg} ${themeConfig.inputBorder}`}
                        >
                          <button
                            type="button"
                            onClick={() => setPreviewId(att.id)}
                            title={t.attachmentPreview}
                            className="flex items-center gap-2.5 min-w-0 flex-1 px-1 py-0.5 text-left rounded-lg hover:bg-indigo-500/10 transition-colors"
                          >
                            {att.kind === 'image' && att.dataUrl ? (
                              <img src={att.dataUrl} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />
                            ) : att.kind === 'text' ? (
                              <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
                            ) : att.kind === 'image' ? (
                              <ImageIcon className="w-4 h-4 text-purple-400 shrink-0" />
                            ) : (
                              <File className="w-4 h-4 text-slate-400 shrink-0" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className={`text-xs font-medium truncate ${themeConfig.textPrimary}`}>{att.name}</div>
                              <div className={`text-[10px] ${themeConfig.textMuted}`}>
                                {formatFileSize(att.size)}
                                {att.kind === 'text' ? (lang === 'zh' ? ' · 将写入需求上下文' : ' · included in spec context') : ''}
                                {att.kind === 'file' ? (lang === 'zh' ? ' · 无法解析文本' : ' · binary, name only') : ''}
                                {' · '}
                                {t.attachmentPreview}
                              </div>
                            </div>
                            <Eye className={`w-3.5 h-3.5 shrink-0 ${themeConfig.textMuted}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeAttachment(att.id)}
                            className={`p-1 rounded-lg ${themeConfig.textMuted} hover:text-rose-500`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="lg:col-span-2 space-y-5">
                <div>
                  <label className={`block text-sm font-semibold mb-2 ${themeConfig.textPrimary}`}>
                    {t.createIssueStatus}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {statusOptions.map((opt) => {
                      const isSelected = status === opt.id;
                      return (
                        <button
                          type="button"
                          key={opt.id}
                          onClick={() => setStatus(opt.id)}
                          className={`px-3 py-2.5 rounded-xl text-sm font-medium border flex items-center justify-between transition-all ${
                            isSelected
                              ? `${opt.badgeStyle} ring-1 ring-indigo-500/50 shadow-md font-bold`
                              : `${themeConfig.inputBg} ${themeConfig.inputBorder} ${themeConfig.textSecondary}`
                          }`}
                        >
                          <span className="truncate">{opt.label}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className={`block text-sm font-semibold mb-2 ${themeConfig.textPrimary}`}>
                    {t.createIssuePriority}
                  </label>
                  <ThemedSelect
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as Priority)}
                    isLight={isLight}
                    chevronClassName={themeConfig.textSecondary}
                    className={`px-3.5 py-2.5 border rounded-xl focus:outline-none text-sm ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                  >
                    <option value="low">{lang === 'zh' ? '低 (Low)' : 'Low'}</option>
                    <option value="medium">{lang === 'zh' ? '中 (Medium)' : 'Medium'}</option>
                    <option value="high">{lang === 'zh' ? '高 (High)' : 'High'}</option>
                    <option value="urgent">{lang === 'zh' ? '紧急 (Urgent)' : 'Urgent'}</option>
                  </ThemedSelect>
                </div>

                <div>
                  <label className={`block text-sm font-semibold mb-2 ${themeConfig.textPrimary}`}>
                    {t.createIssueKind}
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    {(
                      [
                        { id: 'feature' as IssueKind, label: t.issueKindFeature },
                        { id: 'bugfix' as IssueKind, label: t.issueKindBugfix },
                        { id: 'hotfix' as IssueKind, label: t.issueKindHotfix },
                      ] as const
                    ).map((opt) => {
                      const selected = kind === opt.id;
                      return (
                        <button
                          type="button"
                          key={opt.id}
                          onClick={() => setKind(opt.id)}
                          className={`px-3 py-2 rounded-xl text-sm font-medium border flex items-center justify-between transition-all ${
                            selected
                              ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-800 dark:text-indigo-200 ring-1 ring-indigo-500/40 font-bold'
                              : `${themeConfig.inputBg} ${themeConfig.inputBorder} ${themeConfig.textSecondary}`
                          }`}
                        >
                          <span>{opt.label}</span>
                          {selected && <Check className="w-3.5 h-3.5 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                  <p className={`mt-1.5 text-[11px] ${themeConfig.textMuted}`}>{t.createIssueKindHint}</p>
                  <div
                    className={`mt-2 flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1.5 rounded-lg border ${themeConfig.inputBg} ${themeConfig.inputBorder} ${themeConfig.textSecondary}`}
                  >
                    <GitBranch className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                    <span className={`shrink-0 ${themeConfig.textMuted}`}>{t.createIssueBranchPreview}:</span>
                    <span className="truncate">
                      {branchNameForIssue(branchPrefixConfig, {
                        id: 'ISSUE-preview',
                        kind,
                      })}
                    </span>
                  </div>
                </div>

                <div>
                  <label className={`block text-sm font-semibold mb-2 ${themeConfig.textPrimary}`}>
                    {t.createIssueAssignee}
                  </label>
                  <input
                    type="text"
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                    placeholder={
                      lang === 'zh' ? 'AI 自治开发 Agent / 开发人员姓名' : 'AI Auto-Dev Agent / developer name'
                    }
                    className={`w-full px-3.5 py-2.5 border rounded-xl focus:outline-none text-sm ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                  />
                </div>

                <div>
                  <label className={`block text-sm font-semibold mb-2 flex items-center justify-between ${themeConfig.textPrimary}`}>
                    <span className="flex items-center gap-1.5">
                      <GitBranch className="w-4 h-4 text-indigo-500" />
                      {t.createIssueRepos} <span className="text-rose-500">*</span>
                    </span>
                    <span className={`text-[11px] font-normal ${themeConfig.textMuted}`}>
                      {t.createIssueReposPicked.replace('{n}', String(selectedRepoIds.length))}
                    </span>
                  </label>

                  {gitRepos.length === 0 ? (
                    <div className="p-3 bg-rose-500/20 border border-rose-500/30 rounded-xl text-xs text-rose-700 dark:text-rose-200 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-500" />
                      {t.createIssueNoRepos}
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5">
                      {gitRepos.map((repo) => {
                        const isChecked = selectedRepoIds.includes(repo.id);
                        return (
                          <div
                            key={repo.id}
                            onClick={() => toggleRepoSelection(repo.id)}
                            className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between transition-all ${
                              isChecked
                                ? 'border-indigo-500 bg-indigo-500/15 text-indigo-900 dark:text-indigo-200 font-semibold'
                                : `${themeConfig.inputBg} ${themeConfig.inputBorder} ${themeConfig.textSecondary}`
                            }`}
                          >
                            <div className="overflow-hidden pr-2">
                              <div className={`font-semibold text-sm truncate ${themeConfig.textPrimary}`}>
                                {repo.name}
                              </div>
                              <div className={`text-[11px] truncate font-mono mt-0.5 ${themeConfig.textMuted}`} title={repo.path}>
                                {repo.path || repo.url || (lang === 'zh' ? '未设置本地路径' : 'No local path')}
                              </div>
                            </div>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              className="rounded border-slate-300 bg-slate-100 text-indigo-600 focus:ring-indigo-500"
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className={`px-7 py-4 border-t flex items-center justify-between gap-3 ${themeConfig.subtleBorder} ${themeConfig.modalHeaderBg}`}>
            <label className={`flex items-center gap-2 text-xs cursor-pointer select-none ${themeConfig.textSecondary}`}>
              <input
                type="checkbox"
                checked={keepOpenAfterCreate}
                onChange={(e) => setKeepOpenAfterCreate(e.target.checked)}
                className="rounded border-slate-300 bg-slate-100 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="flex items-center gap-1">
                <Repeat className="w-3.5 h-3.5 text-indigo-500" />
                {t.createIssueKeepOpen}
              </span>
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className={`px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText}`}
              >
                {t.createIssueCancel}
              </button>
              <button
                type="submit"
                className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md transition-all flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                {t.createIssueSubmit} ({t.createIssueSubmitPool})
              </button>
            </div>
          </div>
        </form>
      </div>
      <AttachmentPreview
        attachments={attachments}
        activeId={previewId}
        onClose={() => setPreviewId(null)}
        lang={lang}
        themeStyle={themeStyle}
      />
    </div>
  );
};
