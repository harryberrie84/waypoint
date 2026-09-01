/** @type {import('tailwindcss').Config} */
// Color tokens read CSS custom properties so a per-device theme can recolor the
// whole app at runtime (see src/lib/theme.ts). The vars hold space-separated RGB
// channels, `rgb(var(--clay) / <alpha-value>)`, which is what keeps Tailwind's
// opacity utilities (bg-clay/15, bg-coal/30, …) working. Default values live on
// :root in index.css and hold the Clay defaults.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: v('ink'), soft: v('ink-soft'), faint: v('ink-faint') },
        paper: { DEFAULT: v('paper'), panel: v('paper-panel'), line: v('paper-line') },
        coal: { DEFAULT: v('coal'), panel: v('coal-panel'), line: v('coal-line'), text: v('coal-text'), soft: v('coal-soft') },
        clay: { DEFAULT: v('clay'), soft: v('clay-soft'), wash: v('clay-wash') },
        // Ochre, a warm complement to the clay pink, for small accents: empty
        // states, chips, the auth flourish. soft = dark-mode text, wash = pale
        // chip/empty-state fill. Not for body text or large surfaces.
        ochre: { DEFAULT: v('ochre'), soft: v('ochre-soft'), wash: v('ochre-wash') },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
