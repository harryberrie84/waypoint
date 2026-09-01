// ---------------------------------------------------------------------------
// Appearance, per-device theme (colors + font). Local only: never written to
// PocketBase, never read off another user, exactly like the light/dark toggle.
// ---------------------------------------------------------------------------
// The palette lives in CSS custom properties (see index.css / tailwind.config).
// Each Tailwind token reads `rgb(var(--token) / <alpha-value>)`, so the vars
// hold space-separated RGB *channels* ("224 90 134"), not hex, that's what
// keeps opacity utilities like `bg-clay/15` working. A theme stores plain hex
// for editing; applyTokens converts hex → channels when it writes the vars.
//
// Components keep using `bg-paper dark:bg-coal`: the `dark:` class variants pick
// which token each element reads, so light/dark is still a class toggle on
// <html>. A theme carries a full token set for each mode; applyTokens writes the
// active mode's set, so both surfaces stay correct whichever way the toggle is.

// Every token shade the app paints with. Order here is the order the manager
// groups them (accent, surfaces, text) only loosely, grouping is in the UI.
export const TOKEN_KEYS = [
  'ink', 'ink-soft', 'ink-faint',
  'paper', 'paper-panel', 'paper-line',
  'coal', 'coal-panel', 'coal-line', 'coal-text', 'coal-soft',
  'clay', 'clay-soft', 'clay-wash',
  'ochre', 'ochre-soft', 'ochre-wash',
] as const;

export type TokenKey = (typeof TOKEN_KEYS)[number];
export type ThemeTokens = Record<TokenKey, string>; // token → '#rrggbb'

export type FontKey =
  | 'inter' | 'fraunces-sans' | 'source-sans' | 'work-sans' | 'ibm-plex'
  | 'spline' | 'space-grotesk' | 'libre-franklin' | 'lora' | 'system' | 'jetbrains-mono'
  | 'syne' | 'bricolage' | 'quicksand'
  | 'sora' | 'dm-sans' | 'outfit' | 'plus-jakarta' | 'poppins' | 'archivo'
  | 'nunito' | 'comfortaa' | 'fredoka' | 'playfair' | 'crimson-pro'
  | 'instrument-serif' | 'space-mono' | 'unbounded';

export interface Theme {
  id: string;
  name: string;
  light: ThemeTokens;
  dark: ThemeTokens;
  font: FontKey;
}

// How fonts are classified for the picker's filters. `category` is structural
// (what kind of letterforms), `vibe` is the feel, so you can filter by either.
export type FontCategory = 'Sans' | 'Serif' | 'Mono' | 'Rounded' | 'Display';
export type FontVibe = 'Clean' | 'Modern' | 'Retro' | 'Playful' | 'Elegant' | 'Techy';
export const FONT_CATEGORIES: FontCategory[] = ['Sans', 'Serif', 'Mono', 'Rounded', 'Display'];
export const FONT_VIBES: FontVibe[] = ['Clean', 'Modern', 'Retro', 'Playful', 'Elegant', 'Techy'];

export interface FontDef {
  key: FontKey;
  label: string;
  stack: string; // always ends in a system fallback, so a failed url still renders
  url?: string; // stylesheet to lazy-load on first use; bundled fonts have none
  category: FontCategory;
  vibe: FontVibe;
}

// --- Default palette (Clay) -------------------------------------------------
// Every other preset is built from these, overriding only what it changes. Clay
// is mode-independent (the dark surfaces are always-defined coal-* tokens the
// `dark:` variants reach for), so its light and dark sets are the same values.
const CLAY_TOKENS: ThemeTokens = {
  ink: '#2b2a28', 'ink-soft': '#5b5854', 'ink-faint': '#8a8782',
  paper: '#faf9f6', 'paper-panel': '#f3f1ec', 'paper-line': '#e6e3dc',
  coal: '#1a1917', 'coal-panel': '#222120', 'coal-line': '#34322f', 'coal-text': '#e9e6df', 'coal-soft': '#a6a39c',
  clay: '#e05a86', 'clay-soft': '#ef88a8', 'clay-wash': '#fce3ec',
  ochre: '#b8771a', 'ochre-soft': '#e8b455', 'ochre-wash': '#f7ecd2',
};

