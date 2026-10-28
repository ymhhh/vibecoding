import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DevelopmentRevision,
  Issue,
  IssueRevisionsPayload,
  RequirementRevision,
} from '../../types';
import { Language, ThemeStyle, getTranslation } from '../../lib/i18n';
import { THEME_CONFIGS } from '../../lib/theme';
import { MarkdownView } from '../../lib/markdown';
import { api } from '../../lib/api';
import { coerceReqMarkdown } from '../../lib/subreq';
import { History, Loader2, X } from 'lucide-react';

interface SpecRevisionBrowserProps {
  issue: Issue;
  lang: Language;
  themeStyle: ThemeStyle;
  /** Bump when accepts happen so the list refreshes. */
  refreshKey?: string | number;
}

type Viewing =
  | { kind: 'req'; rev: RequirementRevision; designs: DevelopmentRevision[] }
  | { kind: 'dev'; rev: DevelopmentRevision; req?: RequirementRevision | null };

export const SpecRevisionBrowser: React.FC<SpecRevisionBrowserProps> = ({
  issue,
  lang,
  themeStyle,
  refreshKey,
}) => {
  const t = getTranslation(lang);
  const themeConfig = THEME_CONFIGS[themeStyle] || THEME_CONFIGS.light;
  const [payload, setPayload] = useState<IssueRevisionsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.listIssueRevisions(issue.id);
      setPayload(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [issue.id]);

  useEffect(() => {
    void load();
  }, [load, refreshKey, issue.currentRequirementRevisionId, issue.currentDevelopmentRevisionId]);

  const designsByReq = useMemo(() => {
    const map = new Map<string, DevelopmentRevision[]>();
    for (const d of payload?.developmentRevisions || []) {
      const key = d.requirementRevisionId || '';
      const list = map.get(key) || [];
      list.push(d);
      map.set(key, list);
    }
    return map;
  }, [payload]);

  const openReq = async (rev: RequirementRevision) => {
    try {
      const detail = await api.getRequirementRevision(issue.id, rev.id);
      setViewing({ kind: 'req', rev: detail.revision, designs: detail.developmentRevisions || [] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const openDev = async (rev: DevelopmentRevision) => {
    try {
      const detail = await api.getDevelopmentRevision(issue.id, rev.id);
      setViewing({ kind: 'dev', rev: detail.revision, req: detail.requirementRevision });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const reqRevs = payload?.requirementRevisions || [];
  const hasAny = reqRevs.length > 0 || (payload?.developmentRevisions || []).length > 0;

  return (
    <div className={`rounded-xl border p-3 space-y-2 ${themeConfig.cardBg} ${themeConfig.inputBorder}`}>
      <div className="flex items-center justify-between gap-2">
        <div className={`flex items-center gap-1.5 text-xs font-semibold ${themeConfig.textPrimary}`}>
          <History className="w-3.5 h-3.5 text-indigo-500" />
          {t.revisionsTitle}
        </div>
        {loading && <Loader2 className={`w-3.5 h-3.5 animate-spin ${themeConfig.textMuted}`} />}
      </div>
      {error && <p className="text-[11px] text-rose-500">{error}</p>}
      {!hasAny && !loading ? (
        <p className={`text-[11px] ${themeConfig.textMuted}`}>{t.revisionsEmpty}</p>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {reqRevs.map((rev, idx) => {
            const linked = designsByReq.get(rev.id) || [];
            const isCurrent = rev.id === payload?.currentRequirementRevisionId;
            return (
              <div key={rev.id} className="space-y-1">
                <button
                  type="button"
                  onClick={() => void openReq(rev)}
                  className={`w-full text-left px-2 py-1.5 rounded-lg border text-[11px] transition-colors ${themeConfig.inputBorder} hover:border-indigo-400`}
                >
                  <span className={`font-semibold ${themeConfig.textPrimary}`}>
                    {t.revisionsReqLabel} #{idx + 1}
                  </span>
                  {isCurrent && (
                    <span className="ml-1 text-[10px] text-indigo-600 dark:text-indigo-300">
                      ({t.revisionsCurrentDraft})
                    </span>
                  )}
                  <div className={`truncate ${themeConfig.textMuted}`}>
                    {new Date(rev.createdAt).toLocaleString()} · {rev.source || 'manual'}
                  </div>
                </button>
                {linked.length > 0 && (
                  <div className="pl-3 space-y-1">
                    {linked.map((d, j) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => void openDev(d)}
                        className={`w-full text-left px-2 py-1 rounded-md border text-[10px] ${themeConfig.inputBorder} ${themeConfig.textSecondary}`}
                      >
                        {t.revisionsDevLabel} #{j + 1}
                        {d.id === payload?.currentDevelopmentRevisionId ? ' ★' : ''}
                        {d.commits && d.commits.length > 0
                          ? ` · ${d.commits.length} ${t.revisionsCommits.toLowerCase()}`
                          : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {(designsByReq.get('') || []).map((d, j) => (
            <button
              key={d.id}
              type="button"
              onClick={() => void openDev(d)}
              className={`w-full text-left px-2 py-1.5 rounded-lg border text-[11px] ${themeConfig.inputBorder}`}
            >
              {t.revisionsDevLabel} (legacy) #{j + 1}
            </button>
          ))}
        </div>
      )}

      {viewing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div
            className={`w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col rounded-2xl border shadow-2xl ${themeConfig.modalBg}`}
          >
            <div
              className={`px-4 py-3 border-b flex items-center justify-between ${themeConfig.subtleBorder} ${themeConfig.modalHeaderBg}`}
            >
              <div className={`text-sm font-semibold ${themeConfig.textPrimary}`}>
                {t.revisionsViewPast}
              </div>
              <button
                type="button"
                onClick={() => setViewing(null)}
                className={`p-1.5 rounded-lg ${themeConfig.textSecondary}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {viewing.kind === 'req' ? (
                <>
                  <p className={`text-[11px] ${themeConfig.textMuted}`}>
                    {viewing.rev.source}
                    {viewing.rev.sourceUrl ? ` · ${viewing.rev.sourceUrl}` : ''} ·{' '}
                    {new Date(viewing.rev.createdAt).toLocaleString()}
                  </p>
                  <div className={`rounded-xl border p-3 ${themeConfig.cardBg}`}>
                    <MarkdownView text={coerceReqMarkdown(viewing.rev.rawMarkdown)} />
                  </div>
                  {viewing.designs.length > 0 && (
                    <div className="space-y-1">
                      <p className={`text-xs font-semibold ${themeConfig.textPrimary}`}>
                        {t.revisionsLinkedDesigns}
                      </p>
                      {viewing.designs.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => void openDev(d)}
                          className={`block w-full text-left text-[11px] px-2 py-1 rounded border ${themeConfig.inputBorder}`}
                        >
                          {d.id} · {new Date(d.createdAt).toLocaleString()}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  {viewing.req && (
                    <p className={`text-[11px] ${themeConfig.textMuted}`}>
                      {t.revisionsLinkedReq}: {viewing.req.id}
                    </p>
                  )}
                  <div className={`rounded-xl border p-3 ${themeConfig.cardBg}`}>
                    <MarkdownView text={viewing.rev.rawMarkdown || ''} />
                  </div>
                  {(viewing.rev.commits || []).length > 0 && (
                    <div>
                      <p className={`text-xs font-semibold mb-1 ${themeConfig.textPrimary}`}>
                        {t.revisionsCommits}
                      </p>
                      <ul className={`text-[11px] font-mono space-y-0.5 ${themeConfig.textSecondary}`}>
                        {(viewing.rev.commits || []).map((c) => (
                          <li key={c.id}>
                            {c.repoId}: {c.sha}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className={`px-4 py-3 border-t ${themeConfig.subtleBorder}`}>
              <button
                type="button"
                onClick={() => setViewing(null)}
                className="px-3 py-1.5 text-xs rounded-lg bg-indigo-600 text-white font-semibold"
              >
                {t.revisionsBackToDraft}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
