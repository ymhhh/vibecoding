import React, { useEffect, useRef, useState } from 'react';
import { IssueAttachment } from '../types';
import { Language, ThemeStyle, getTranslation } from '../lib/i18n';
import { THEME_CONFIGS } from '../lib/theme';
import { MarkdownView } from '../lib/markdown';
import { fileToAttachment, fileExt, formatFileSize, isPdfAttachment, isPdfFile, maxBytesForAttachment } from '../lib/attachments';
import { pickAttachmentFiles } from '../lib/pickfiles';
import { ChevronLeft, ChevronRight, File, FileText, Image as ImageIcon, Upload, X } from 'lucide-react';
import { PdfPreview } from './PdfPreview';

function isMarkdown(att: IssueAttachment): boolean {
  const ext = fileExt(att.name);
  return ext === 'md' || ext === 'markdown' || att.mime === 'text/markdown';
}

interface AttachmentPreviewProps {
  attachments: IssueAttachment[];
  activeId: string | null;
  onClose: () => void;
  lang: Language;
  themeStyle: ThemeStyle;
  onRepairAttachment?: (next: IssueAttachment) => void;
}

export const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({
  attachments,
  activeId,
  onClose,
  lang,
  themeStyle,
  onRepairAttachment,
}) => {
  const themeConfig = THEME_CONFIGS[themeStyle] || THEME_CONFIGS.light;
  const t = getTranslation(lang);
  const [index, setIndex] = useState(0);
  const [localPdf, setLocalPdf] = useState<Record<string, string>>({});
  const [repairError, setRepairError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRepairError('');
  }, [index, activeId]);

  useEffect(() => {
    if (!activeId) return;
    const next = attachments.findIndex((a) => a.id === activeId);
    if (next >= 0) setIndex(next);
    // Jump to the opened file only. Later prev/next stays on the local index.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    if (attachments.length === 0) {
      onClose();
      return;
    }
    if (attachments[index]) return;
    const opened = attachments.findIndex((a) => a.id === activeId);
    setIndex(opened >= 0 ? opened : 0);
  }, [activeId, attachments, index, onClose]);

  useEffect(() => {
    if (!activeId || attachments.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
        return;
      }
      if (attachments.length < 2) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIndex((i) => (i - 1 + attachments.length) % attachments.length);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIndex((i) => (i + 1) % attachments.length);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [activeId, attachments.length, onClose]);

  if (!activeId || attachments.length === 0) return null;
  const att = attachments[index] || attachments[0];
  if (!att) return null;
  const pdfSrc = att.dataUrl || localPdf[att.id];

  const applyPdfFile = async (file: File) => {
    setRepairError('');
    if (!isPdfFile(file.name, file.type)) {
      setRepairError(lang === 'zh' ? '请选择 PDF 文件' : 'Please choose a PDF file');
      return;
    }
    const limit = maxBytesForAttachment(file.name, file.type);
    if (file.size > limit) {
      setRepairError(
        lang === 'zh'
          ? `${file.name} 超过 ${formatFileSize(limit)} 限制`
          : `${file.name} exceeds ${formatFileSize(limit)}`
      );
      return;
    }
    try {
      const next = await fileToAttachment(file);
      const repaired: IssueAttachment = { ...next, id: att.id, name: att.name };
      if (repaired.dataUrl) {
        setLocalPdf((prev) => ({ ...prev, [att.id]: repaired.dataUrl as string }));
      }
      onRepairAttachment?.(repaired);
    } catch {
      setRepairError(lang === 'zh' ? `无法读取 ${file.name}` : `Could not read ${file.name}`);
    }
  };

  const choosePdf = async () => {
    try {
      const picked = await pickAttachmentFiles();
      if (picked.mode === 'browser') {
        fileInputRef.current?.click();
        return;
      }
      const file = picked.files.find((f) => isPdfFile(f.name, f.type)) || picked.files[0];
      if (file) await applyPdfFile(file);
    } catch (err) {
      setRepairError(err instanceof Error ? err.message : String(err));
    }
  };

  const icon =
    att.kind === 'image' ? (
      <ImageIcon className="w-4 h-4 text-purple-400 shrink-0" />
    ) : att.kind === 'text' ? (
      <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
    ) : isPdfAttachment(att) ? (
      <FileText className="w-4 h-4 text-rose-400 shrink-0" />
    ) : (
      <File className="w-4 h-4 text-slate-400 shrink-0" />
    );

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 sm:p-8"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.attachmentPreview}
        className={`w-full max-w-4xl max-h-[min(88vh,900px)] flex flex-col rounded-2xl border overflow-hidden shadow-2xl ${themeConfig.modalBg}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center gap-3 px-4 py-3 border-b shrink-0 ${themeConfig.modalHeaderBg}`}>
          {icon}
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold truncate ${themeConfig.textPrimary}`}>{att.name}</div>
            <div className={`text-[11px] ${themeConfig.textMuted}`}>
              {formatFileSize(att.size)}
              {attachments.length > 1 ? ` · ${index + 1} / ${attachments.length}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`p-1.5 rounded-lg ${themeConfig.textMuted} hover:text-rose-500`}
            aria-label={lang === 'zh' ? '关闭' : 'Close'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className={`flex-1 min-h-0 overflow-auto ${themeConfig.inputBg}`}>
          {att.kind === 'image' && att.dataUrl ? (
            <div className="flex items-center justify-center p-4 min-h-[280px]">
              <img
                src={att.dataUrl}
                alt={att.name}
                className="max-h-[70vh] max-w-full object-contain rounded-lg"
              />
            </div>
          ) : att.kind === 'text' && att.text?.trim() ? (
            <div className={`px-5 py-4 ${themeConfig.textPrimary}`}>
              {isMarkdown(att) ? (
                <MarkdownView text={att.text} />
              ) : (
                <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed">{att.text}</pre>
              )}
            </div>
          ) : isPdfAttachment(att) && pdfSrc ? (
            <PdfPreview dataUrl={pdfSrc} lang={lang} isLight={!!themeConfig.isLight} />
          ) : isPdfAttachment(att) ? (
            <div className={`px-6 py-16 text-center text-sm ${themeConfig.textMuted}`}>
              <p>{t.attachmentPdfMissing}</p>
              <button
                type="button"
                onClick={() => void choosePdf()}
                className={`mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText}`}
              >
                <Upload className="w-3.5 h-3.5" />
                {t.attachmentPdfChoose}
              </button>
              {repairError ? <p className="mt-3 text-rose-500">{repairError}</p> : null}
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void applyPdfFile(file);
                }}
              />
            </div>
          ) : (
            <div className={`px-6 py-16 text-center text-sm ${themeConfig.textMuted}`}>{t.attachmentNoPreview}</div>
          )}
        </div>

        {attachments.length > 1 && (
          <div className={`flex items-center justify-between gap-3 px-4 py-2.5 border-t shrink-0 ${themeConfig.modalHeaderBg}`}>
            <button
              type="button"
              onClick={() => setIndex((i) => (i - 1 + attachments.length) % attachments.length)}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText}`}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              {t.attachmentPrev}
            </button>
            <button
              type="button"
              onClick={() => setIndex((i) => (i + 1) % attachments.length)}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText}`}
            >
              {t.attachmentNext}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
