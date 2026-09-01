import { useCallback, useEffect, useState } from 'react';
import type { Theme as Mode } from '../types';
import {
  applyAppearance,
  loadAppearance,
  saveAppearance,
  CLAY,
  type Appearance,
  type Theme,
  type ThemeTokens,
  type FontKey,
  type TokenKey,
} from '../lib/theme';

// useTheme, local per-device appearance: light/dark mode plus the active theme
// (colors + font). None of it syncs; it's a viewing preference, not workspace
// data. The `dark` class on <html> drives Tailwind's class dark mode; the theme
// vars are written inline on <html> by applyAppearance for the current mode, so
// the dark toggle and a custom palette compose (each `dark:` class variant picks
// which token it reads). This is the single source for both, it's mounted once
// in Workspace and the theme manager reads/writes through the same instance.

const MODE_KEY = 'waypoint-theme';

function readMode(): Mode {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function useTheme() {
  const [theme, setMode] = useState<Mode>(readMode);
  const [appearance, setAppearance] = useState<Appearance>(loadAppearance);

  // Re-apply the palette/font whenever the mode or the saved appearance changes,
  // and keep the `dark` class + persisted mode in sync.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    try {
      localStorage.setItem(MODE_KEY, theme);
    } catch {
      /* ignore */
    }
    applyAppearance(appearance, theme);
  }, [theme, appearance]);

  const toggle = () => setMode((t) => (t === 'light' ? 'dark' : 'light'));

  const persist = useCallback((next: Appearance) => {
    setAppearance(next);
    saveAppearance(next);
  }, []);

  // Apply a whole preset (its own font comes along).
  const applyPreset = useCallback((preset: Theme) => {
    persist({ theme: preset, font: preset.font });
  }, [persist]);

  // Edit one token for the *current* mode; the other mode keeps its values, so
  // the dark toggle still swaps between them. Editing forks the active theme
  // into a 'custom' copy so a preset name doesn't lie about what's on screen.
  const setToken = useCallback((key: TokenKey, hex: string, mode: Mode) => {
    setAppearance((a) => {
      const lane = mode === 'dark' ? 'dark' : 'light';
      const custom = a.theme.id === 'custom';
      const nextTheme: Theme = {
        ...a.theme,
        id: 'custom',
        name: custom ? a.theme.name : `${a.theme.name} (edited)`,
        [lane]: { ...a.theme[lane], [key]: hex } as ThemeTokens,
      };
      const next = { ...a, theme: nextTheme };
      saveAppearance(next);
      return next;
    });
  }, []);

  const setFont = useCallback((font: FontKey) => {
    setAppearance((a) => {
      const next = { ...a, font };
      saveAppearance(next);
      return next;
    });
  }, []);

  const resetTheme = useCallback(() => {
    persist({ theme: CLAY, font: 'inter' });
  }, [persist]);

  return { theme, toggle, appearance, applyPreset, setToken, setFont, resetTheme };
}
