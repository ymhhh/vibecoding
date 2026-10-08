import React, { useEffect, useRef, useState } from 'react';
import { Issue, IssueAttachment } from '../../types';
import { Language, ThemeStyle, getTranslation } from '../../lib/i18n';
import { THEME_CONFIGS } from '../../lib/theme';
import {
  filesToAttachments,
  formatFileSize,
  isPdfAttachment,
  MAX_ISSUE_ATTACHMENTS,
} from '../../lib/attachments';
import { pickAttachmentFiles } from '../../lib/pickfiles';
import { AttachmentPreview } from '../AttachmentPreview';
import { ChevronDown, ChevronUp, Eye, File, FileText, Image as ImageIcon, Pencil, Upload, X } from 'lucide-react';

interface IssueBriefBarProps {
  issue: Issue;
  canEdit: boolean;
  onUpdateIssue: (updatedIssue: Issue) => void;
  lang: Language;
  themeStyle: ThemeStyle;
}

export const IssueBriefBar: React.FC<IssueBriefBarProps> = ({
  issue,
  canEdit,
  onUpdateIssue,
  lang,
  themeStyle,
}) => {
  const themeConfig = THEME_CONFIGS[themeStyle] || THEME_CONFIGS.light;
  const t = getTranslation(lang);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(issue.title);
  const [description, setDescription] = useState(issue.description || '');
  const [attachments, setAttachments] = useState<IssueAttachment[]>(issue.attachments || []);
  const [errors, setErrors] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditing(false);
    setExpanded(false);
    setTitle(issue.title);
    setDescription(issue.description || '');
    setAttachments(issue.attachments || []);
    setErrors([]);
    setPreviewId(null);
  }, [issue.id]);

  const startEdit = () => {
    setTitle(issue.title);
    setDescription(issue.description || '');
    setAttachments(issue.attachments || []);
    setErrors([]);
    setEditing(true);
    setExpanded(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setExpanded(false);
    setErrors([]);
    setTitle(issue.title);
    setDescription(issue.description || '');
    setAttachments(issue.attachments || []);
  };

  const addFiles = async (fileList: File[] | FileList) => {
    const files = Array.from(fileList);
    if (!files.length) return;
    const { attachments: next, errors: nextErrors } = await filesToAttachments(files, attachments, lang);
    setAttachments(next);
    setErrors(nextErrors);
  };

  const browseFiles = async () => {
    try {
      const picked = await pickAttachmentFiles();
      if (picked.mode === 'browser') {
        fileInputRef.current?.click();
        return;
      }
      if (picked.files.length) void addFiles(picked.files);
    } catch (err: unknown) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    }
  };

  const save = () => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      setErrors([t.createIssueNeedTitle]);
      return;
    }
    onUpdateIssue({
      ...issue,
      title: nextTitle,
      description: description.trim(),
      attachments: attachments.length ? attachments : undefined,
      updatedAt: new Date().toISOString(),
    });
    setEditing(false);
    setExpanded(false);
    setErrors([]);
  };

  const shown = editing ? attachments : issue.attachments || [];
  const body = editing ? description : issue.description || '';
  const summary = (issue.description || '').replace(/\s+/g, ' ').trim();
  const hasDocs = !!(issue.reqDoc?.rawMarkdown?.trim() || issue.devSpec?.rawMarkdown?.trim());
  const collapsedChips = shown.slice(0, 3);
  const hiddenChipCount = Math.max(0, shown.length - collapsedChips.length);

  return (
    <div className={`px-5 border-b ${expanded || editing ? 'py-2' : 'py-1.5'} ${themeConfig.subtleBorder} ${themeConfig.modalHeaderBg}`}>
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={() => !editing && setExpanded((v) => !v)}
          className="shrink-0 flex items-center gap-1.5 text-left"
        >
          <FileText className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
          <span className={`text-[10px] uppercase tracking-wider font-bold ${themeConfig.textMuted}`}>{t.issueBrief}</span>
        </button>
        {!expanded && !editing && (
          <>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className={`min-w-0 flex-1 truncate text-left text-xs ${themeConfig.textSecondary}`}
              title={summary || t.issueBriefEmpty}
            >
              {summary || t.issueBriefEmpty}
            </button>
            {collapsedChips.length > 0 && (
              <div className="flex items-center gap-1 shrink-0 max-w-[46%]">
                {collapsedChips.map((att) => (
                  <button
                    key={att.id}
                    type="button"
                    onClick={() => setPreviewId(att.id)}
                    title={t.attachmentPreview}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] max-w-[132px] ${themeConfig.inputBg} ${themeConfig.inputBorder} ${themeConfig.textSecondary}`}
                  >
                    {att.kind === 'image' && att.dataUrl ? (
                      <img src={att.dataUrl} alt="" className="w-4 h-4 rounded object-cover shrink-0" />
                    ) : isPdfAttachment(att) ? (
                      <FileText className="w-3 h-3 text-rose-400 shrink-0" />
                    ) : (
                      <FileText className="w-3 h-3 text-indigo-400 shrink-0" />
                    )}
                    <span className="truncate">{att.name}</span>
                  </button>
                ))}
                {hiddenChipCount > 0 && (
                  <span className={`text-[10px] shrink-0 ${themeConfig.textMuted}`}>+{hiddenChipCount}</span>
                )}
              </div>
            )}
          </>
        )}
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          {canEdit && !editing && (
            <button
              type="button"
              onClick={startEdit}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border flex items-center gap-1 ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText}`}
            >
              <Pencil className="w-3 h-3" />
              {t.issueBriefEdit}
            </button>
          )}
          {!canEdit && (
            <span className={`text-[10px] ${themeConfig.textMuted}`}>{t.issueBriefLocked}</span>
          )}
          {!editing && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className={`p-1 rounded-lg ${themeConfig.textMuted}`}
              aria-label={expanded ? t.issueBriefCollapse : t.issueBriefExpand}
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {(expanded || editing) && (
        <div className="mt-2 space-y-2">
          {editing ? (
            <>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t.createIssueTitlePlaceholder}
                className={`w-full px-3 py-2 border rounded-xl text-sm focus:outline-none ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onPaste={(e) => {
                  const files = e.clipboardData?.files;
                  if (files?.length) {
                    e.preventDefault();
                    void addFiles(files);
                  }
                }}
                rows={4}
                placeholder={t.createIssueDescPlaceholder}
                className={`w-full px-3 py-2 border rounded-xl text-sm leading-relaxed resize-y focus:outline-none ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
              />
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[11px] ${themeConfig.textMuted}`}>
                  {t.createIssueAttach} {attachments.length}/{MAX_ISSUE_ATTACHMENTS}
                </span>
                <button
                  type="button"
                  onClick={() => void browseFiles()}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border flex items-center gap-1 ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText}`}
                >
                  <Upload className="w-3 h-3" />
                  {t.createIssueAttachBrowse}
                </button>
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
              </div>
            </>
          ) : (
            <div className={`text-[12px] leading-relaxed whitespace-pre-wrap max-h-24 overflow-y-auto ${themeConfig.textSecondary}`}>
              {body.trim() || t.issueBriefEmpty}
            </div>
          )}

          {shown.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {shown.map((att) => (
                <div
                  key={att.id}
                  className={`flex items-center gap-1 rounded-lg border text-[11px] ${themeConfig.inputBg} ${themeConfig.inputBorder}`}
                >
                  <button
                    type="button"
                    onClick={() => setPreviewId(att.id)}
                    title={t.attachmentPreview}
                    className={`flex items-center gap-2 px-2.5 py-1.5 text-left ${themeConfig.textSecondary}`}
                  >
                    {att.kind === 'image' && att.dataUrl ? (
                      <img src={att.dataUrl} alt="" className="w-7 h-7 rounded-md object-cover" />
                    ) : att.kind === 'text' ? (
                      <FileText className="w-3.5 h-3.5 text-indigo-400" />
                    ) : att.kind === 'image' ? (
                      <ImageIcon className="w-3.5 h-3.5 text-purple-400" />
                    ) : isPdfAttachment(att) ? (
                      <FileText className="w-3.5 h-3.5 text-rose-400" />
                    ) : (
                      <File className="w-3.5 h-3.5 text-slate-400" />
                    )}
                    <span className="max-w-[160px] truncate">{att.name}</span>
                    <span className={themeConfig.textMuted}>{formatFileSize(att.size)}</span>
                    <Eye className={`w-3 h-3 shrink-0 ${themeConfig.textMuted}`} />
                  </button>
                  {editing && (
                    <button
                      type="button"
                      onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                      className={`pr-2 ${themeConfig.textMuted} hover:text-rose-500`}
                      aria-label={lang === 'zh' ? '移除' : 'Remove'}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {errors.length > 0 && (
            <div className="text-xs text-rose-500 space-y-0.5">
              {errors.map((err) => (
                <div key={err}>{err}</div>
              ))}
            </div>
          )}

          {editing && (
            <div className="flex items-center justify-between gap-3">
              <p className={`text-[10px] leading-snug ${themeConfig.textMuted}`}>
                {hasDocs ? t.issueBriefStaleNote : t.issueBriefHint}
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={cancelEdit}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText}`}
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  onClick={save}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white bg-indigo-600 hover:bg-indigo-500"
                >
                  {t.issueBriefSave}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <AttachmentPreview
        attachments={shown}
        activeId={previewId}
        onClose={() => setPreviewId(null)}
        lang={lang}
        themeStyle={themeStyle}
        onRepairAttachment={(next) => {
          const merged = attachments.map((a) => (a.id === next.id ? next : a));
          setAttachments(merged);
          if (!canEdit) return;
          if (editing) return;
          onUpdateIssue({
            ...issue,
            attachments: merged.length ? merged : undefined,
            updatedAt: new Date().toISOString(),
          });
        }}
      />
    </div>
  );
};
