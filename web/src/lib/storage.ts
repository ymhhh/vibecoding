import { Language, ThemeStyle } from './i18n';

export type IssueShell = 'modal' | 'drawer' | 'fullscreen';
export type Density = 'comfortable' | 'compact';

const STORAGE_KEYS = {
  LANGUAGE: 'vibe_app_language',
  THEME_STYLE: 'vibe_app_theme_style',
  ISSUE_SHELL: 'vibe_app_issue_shell',
  DENSITY: 'vibe_app_density',
  ACTIVITY_OPEN: 'vibe_app_activity_open',
  ACTIVITY_WIDTH: 'vibe_app_activity_width',
  COMPLETED_COLUMN_COLLAPSED: 'vibe_app_completed_column_collapsed',
};

const DEFAULT_ACTIVITY_WIDTH = 320;
const MIN_ACTIVITY_WIDTH = 240;
const MAX_ACTIVITY_WIDTH = 480;

export function clampActivityWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_ACTIVITY_WIDTH;
  return Math.min(MAX_ACTIVITY_WIDTH, Math.max(MIN_ACTIVITY_WIDTH, Math.round(width)));
}

export function loadLanguage(): Language {
  try {
    const lang = localStorage.getItem(STORAGE_KEYS.LANGUAGE) as Language;
    if (lang === 'en' || lang === 'zh') return lang;
  } catch {
    /* ignore */
  }
  return 'en';
}

export function saveLanguage(lang: Language): void {
  try {
    localStorage.setItem(STORAGE_KEYS.LANGUAGE, lang);
  } catch {
    /* ignore */
  }
}

export function loadThemeStyle(): ThemeStyle {
  try {
    const theme = localStorage.getItem(STORAGE_KEYS.THEME_STYLE) as ThemeStyle;
    if (['glass', 'slate', 'light', 'oled', 'oat'].includes(theme)) return theme;
  } catch {
    /* ignore */
  }
  return 'light';
}

export function saveThemeStyle(theme: ThemeStyle): void {
  try {
    localStorage.setItem(STORAGE_KEYS.THEME_STYLE, theme);
  } catch {
    /* ignore */
  }
}

export function loadIssueShell(): IssueShell {
  try {
    const shell = localStorage.getItem(STORAGE_KEYS.ISSUE_SHELL) as IssueShell;
    if (shell === 'modal' || shell === 'drawer' || shell === 'fullscreen') return shell;
  } catch {
    /* ignore */
  }
  return 'modal';
}

export function saveIssueShell(shell: IssueShell): void {
  try {
    localStorage.setItem(STORAGE_KEYS.ISSUE_SHELL, shell);
  } catch {
    /* ignore */
  }
}

export function loadDensity(): Density {
  try {
    const density = localStorage.getItem(STORAGE_KEYS.DENSITY) as Density;
    if (density === 'comfortable' || density === 'compact') return density;
  } catch {
    /* ignore */
  }
  return 'comfortable';
}

export function saveDensity(density: Density): void {
  try {
    localStorage.setItem(STORAGE_KEYS.DENSITY, density);
  } catch {
    /* ignore */
  }
}

export function loadActivityOpen(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ACTIVITY_OPEN);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    /* ignore */
  }
  return false;
}

export function saveActivityOpen(open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEYS.ACTIVITY_OPEN, open ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

export function loadActivityWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ACTIVITY_WIDTH);
    if (raw != null) {
      const n = Number(raw);
      if (Number.isFinite(n)) return clampActivityWidth(n);
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_ACTIVITY_WIDTH;
}

export function saveActivityWidth(width: number): void {
  try {
    localStorage.setItem(STORAGE_KEYS.ACTIVITY_WIDTH, String(clampActivityWidth(width)));
  } catch {
    /* ignore */
  }
}

export function loadCompletedColumnCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.COMPLETED_COLUMN_COLLAPSED);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    /* ignore */
  }
  return false;
}

export function saveCompletedColumnCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEYS.COMPLETED_COLUMN_COLLAPSED, collapsed ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

export { DEFAULT_ACTIVITY_WIDTH, MIN_ACTIVITY_WIDTH, MAX_ACTIVITY_WIDTH };
