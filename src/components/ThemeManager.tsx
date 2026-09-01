import { useEffect, useState } from 'react';
import { Palette, X, RotateCcw, Check, Search } from 'lucide-react';
import {
  PRESETS,
  FONTS,
  FONT_CATEGORIES,
  FONT_VIBES,
  resolveTheme,
  normalizeHex,
  lowContrast,
  ensureFontLoaded,
  type TokenKey,
  type FontKey,
  type FontCategory,
  type FontVibe,
  type Theme,
  type Appearance,
} from '../lib/theme';
import type { Theme as Mode } from '../types';

// ThemeManager, per-device appearance: 17 presets, a searchable font picker, and
// per-token color editing with a live preview. Writes only to localStorage via
// useTheme; nothing here touches PocketBase or another user. Edits target the
// current light/dark mode's palette (the toggle swaps which one is on screen).

interface Props {
  open: boolean;
  onClose: () => void;
  mode: Mode;
  appearance: Appearance;
  applyPreset: (preset: Theme) => void;
  setToken: (key: TokenKey, hex: string, mode: Mode) => void;
  setFont: (font: FontKey) => void;
  resetTheme: () => void;
}

// Which tokens to surface for editing in each mode, only the ones the current
// mode actually paints with, so a swatch edit always has a visible effect.
function editGroups(mode: Mode): { label: string; keys: TokenKey[] }[] {
  const accent: TokenKey[] = ['clay', 'clay-soft', 'clay-wash', 'ochre', 'ochre-soft', 'ochre-wash'];
  if (mode === 'dark') {
    return [
      { label: 'Accent', keys: accent },
      { label: 'Surfaces', keys: ['coal', 'coal-panel', 'coal-line'] },
      { label: 'Text', keys: ['coal-text', 'coal-soft'] },
    ];
  }
  return [
    { label: 'Accent', keys: accent },
    { label: 'Surfaces', keys: ['paper', 'paper-panel', 'paper-line'] },
    { label: 'Text', keys: ['ink', 'ink-soft', 'ink-faint'] },
  ];
}

const TOKEN_LABEL: Partial<Record<TokenKey, string>> = {
  clay: 'primary', 'clay-soft': 'primary soft', 'clay-wash': 'primary wash',
  ochre: 'secondary', 'ochre-soft': 'secondary soft', 'ochre-wash': 'secondary wash',
  paper: 'background', 'paper-panel': 'panel', 'paper-line': 'border',
  coal: 'background', 'coal-panel': 'panel', 'coal-line': 'border', 'coal-text': 'text', 'coal-soft': 'muted',
  ink: 'text', 'ink-soft': 'soft', 'ink-faint': 'faint',
};