// Build a theme from a light set + dark overrides. Most presets keep the same
// accent across modes and only diverge on surfaces/text, so the dark set is the
// light set with the handful of surface tokens swapped for darker ones.
function theme(id: string, name: string, font: FontKey, light: Partial<ThemeTokens>, dark: Partial<ThemeTokens>): Theme {
  return {
    id,
    name,
    font,
    light: { ...CLAY_TOKENS, ...light },
    dark: { ...CLAY_TOKENS, ...light, ...dark },
  };
}

export const PRESETS: Theme[] = [
  // Clay, the default: warm paper, pink accent.
  theme('clay', 'Clay', 'inter', {}, {}),

  // Sumi, warm ink on bone; quiet, editorial.
  theme('sumi', 'Sumi', 'fraunces-sans',
    { ink: '#221f1c', 'ink-soft': '#5a544c', 'ink-faint': '#8d867b', paper: '#f6f3ec', 'paper-panel': '#ece7db', 'paper-line': '#ddd6c6', clay: '#c2563f', 'clay-soft': '#d97a63', 'clay-wash': '#f4ddd3', ochre: '#7d6a3a', 'ochre-soft': '#c9ad6a', 'ochre-wash': '#efe6cd' },
    { coal: '#1b1a17', 'coal-panel': '#23211d', 'coal-line': '#393530', 'coal-text': '#ece6d8', 'coal-soft': '#a39a88', 'clay-soft': '#e08c74' }),

  // Indigo, cool slate, electric accent.
  theme('indigo', 'Indigo', 'work-sans',
    { ink: '#1f2430', 'ink-soft': '#4c5567', 'ink-faint': '#828b9c', paper: '#f6f7fb', 'paper-panel': '#edeff6', 'paper-line': '#dde1ec', clay: '#5b5bd6', 'clay-soft': '#8385ec', 'clay-wash': '#e4e4fb', ochre: '#2f8f9d', 'ochre-soft': '#65c4d0', 'ochre-wash': '#d7eef1' },
    { coal: '#14161d', 'coal-panel': '#1c1f29', 'coal-line': '#2c3140', 'coal-text': '#e4e7f0', 'coal-soft': '#9aa3b6', 'clay-soft': '#9295f2' }),

  // Forest, deep green, mossy neutrals.
  theme('forest', 'Forest', 'spline',
    { ink: '#1e2620', 'ink-soft': '#4a574d', 'ink-faint': '#7e8a80', paper: '#f4f7f2', 'paper-panel': '#e8efe5', 'paper-line': '#d6e0d2', clay: '#2f8f5b', 'clay-soft': '#5bb681', 'clay-wash': '#dcefe3', ochre: '#a9761d', 'ochre-soft': '#d9ad5c', 'ochre-wash': '#f0e6cc' },
    { coal: '#121712', 'coal-panel': '#1a211a', 'coal-line': '#2a342a', 'coal-text': '#e2ebe1', 'coal-soft': '#93a094', 'clay-soft': '#6cc790' }),

  // Mono, near-grayscale with a single restrained accent.
  theme('mono', 'Mono', 'ibm-plex',
    { ink: '#1c1c1e', 'ink-soft': '#55555a', 'ink-faint': '#8a8a90', paper: '#fafafa', 'paper-panel': '#f0f0f1', 'paper-line': '#e1e1e3', clay: '#3a3a3c', 'clay-soft': '#6a6a6e', 'clay-wash': '#e7e7e9', ochre: '#7a7a7e', 'ochre-soft': '#a8a8ad', 'ochre-wash': '#ededef' },
    { coal: '#151517', 'coal-panel': '#1e1e20', 'coal-line': '#303033', 'coal-text': '#ececee', 'coal-soft': '#9a9aa0', clay: '#d4d4d8', 'clay-soft': '#a6a6ab', 'clay-wash': '#2a2a2d' }),

  // Sakura, soft pinks, brighter than Clay, gentler surfaces.
  theme('sakura', 'Sakura', 'libre-franklin',
    { ink: '#3a2b30', 'ink-soft': '#6e565d', 'ink-faint': '#9c838a', paper: '#fdf6f8', 'paper-panel': '#f8ebef', 'paper-line': '#efdae1', clay: '#e15a9c', 'clay-soft': '#f088bb', 'clay-wash': '#fce0ee', ochre: '#b07a4f', 'ochre-soft': '#ddae84', 'ochre-wash': '#f4e6d8' },
    { coal: '#1c1418', 'coal-panel': '#251a20', 'coal-line': '#3a2a32', 'coal-text': '#f0e2e8', 'coal-soft': '#b39aa3', 'clay-soft': '#f49ac8' }),

  // Dune, sand + terracotta, low-glare warm light.
  theme('dune', 'Dune', 'source-sans',
    { ink: '#2c2620', 'ink-soft': '#5e5446', 'ink-faint': '#928570', paper: '#faf6ee', 'paper-panel': '#f1eadc', 'paper-line': '#e2d8c4', clay: '#cc6b3a', 'clay-soft': '#e08e63', 'clay-wash': '#f6e2d3', ochre: '#9a7b22', 'ochre-soft': '#cdaa57', 'ochre-wash': '#efe5c9' },
    { coal: '#191510', 'coal-panel': '#221d16', 'coal-line': '#372f24', 'coal-text': '#ece2d2', 'coal-soft': '#a89c86', 'clay-soft': '#e89a72' }),

  // Tide, teal + deep navy, fresh and high-contrast.
  theme('tide', 'Tide', 'space-grotesk',
    { ink: '#16282b', 'ink-soft': '#3f5a5e', 'ink-faint': '#7a9296', paper: '#f1f8f8', 'paper-panel': '#e3f0f0', 'paper-line': '#cfe2e2', clay: '#0e8d8d', 'clay-soft': '#3fb4b4', 'clay-wash': '#d3eded', ochre: '#b06a18', 'ochre-soft': '#e0a455', 'ochre-wash': '#f3e4cb' },
    { coal: '#0c1618', 'coal-panel': '#142022', 'coal-line': '#21353a', 'coal-text': '#dceced', 'coal-soft': '#8aa3a6', 'clay-soft': '#4ec5c5' }),

  // Plum, muted violet, dusk neutrals.
  theme('plum', 'Plum', 'lora',
    { ink: '#2a2230', 'ink-soft': '#564a5e', 'ink-faint': '#8b7f93', paper: '#f8f5fa', 'paper-panel': '#efe9f3', 'paper-line': '#e0d6e6', clay: '#8b5cf0', 'clay-soft': '#a982f3', 'clay-wash': '#eadffb', ochre: '#a06a2c', 'ochre-soft': '#d3a263', 'ochre-wash': '#f0e4d0' },
    { coal: '#16111c', 'coal-panel': '#1f1827', 'coal-line': '#312640', 'coal-text': '#e8e0ef', 'coal-soft': '#a193ad', 'clay-soft': '#b294f5' }),

  // Ember, charcoal-leaning warm, amber accent; reads well in the dark.
  theme('ember', 'Ember', 'system',
    { ink: '#241f1c', 'ink-soft': '#574d46', 'ink-faint': '#8c8079', paper: '#f8f5f1', 'paper-panel': '#efe9e2', 'paper-line': '#e0d7cc', clay: '#d9622e', 'clay-soft': '#e88a5d', 'clay-wash': '#f6ddcd', ochre: '#b58a1c', 'ochre-soft': '#e3bb56', 'ochre-wash': '#f4ebcf' },
    { coal: '#15110e', 'coal-panel': '#1e1813', 'coal-line': '#332821', 'coal-text': '#ece2d6', 'coal-soft': '#a89a8a', 'clay-soft': '#ef9468' }),

  // Marigold, warm cream + mustard gold; cosy and retro. Pairs with Fraunces.
  theme('marigold', 'Marigold', 'fraunces-sans',
    { ink: '#2e2820', 'ink-soft': '#5f5442', 'ink-faint': '#948872', paper: '#fbf7ec', 'paper-panel': '#f3ecda', 'paper-line': '#e6dcc3', clay: '#bd7d1c', 'clay-soft': '#dba63f', 'clay-wash': '#f6e8cc', ochre: '#7c6a2f', 'ochre-soft': '#c3a95f', 'ochre-wash': '#efe7cf' },
    { coal: '#17130c', 'coal-panel': '#201a11', 'coal-line': '#352b1c', 'coal-text': '#ede3d0', 'coal-soft': '#aa9d84', 'clay-soft': '#e4b155' }),

  // Slate, cool blue-grey, crisp and minimal. Pairs with DM Sans.
  theme('slate', 'Slate', 'dm-sans',
    { ink: '#1f242b', 'ink-soft': '#4a545f', 'ink-faint': '#808a95', paper: '#f6f8fa', 'paper-panel': '#eceff3', 'paper-line': '#dde2e8', clay: '#3f6f9f', 'clay-soft': '#6b96be', 'clay-wash': '#dde8f2', ochre: '#5a8a86', 'ochre-soft': '#8fb8b4', 'ochre-wash': '#dcecea' },
    { coal: '#10141a', 'coal-panel': '#171c24', 'coal-line': '#262d38', 'coal-text': '#e2e7ee', 'coal-soft': '#98a2af', 'clay-soft': '#7ba6cf' }),

  // Rose, soft burgundy on blush; elegant. Pairs with Playfair Display.
  theme('rose', 'Rose', 'playfair',
    { ink: '#2e2126', 'ink-soft': '#61505a', 'ink-faint': '#97828d', paper: '#fbf5f6', 'paper-panel': '#f4e9ec', 'paper-line': '#ecd9df', clay: '#b23a5b', 'clay-soft': '#d1667f', 'clay-wash': '#f8dde4', ochre: '#9c7328', 'ochre-soft': '#cda65c', 'ochre-wash': '#f0e5cf' },
    { coal: '#190f13', 'coal-panel': '#22161b', 'coal-line': '#382530', 'coal-text': '#efe0e5', 'coal-soft': '#b59aa2', 'clay-soft': '#dd7e94' }),

  // Grove, 70s avocado + rust; groovy. Pairs with Syne.
  theme('grove', 'Grove', 'syne',
    { ink: '#262619', 'ink-soft': '#55553c', 'ink-faint': '#8a8a6c', paper: '#f7f6ea', 'paper-panel': '#edecd7', 'paper-line': '#ddddbf', clay: '#c0592b', 'clay-soft': '#dc835c', 'clay-wash': '#f5e0d3', ochre: '#6f7a24', 'ochre-soft': '#a7b25a', 'ochre-wash': '#e9edcb' },
    { coal: '#14140c', 'coal-panel': '#1c1c12', 'coal-line': '#2e2e1e', 'coal-text': '#e9e8d3', 'coal-soft': '#a0a086', 'clay-soft': '#e89168' }),

  // Mint, fresh seafoam, emerald accent. Pairs with Outfit.
  theme('mint', 'Mint', 'outfit',
    { ink: '#1c2724', 'ink-soft': '#47574f', 'ink-faint': '#7c8d84', paper: '#f1faf6', 'paper-panel': '#e4f2eb', 'paper-line': '#d0e6da', clay: '#10a37a', 'clay-soft': '#43c19c', 'clay-wash': '#d3efe4', ochre: '#b0862a', 'ochre-soft': '#ddb464', 'ochre-wash': '#f3e9d1' },
    { coal: '#0d1613', 'coal-panel': '#14201b', 'coal-line': '#21352c', 'coal-text': '#dcece5', 'coal-soft': '#8aa398', 'clay-soft': '#4fc9a4' }),

  // Cocoa, deep chocolate browns; warm and low-glare. Pairs with Crimson Pro.
  theme('cocoa', 'Cocoa', 'crimson-pro',
    { ink: '#2b211b', 'ink-soft': '#5c4d42', 'ink-faint': '#948572', paper: '#f8f3ec', 'paper-panel': '#efe7db', 'paper-line': '#e2d5c4', clay: '#8a5a3c', 'clay-soft': '#b0805e', 'clay-wash': '#ecdccd', ochre: '#86671f', 'ochre-soft': '#ceac5c', 'ochre-wash': '#f1e8ce' },
    { coal: '#150f0a', 'coal-panel': '#1e150e', 'coal-line': '#33251a', 'coal-text': '#ece0d2', 'coal-soft': '#a89684', 'clay-soft': '#c08a66' }),

  // Noir, crisp near-mono with one electric-blue pop. Pairs with Space Mono.
  theme('noir', 'Noir', 'space-mono',
    { ink: '#16181d', 'ink-soft': '#454952', 'ink-faint': '#7c828d', paper: '#fbfbfc', 'paper-panel': '#f0f1f3', 'paper-line': '#e0e2e6', clay: '#2f6bff', 'clay-soft': '#6a93ff', 'clay-wash': '#dde6ff', ochre: '#7a7f8a', 'ochre-soft': '#adb2bc', 'ochre-wash': '#ebedf0' },
    { coal: '#0c0d10', 'coal-panel': '#131519', 'coal-line': '#232631', 'coal-text': '#e6e8ee', 'coal-soft': '#979ca7', 'clay-soft': '#7ba0ff' }),

  // Aurora, midnight navy with a teal-to-violet pair. The only preset whose two
  // accents sit on opposite sides of the wheel, so chips and charts separate hard.
  theme('aurora', 'Aurora', 'dm-sans',
    { ink: '#1a2230', 'ink-soft': '#46536b', 'ink-faint': '#7d8aa3', paper: '#f4f7fb', 'paper-panel': '#e9eef7', 'paper-line': '#d8e0ee', clay: '#1d8f86', 'clay-soft': '#4fbcb2', 'clay-wash': '#d5efec', ochre: '#7c5cd6', 'ochre-soft': '#a68ee8', 'ochre-wash': '#e6ddfa' },
    { coal: '#0b1018', 'coal-panel': '#121a26', 'coal-line': '#1f2b3d', 'coal-text': '#dfe8f5', 'coal-soft': '#8fa0ba', 'clay-soft': '#4fd0c6' }),

  // Terminal, phosphor green. Light mode is a pale printout, dark mode is the
  // CRT: near-black surfaces and a green that glows rather than sits.
  theme('terminal', 'Terminal', 'space-mono',
    { ink: '#10241a', 'ink-soft': '#3c5c4a', 'ink-faint': '#6f8f7d', paper: '#f2f7f3', 'paper-panel': '#e6efe8', 'paper-line': '#d3e2d8', clay: '#0f7d43', 'clay-soft': '#33a566', 'clay-wash': '#d6efdf', ochre: '#6b7a2f', 'ochre-soft': '#a3b566', 'ochre-wash': '#e9f0d5' },
    { coal: '#050806', 'coal-panel': '#0a120c', 'coal-line': '#16281b', 'coal-text': '#b9f5cc', 'coal-soft': '#6fae83', clay: '#2fd977', 'clay-soft': '#6df3a4', 'clay-wash': '#0f2417' }),

  // Bordeaux, deep wine on cream. The one genuinely RED preset; clay is a pink
  // and rose is a blush, neither of which reads as red next to text.
  theme('bordeaux', 'Bordeaux', 'lora',
    { ink: '#2a1a1d', 'ink-soft': '#5c4247', 'ink-faint': '#8f7377', paper: '#faf5f2', 'paper-panel': '#f2e8e5', 'paper-line': '#e5d6d2', clay: '#8c2f39', 'clay-soft': '#b4535e', 'clay-wash': '#f0d9dc', ochre: '#8a6a2c', 'ochre-soft': '#c2a066', 'ochre-wash': '#f0e6d0' },
    { coal: '#150e10', 'coal-panel': '#1e1417', 'coal-line': '#332226', 'coal-text': '#ecdfe0', 'coal-soft': '#ad9296', 'clay-soft': '#c96d78' }),

  // Arctic, cold and crisp. Everything else warms the paper slightly; this one
  // pushes it blue, which is the difference between "quiet" and "clinical".
  theme('arctic', 'Arctic', 'inter',
    { ink: '#14202b', 'ink-soft': '#415465', 'ink-faint': '#7b8d9e', paper: '#f7fbfd', 'paper-panel': '#ecf3f8', 'paper-line': '#d9e6ef', clay: '#3b7ea1', 'clay-soft': '#6aa5c3', 'clay-wash': '#dbeaf3', ochre: '#5f7d8c', 'ochre-soft': '#9ab4c0', 'ochre-wash': '#e5eef2' },
    { coal: '#0a1016', 'coal-panel': '#101922', 'coal-line': '#1d2b38', 'coal-text': '#e0ecf4', 'coal-soft': '#90a5b6', 'clay-soft': '#79b6d6' }),

  // Synth, magenta and cyan over violet-black. Loud on purpose: every other
  // preset is designed to disappear, and sometimes you want the opposite.
  theme('synth', 'Synth', 'space-grotesk',
    { ink: '#241a2e', 'ink-soft': '#55446a', 'ink-faint': '#8a7aa0', paper: '#faf6ff', 'paper-panel': '#f2ebfa', 'paper-line': '#e4d9f2', clay: '#c21f90', 'clay-soft': '#e05cb5', 'clay-wash': '#fbdcf1', ochre: '#1f8fa9', 'ochre-soft': '#5fc6dd', 'ochre-wash': '#d5eff5' },
    { coal: '#0d0716', 'coal-panel': '#150c22', 'coal-line': '#251638', 'coal-text': '#efe2ff', 'coal-soft': '#a894c4', clay: '#f13cb4', 'clay-soft': '#ff7ad0' }),
];

