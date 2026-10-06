import { useEffect } from 'react';

interface KeyboardShortcutsOptions {
  onToggleCommandPalette: () => void;
  onToggleActivity?: () => void;
  onCreateIssue?: () => void;
  onOpenSettings?: () => void;
  onRefresh?: () => void;
  isPaletteOpen?: boolean;
}

export function useKeyboardShortcuts({
  onToggleCommandPalette,
  onToggleActivity,
  onCreateIssue,
  onOpenSettings,
  onRefresh,
  isPaletteOpen = false,
}: KeyboardShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const isInputFocused =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      // 1. Cmd/Ctrl + K: Toggle Command Palette (Always intercept, even in inputs)
      if (isCmdOrCtrl && (e.key.toLowerCase() === 'k' || e.code === 'KeyK')) {
        e.preventDefault();
        e.stopPropagation();
        onToggleCommandPalette();
        return;
      }

      // If Command Palette is open, let Command Palette handle its own keys (ArrowUp, ArrowDown, Enter, Esc)
      if (isPaletteOpen) {
        return;
      }

      // 2. Cmd/Ctrl + J: Toggle Activity Timeline
      if (isCmdOrCtrl && (e.key.toLowerCase() === 'j' || e.code === 'KeyJ')) {
        e.preventDefault();
        onToggleActivity?.();
        return;
      }

      // 3. Cmd/Ctrl + ,: Open Settings
      if (isCmdOrCtrl && e.key === ',') {
        e.preventDefault();
        onOpenSettings?.();
        return;
      }

      // 3. Cmd/Ctrl + N: Quick Create New Issue (when not typing in an input)
      if (isCmdOrCtrl && (e.key.toLowerCase() === 'n' || e.code === 'KeyN') && !isInputFocused) {
        e.preventDefault();
        onCreateIssue?.();
        return;
      }

      // 4. '?' or '/' when outside input: Open Command Palette
      if (!isInputFocused && !isCmdOrCtrl && (e.key === '?' || e.key === '/')) {
        e.preventDefault();
        onToggleCommandPalette();
        return;
      }

      // 5. 'c' or 'C' when outside input: Quick create issue
      if (!isInputFocused && !isCmdOrCtrl && !e.altKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        onCreateIssue?.();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [
    onToggleCommandPalette,
    onToggleActivity,
    onCreateIssue,
    onOpenSettings,
    onRefresh,
    isPaletteOpen,
  ]);
}