export function ThemeManager({ open, onClose, mode, appearance, applyPreset, setToken, setFont, resetTheme }: Props) {
  const [pane, setPane] = useState<'presets' | 'colors' | 'font'>('presets');
  const [fontQuery, setFontQuery] = useState('');
  const [fontCat, setFontCat] = useState<FontCategory | 'All'>('All');
  const [fontVibe, setFontVibe] = useState<FontVibe | 'All'>('All');
  // Load every font once the font pane opens, so the previews render in their own
  // face (not just on hover). One-time cost per open; deduped by ensureFontLoaded.
  useEffect(() => {
    if (!open || pane !== 'font') return;
    for (const f of FONTS) ensureFontLoaded(f.url);
  }, [open, pane]);
  if (!open) return null;

  const q = fontQuery.trim().toLowerCase();
  const shownFonts = FONTS.filter(
    (f) =>
      (!q || f.label.toLowerCase().includes(q)) &&
      (fontCat === 'All' || f.category === fontCat) &&
      (fontVibe === 'All' || f.vibe === fontVibe),
  );

  const active = appearance.theme;
  const tokens = resolveTheme(active, mode);
  const warn = lowContrast(tokens);

  return (
    <div className="fixed inset-0 z-[1200] flex items-start justify-center bg-black/30 pt-[10vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-paper-line bg-paper shadow-2xl dark:border-coal-line dark:bg-coal-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-paper-line px-4 py-3 dark:border-coal-line">
          <Palette className="h-4 w-4 text-ink-faint dark:text-coal-soft" />
          <span className="flex-1 text-sm font-semibold text-ink dark:text-coal-text">Appearance</span>
          <button type="button" onClick={resetTheme} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-faint hover:bg-paper-panel hover:text-ink dark:text-coal-soft dark:hover:bg-coal-line" title="reset to Clay">
            <RotateCcw className="h-3.5 w-3.5" /> reset
          </button>
          <button type="button" onClick={onClose} className="rounded p-1 text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* sub-tabs */}
        <div className="flex gap-1 border-b border-paper-line px-3 py-2 dark:border-coal-line">
          {(['presets', 'colors', 'font'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPane(p)}
              aria-pressed={pane === p}
              className={[
                'rounded-md px-2.5 py-1 text-xs capitalize transition-colors',
                pane === p ? 'bg-clay-wash text-clay dark:bg-clay/20 dark:text-clay-soft' : 'text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line',
              ].join(' ')}
            >
              {p}
            </button>
          ))}
          <span className="ml-auto self-center text-[11px] text-ink-faint dark:text-coal-soft">editing {mode}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {pane === 'presets' && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PRESETS.map((preset) => {
                const t = mode === 'dark' ? preset.dark : preset.light;
                const on = active.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className={[
                      'group flex flex-col gap-2 rounded-lg border p-2 text-left transition-colors',
                      on ? 'border-clay ring-1 ring-clay' : 'border-paper-line hover:border-ink-faint dark:border-coal-line dark:hover:border-coal-soft',
                    ].join(' ')}
                  >
                    <div className="flex h-10 items-center gap-1.5 rounded-md px-2" style={{ background: t.paper }}>
                      <span className="h-4 w-4 rounded-full" style={{ background: t.clay }} />
                      <span className="h-4 w-4 rounded-full" style={{ background: t.ochre }} />
                      <span className="ml-auto text-xs font-semibold" style={{ color: t.ink }}>Aa</span>
                    </div>
                    <span className="flex items-center gap-1 text-xs font-medium text-ink dark:text-coal-text">
                      {on && <Check className="h-3 w-3 text-clay" />}
                      {preset.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {pane === 'colors' && (
            <div className="space-y-4">
              {warn && (
                <p className="rounded-md bg-ochre-wash px-2.5 py-1.5 text-[11px] text-ochre dark:bg-ochre/15 dark:text-ochre-soft">
                  low contrast, text on the background may be hard to read
                </p>
              )}
              {editGroups(mode).map((group) => (
                <div key={group.label}>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-coal-soft">{group.label}</p>
                  <div className="space-y-1">
                    {group.keys.map((key) => (
                      <Swatch key={`${key}:${tokens[key]}`} label={TOKEN_LABEL[key] ?? key} hex={tokens[key]} onChange={(hex) => setToken(key, hex, mode)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {pane === 'font' && (
            <div className="space-y-2">
              {/* Search + classify filters. */}
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="flex min-w-[8rem] flex-1 items-center gap-1.5 rounded-lg border border-paper-line bg-paper px-2 py-1.5 dark:border-coal-line dark:bg-coal-panel">
                  <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint dark:text-coal-soft" />
                  <input
                    value={fontQuery}
                    onChange={(e) => setFontQuery(e.target.value)}
                    placeholder="Search fonts"
                    className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint/70 dark:text-coal-text"
                  />
                  {fontQuery && (
                    <button type="button" onClick={() => setFontQuery('')} className="shrink-0 rounded p-0.5 text-ink-faint hover:text-ink dark:hover:text-coal-text" title="Clear">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <select
                  value={fontCat}
                  onChange={(e) => setFontCat(e.target.value as FontCategory | 'All')}
                  title="Filter by category"
                  className="rounded-lg border border-paper-line bg-paper px-1.5 py-1.5 text-xs text-ink dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
                >
                  <option value="All">All types</option>
                  {FONT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <select
                  value={fontVibe}
                  onChange={(e) => setFontVibe(e.target.value as FontVibe | 'All')}
                  title="Filter by vibe"
                  className="rounded-lg border border-paper-line bg-paper px-1.5 py-1.5 text-xs text-ink dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
                >
                  <option value="All">Any vibe</option>
                  {FONT_VIBES.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                {shownFonts.map((f) => {
                  const on = appearance.font === f.key;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onMouseEnter={() => ensureFontLoaded(f.url)}
                      onClick={() => {
                        ensureFontLoaded(f.url);
                        setFont(f.key);
                      }}
                      className={[
                        'flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                        on ? 'border-clay ring-1 ring-clay' : 'border-paper-line hover:border-ink-faint dark:border-coal-line dark:hover:border-coal-soft',
                      ].join(' ')}
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-xs font-medium text-ink dark:text-coal-text">
                          {on && <Check className="h-3 w-3 text-clay" />}
                          {f.label}
                          <span className="rounded-full bg-paper-panel px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-wide text-ink-faint dark:bg-coal-line dark:text-coal-soft">
                            {f.category} · {f.vibe}
                          </span>
                        </span>
                        <span className="block truncate text-lg text-ink dark:text-coal-text" style={{ fontFamily: f.stack }}>
                          The quick brown fox
                        </span>
                      </span>
                    </button>
                  );
                })}
                {shownFonts.length === 0 && (
                  <p className="px-1 py-3 text-center text-xs text-ink-faint dark:text-coal-soft">No fonts match. Try another search or filter.</p>
                )}
              </div>
              <p className="px-1 pt-1 text-[11px] text-ink-faint dark:text-coal-soft">sets the interface + body font; headings keep their display face.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// A labeled color row: native picker + hex text field. The text field accepts
// shorthand / rgb() and only commits when normalizeHex says it's valid. The
// caller keys this by the committed hex, so the buffer reseeds on preset apply.
function Swatch({ label, hex, onChange }: { label: string; hex: string; onChange: (hex: string) => void }) {
  const [text, setText] = useState(hex);
  const commit = (raw: string) => {
    const norm = normalizeHex(raw);
    if (norm) onChange(norm);
  };
  return (
    <div className="flex items-center gap-2">
      <label className="relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-md border border-paper-line dark:border-coal-line" style={{ background: hex }}>
        <input
          type="color"
          value={normalizeHex(hex) ?? '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <span className="w-24 shrink-0 text-xs text-ink-soft dark:text-coal-soft">{label}</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(text)}
        onKeyDown={(e) => e.key === 'Enter' && commit(text)}
        spellCheck={false}
        className="w-24 rounded-md border border-paper-line bg-paper px-2 py-1 font-mono text-xs text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
      />
    </div>
  );
}
