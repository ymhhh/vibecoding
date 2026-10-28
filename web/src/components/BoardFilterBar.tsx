import React from 'react';
import { Filter, LayoutGrid, List, ListChecks, X } from 'lucide-react';
import { GitRepo, IssueKind, Priority } from '../types';
import { Language, ThemeStyle, getTranslation } from '../lib/i18n';
import { THEME_CONFIGS } from '../lib/theme';
import { BoardFilters, BoardViewMode, EMPTY_BOARD_FILTERS } from '../lib/boardFilters';
import { ISSUE_KINDS } from '../lib/issueKind';
import { ThemedSelect } from './ThemedSelect';

interface BoardFilterBarProps {
  filters: BoardFilters;
  onChange: (next: BoardFilters) => void;
  viewMode: BoardViewMode;
  onViewModeChange: (mode: BoardViewMode) => void;
  gitRepos: GitRepo[];
  reviewQueueCount: number;
  reviewQueueOpen: boolean;
  onToggleReviewQueue: () => void;
  filteredCount: number;
  totalCount: number;
  lang?: Language;
  themeStyle?: ThemeStyle;
}

const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];

export const BoardFilterBar: React.FC<BoardFilterBarProps> = ({
  filters,
  onChange,
  viewMode,
  onViewModeChange,
  gitRepos,
  reviewQueueCount,
  reviewQueueOpen,
  onToggleReviewQueue,
  filteredCount,
  totalCount,
  lang = 'en',
  themeStyle = 'light',
}) => {
  const t = getTranslation(lang);
  const themeConfig = THEME_CONFIGS[themeStyle] || THEME_CONFIGS.light;
  const isLight = themeConfig.isLight;
  const hasActive =
    !!filters.kind || !!filters.repoId || !!filters.priority;

  const selectClass = isLight
    ? 'bg-white border-slate-300 text-slate-800 text-xs py-1.5 pl-2.5 rounded-lg'
    : 'bg-slate-900/80 border-white/15 text-slate-200 text-xs py-1.5 pl-2.5 rounded-lg';

  const kindLabel = (k: IssueKind) =>
    k === 'bugfix' ? t.issueKindBugfix : k === 'hotfix' ? t.issueKindHotfix : t.issueKindFeature;

  const priorityLabel = (p: Priority) => {
    switch (p) {
      case 'low':
        return t.priorityLow;
      case 'medium':
        return t.priorityMedium;
      case 'high':
        return t.priorityHigh;
      case 'urgent':
        return t.priorityUrgent;
    }
  };

  return (
    <div
      className={`shrink-0 border-b px-3 sm:px-6 py-2.5 flex flex-wrap items-center gap-2 ${themeConfig.subtleBorder}`}
    >
      <div className={`flex items-center gap-1.5 text-xs font-medium ${themeConfig.textSecondary}`}>
        <Filter className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:inline">{t.boardFilters}</span>
      </div>

      <ThemedSelect
        isLight={isLight}
        value={filters.kind}
        onChange={(e) => onChange({ ...filters, kind: (e.target.value || '') as BoardFilters['kind'] })}
        className={selectClass}
        aria-label={t.filterByKind}
        title={t.filterByKind}
      >
        <option value="">{t.filterAllKinds}</option>
        {ISSUE_KINDS.map((k) => (
          <option key={k} value={k}>
            {kindLabel(k)}
          </option>
        ))}
      </ThemedSelect>

      <ThemedSelect
        isLight={isLight}
        value={filters.repoId}
        onChange={(e) => onChange({ ...filters, repoId: e.target.value })}
        className={selectClass}
        aria-label={t.filterByRepo}
        title={t.filterByRepo}
      >
        <option value="">{t.filterAllRepos}</option>
        {gitRepos.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name || r.path || r.id}
          </option>
        ))}
      </ThemedSelect>

      <ThemedSelect
        isLight={isLight}
        value={filters.priority}
        onChange={(e) =>
          onChange({ ...filters, priority: (e.target.value || '') as BoardFilters['priority'] })
        }
        className={selectClass}
        aria-label={t.filterByPriority}
        title={t.filterByPriority}
      >
        <option value="">{t.filterAllPriorities}</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {priorityLabel(p)}
          </option>
        ))}
      </ThemedSelect>

      {hasActive && (
        <button
          type="button"
          onClick={() => onChange({ ...EMPTY_BOARD_FILTERS })}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
            isLight
              ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
              : 'bg-white/10 hover:bg-white/15 border-white/15 text-slate-300'
          }`}
          title={t.clearFilters}
        >
          <X className="w-3 h-3" />
          {t.clearFilters}
        </button>
      )}

      <span className={`text-[11px] font-mono ${themeConfig.textMuted}`}>
        {filteredCount}/{totalCount}
      </span>

      <div className="flex-1 min-w-[8px]" />

      <button
        type="button"
        onClick={onToggleReviewQueue}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
          reviewQueueOpen
            ? 'bg-purple-600 text-white border-purple-500'
            : isLight
              ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
              : 'bg-white/10 hover:bg-white/15 border-white/15 text-slate-300'
        }`}
        title={t.reviewQueue}
      >
        <ListChecks className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{t.reviewQueue}</span>
        {reviewQueueCount > 0 && (
          <span
            className={`min-w-[1.25rem] px-1 rounded-full text-[10px] font-bold text-center ${
              reviewQueueOpen
                ? 'bg-white/20 text-white'
                : isLight
                  ? 'bg-purple-100 text-purple-800'
                  : 'bg-purple-500/30 text-purple-200'
            }`}
          >
            {reviewQueueCount}
          </span>
        )}
      </button>

      <div
        className={`inline-flex rounded-lg border p-0.5 ${
          isLight ? 'border-slate-300 bg-slate-100' : 'border-white/15 bg-black/20'
        }`}
        role="group"
        aria-label={t.boardViewMode}
      >
        <button
          type="button"
          onClick={() => onViewModeChange('board')}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
            viewMode === 'board'
              ? 'bg-indigo-600 text-white'
              : isLight
                ? 'text-slate-600 hover:bg-white'
                : 'text-slate-300 hover:bg-white/10'
          }`}
          title={t.viewBoard}
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span className="hidden md:inline">{t.viewBoard}</span>
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange('list')}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
            viewMode === 'list'
              ? 'bg-indigo-600 text-white'
              : isLight
                ? 'text-slate-600 hover:bg-white'
                : 'text-slate-300 hover:bg-white/10'
          }`}
          title={t.viewList}
        >
          <List className="w-3.5 h-3.5" />
          <span className="hidden md:inline">{t.viewList}</span>
        </button>
      </div>
    </div>
  );
};