export const CLAY: Theme = PRESETS[0];

// The optional families below are bundled in public/fonts and declared in one
// stylesheet, fetched on demand the first time the picker or a theme asks for
// one of them. No font CDN: a self-hosted install should not announce itself to
// a third party, and it has to work with no route out at all.
const EXTRA = '/fonts/extra.css';
export const FONTS: FontDef[] = [
  // Always available: declared in index.css, so no stylesheet to fetch.
  { key: 'inter', label: 'Inter', stack: "'Inter', system-ui, sans-serif", category: 'Sans', vibe: 'Clean' },
  { key: 'system', label: 'System', stack: 'system-ui, -apple-system, "Segoe UI", sans-serif', category: 'Sans', vibe: 'Clean' },
  { key: 'fraunces-sans', label: 'Fraunces', stack: "'Fraunces', Georgia, serif", category: 'Serif', vibe: 'Retro' },
  // The OG monospace, bundled since day one for code; selectable as the whole-UI
  // font for a terminal look.
  { key: 'jetbrains-mono', label: 'JetBrains Mono', stack: "'JetBrains Mono', ui-monospace, monospace", category: 'Mono', vibe: 'Techy' },

  // Sans
  { key: 'source-sans', label: 'Source Sans', stack: "'Source Sans 3', system-ui, sans-serif", url: EXTRA, category: 'Sans', vibe: 'Clean' },
  { key: 'work-sans', label: 'Work Sans', stack: "'Work Sans', system-ui, sans-serif", url: EXTRA, category: 'Sans', vibe: 'Clean' },
  { key: 'libre-franklin', label: 'Libre Franklin', stack: "'Libre Franklin', system-ui, sans-serif", url: EXTRA, category: 'Sans', vibe: 'Clean' },
  { key: 'dm-sans', label: 'DM Sans', stack: "'DM Sans', system-ui, sans-serif", url: EXTRA, category: 'Sans', vibe: 'Clean' },
  { key: 'spline', label: 'Spline Sans', stack: "'Spline Sans', system-ui, sans-serif", url: EXTRA, category: 'Sans', vibe: 'Modern' },
  { key: 'sora', label: 'Sora', stack: "'Sora', system-ui, sans-serif", url: EXTRA, category: 'Sans', vibe: 'Modern' },
  { key: 'outfit', label: 'Outfit', stack: "'Outfit', system-ui, sans-serif", url: EXTRA, category: 'Sans', vibe: 'Modern' },
  { key: 'plus-jakarta', label: 'Plus Jakarta Sans', stack: "'Plus Jakarta Sans', system-ui, sans-serif", url: EXTRA, category: 'Sans', vibe: 'Modern' },
  { key: 'archivo', label: 'Archivo', stack: "'Archivo', system-ui, sans-serif", url: EXTRA, category: 'Sans', vibe: 'Modern' },
  { key: 'poppins', label: 'Poppins', stack: "'Poppins', system-ui, sans-serif", url: EXTRA, category: 'Sans', vibe: 'Playful' },
  { key: 'ibm-plex', label: 'IBM Plex Sans', stack: "'IBM Plex Sans', system-ui, sans-serif", url: EXTRA, category: 'Sans', vibe: 'Techy' },
  { key: 'space-grotesk', label: 'Space Grotesk', stack: "'Space Grotesk', system-ui, sans-serif", url: EXTRA, category: 'Sans', vibe: 'Techy' },
  { key: 'bricolage', label: 'Bricolage Grotesque', stack: "'Bricolage Grotesque', system-ui, sans-serif", url: EXTRA, category: 'Sans', vibe: 'Retro' },

  // Serif
  { key: 'lora', label: 'Lora', stack: "'Lora', Georgia, serif", url: EXTRA, category: 'Serif', vibe: 'Elegant' },
  { key: 'playfair', label: 'Playfair Display', stack: "'Playfair Display', Georgia, serif", url: EXTRA, category: 'Serif', vibe: 'Elegant' },
  { key: 'crimson-pro', label: 'Crimson Pro', stack: "'Crimson Pro', Georgia, serif", url: EXTRA, category: 'Serif', vibe: 'Elegant' },
  { key: 'instrument-serif', label: 'Instrument Serif', stack: "'Instrument Serif', Georgia, serif", url: EXTRA, category: 'Serif', vibe: 'Retro' },

  // Rounded
  { key: 'quicksand', label: 'Quicksand', stack: "'Quicksand', system-ui, sans-serif", url: EXTRA, category: 'Rounded', vibe: 'Retro' },
  { key: 'comfortaa', label: 'Comfortaa', stack: "'Comfortaa', system-ui, sans-serif", url: EXTRA, category: 'Rounded', vibe: 'Retro' },
  { key: 'nunito', label: 'Nunito', stack: "'Nunito', system-ui, sans-serif", url: EXTRA, category: 'Rounded', vibe: 'Playful' },
  { key: 'fredoka', label: 'Fredoka', stack: "'Fredoka', system-ui, sans-serif", url: EXTRA, category: 'Rounded', vibe: 'Playful' },

  // Display
  { key: 'syne', label: 'Syne', stack: "'Syne', system-ui, sans-serif", url: EXTRA, category: 'Display', vibe: 'Retro' },
  { key: 'unbounded', label: 'Unbounded', stack: "'Unbounded', system-ui, sans-serif", url: EXTRA, category: 'Display', vibe: 'Playful' },

  // Mono
  { key: 'space-mono', label: 'Space Mono', stack: "'Space Mono', ui-monospace, monospace", url: EXTRA, category: 'Mono', vibe: 'Retro' },
];

