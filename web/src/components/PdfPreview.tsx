import React, { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw } from 'lucide-react';
import { Language, getTranslation } from '../lib/i18n';

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function dataUrlToBlobUrl(dataUrl: string): string {
  const bytes = dataUrlToBytes(dataUrl);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return URL.createObjectURL(new Blob([copy], { type: 'application/pdf' }));
}

let pdfjsLoader: Promise<typeof import('pdfjs-dist')> | null = null;

function loadPdfjs() {
  if (!pdfjsLoader) {
    pdfjsLoader = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(
      ([pdfjs, worker]) => {
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        return pdfjs;
      }
    );
  }
  return pdfjsLoader;
}

type PdfErrorKind = 'encrypted' | 'broken' | 'iframe';

function PdfIframe({ dataUrl }: { dataUrl: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    const url = dataUrlToBlobUrl(dataUrl);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [dataUrl]);
  if (!src) return null;
  return <iframe title="PDF" src={src} className="w-full min-h-[70vh] border-0 bg-white" />;
}

interface PdfPreviewProps {
  dataUrl: string;
  lang: Language;
  isLight: boolean;
}

export const PdfPreview: React.FC<PdfPreviewProps> = ({ dataUrl, lang, isLight }) => {
  const t = getTranslation(lang);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.1);
  const [error, setError] = useState<PdfErrorKind | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    let task: PDFDocumentLoadingTask | null = null;
    setLoading(true);
    setError(null);
    setPdf(null);
    setPage(1);
    setPageCount(0);

    void (async () => {
      try {
        const pdfjs = await loadPdfjs();
        if (cancelled) return;
        task = pdfjs.getDocument({ data: dataUrlToBytes(dataUrl) });
        const loaded = await task.promise;
        if (cancelled) {
          void loaded.cleanup();
          return;
        }
        doc = loaded;
        setPdf(loaded);
        setPageCount(loaded.numPages);
        setLoading(false);
      } catch (err: unknown) {
        if (cancelled) return;
        const name = (err as { name?: string })?.name;
        setError(name === 'PasswordException' ? 'encrypted' : 'iframe');
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      void task?.destroy();
      if (doc) void doc.cleanup();
    };
  }, [dataUrl]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    (async () => {
      try {
        const pdfPage = await pdf.getPage(page);
        if (cancelled) return;
        const viewport = pdfPage.getViewport({ scale });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
        await pdfPage.render({
          canvasContext: ctx,
          canvas,
          viewport,
          transform,
        }).promise;
      } catch {
        if (!cancelled) setError('broken');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdf, page, scale]);

  if (error === 'encrypted') {
    return (
      <div className={`px-6 py-16 text-center text-sm ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
        {t.attachmentPdfEncrypted}
      </div>
    );
  }

  if (error === 'iframe') {
    return <PdfIframe dataUrl={dataUrl} />;
  }

  return (
    <div className="flex flex-col h-full min-h-[280px]">
      <div
        className={`flex items-center justify-center gap-2 px-3 py-2 border-b shrink-0 text-[11px] ${
          isLight ? 'border-slate-200 text-slate-600' : 'border-white/10 text-slate-300'
        }`}
      >
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="p-1 rounded-md disabled:opacity-30 hover:bg-black/5 dark:hover:bg-white/10"
          aria-label={t.attachmentPdfPrevPage}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="font-mono tabular-nums min-w-[4.5rem] text-center">
          {loading ? '…' : `${page} / ${pageCount || 1}`}
        </span>
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          className="p-1 rounded-md disabled:opacity-30 hover:bg-black/5 dark:hover:bg-white/10"
          aria-label={t.attachmentPdfNextPage}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        <span className="w-px h-4 bg-slate-300/80 dark:bg-white/15 mx-1" />
        <button
          type="button"
          onClick={() => setScale((s) => Math.max(0.5, Number((s - 0.15).toFixed(2))))}
          className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10"
          aria-label={t.attachmentZoomOut}
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span className="font-mono tabular-nums w-10 text-center">{Math.round(scale * 100)}%</span>
        <button
          type="button"
          onClick={() => setScale((s) => Math.min(3, Number((s + 0.15).toFixed(2))))}
          className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10"
          aria-label={t.attachmentZoomIn}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setScale(1.1)}
          className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10"
          aria-label={t.attachmentZoomReset}
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto flex items-start justify-center p-4">
        {loading && (
          <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            {lang === 'zh' ? '正在打开 PDF…' : 'Opening PDF…'}
          </p>
        )}
        <canvas ref={canvasRef} className={`max-w-full ${loading ? 'hidden' : ''}`} />
      </div>
    </div>
  );
};