export function fontDef(key: FontKey): FontDef {
  return FONTS.find((f) => f.key === key) ?? FONTS[0];
}

// --- Hex parsing ------------------------------------------------------------

// Accept #abc, #aabbcc, or rgb(r,g,b) → canonical #rrggbb. Anything else → null.
export function normalizeHex(input: string): string | null {
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) {
    const [r, g, b] = m[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return `#${m[1]}`;
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(s);
  if (m) {
    const ch = [m[1], m[2], m[3]].map((n) => Math.max(0, Math.min(255, Number(n))));
    if (ch.every((n) => Number.isFinite(n))) return `#${ch.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  }
  return null;
}

// '#rrggbb' → 'r g b' channels for the CSS var (Tailwind reads it as
// rgb(var(--x) / <alpha>), so the var must be space-separated channels).
export function hexToChannels(hex: string): string {
  const h = normalizeHex(hex) ?? '#000000';
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return `${r} ${g} ${b}`;
}

// --- Apply / resolve --------------------------------------------------------

// Anything with a CSSStyleDeclaration-shaped `style`. Typed loosely so the pure
// tests can pass a stub root without a DOM.
interface StyleRoot {
  style: { setProperty(prop: string, value: string): void };
}

// Write the active token set + font onto a root element's inline style. Inline
// vars beat both the :root and any stylesheet rule, so this is the live channel.
// The serif display default, matching index.css :root, used when no custom font
// drives the title/headings.
const DEFAULT_DISPLAY = "'Fraunces', Georgia, serif";

export function applyTokens(root: StyleRoot, tokens: ThemeTokens, fontStack?: string, displayStack?: string): void {
  for (const key of TOKEN_KEYS) {
    root.style.setProperty(`--${key}`, hexToChannels(tokens[key]));
  }
  if (fontStack) root.style.setProperty('--font-sans', fontStack);
  // The page title and headings read --font-display. Drive it with the picked
  // font so they change too; the default keeps the serif so the unthemed look
  // is unchanged.
  root.style.setProperty('--font-display', displayStack ?? DEFAULT_DISPLAY);
}

// The active token set for the current mode, with a per-token fall back to
// Clay so a corrupt or partial saved theme can never leave a var unset.
export function resolveTheme(saved: Theme | null | undefined, mode: 'light' | 'dark'): ThemeTokens {
  const base = mode === 'dark' ? CLAY.dark : CLAY.light;
  const set = saved ? (mode === 'dark' ? saved.dark : saved.light) : undefined;
  const out = {} as ThemeTokens;
  for (const key of TOKEN_KEYS) {
    const v = set?.[key];
    out[key] = (v && normalizeHex(v)) || base[key];
  }
  return out;
}

// --- Contrast ---------------------------------------------------------------
// WCAG relative luminance + contrast ratio, so the customizer can warn when a
// token pair becomes unreadable (e.g. ink on paper). Inputs are hex.

function luminance(hex: string): number {
  const h = normalizeHex(hex) ?? '#000000';
  const chan = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(1 + i, 3 + i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// Body text (ink) on the page (paper) below the WCAG AA large-text floor (3:1)
// is the cheapest "you've made this unreadable" signal worth flagging.
export function lowContrast(tokens: ThemeTokens): boolean {
  return contrastRatio(tokens.ink, tokens.paper) < 3;
}

// --- Persistence ------------------------------------------------------------
// One blob, per-browser, never synced. Same read/try-catch shape as useTheme.

const STORAGE_KEY = 'waypoint:appearance';

export interface Appearance {
  theme: Theme; // the active theme (a preset or a customized copy)
  font: FontKey;
}

export function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Appearance>;
      if (parsed.theme && parsed.theme.light && parsed.theme.dark) {
        const font = parsed.font ?? parsed.theme.font ?? 'inter';
        return { theme: parsed.theme as Theme, font };
      }
    }
  } catch {
    // private mode / malformed, fall through to Clay.
  }
  return { theme: CLAY, font: 'inter' };
}

export function saveAppearance(a: Appearance): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
  } catch {
    // storage full / unavailable, the live vars still hold for the session.
  }
}

// Lazy-load a font stylesheet once (deduped by href). Bundled fonts pass no url.
const loadedFonts = new Set<string>();
export function ensureFontLoaded(url: string | undefined): void {
  if (!url || loadedFonts.has(url) || typeof document === 'undefined') return;
  loadedFonts.add(url);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);
}

// Apply a saved appearance to <html> for the current mode. Used on boot (before
// React renders, to avoid a flash) and whenever the theme/font/mode changes.
export function applyAppearance(a: Appearance, mode: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  const def = fontDef(a.font);
  ensureFontLoaded(def.url);
  // Keep the serif display font for the default Inter; any other pick drives the
  // title and headings too, so a font change is visible everywhere.
  const displayStack = a.font === 'inter' ? undefined : def.stack;
  applyTokens(document.documentElement, resolveTheme(a.theme, mode), def.stack, displayStack);
}

// Read the saved light/dark mode the same way useTheme does, for boot apply.
export function bootMode(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem('waypoint-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}
