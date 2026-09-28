# Waypoint visual guide

How a page, a block and a widget should look. Written from what the app already
does most of the time, so following it makes things consistent rather than new.
The class strings for the widget pieces live in `src/editor/widgetStyle.ts`; use
those instead of retyping them.

## The idea

A page is a document first. Text sets the column; everything else sits inside
that column and looks like it belongs to the same sheet of paper. Widgets are
quiet cards with one accent colour, not dashboards. Tables are the engine behind
many widgets, and most people should never have to see the engine.

## Colour

Every colour is a token. Tokens hold RGB channels in CSS variables (`:root` in
`src/index.css`), so the 22 themes in `src/lib/theme.ts` can recolour the whole
app and opacity modifiers such as `bg-clay/15` still work.

| Token | Use |
|---|---|
| `ink`, `ink-soft`, `ink-faint` | Text in light mode: body, secondary, hints and placeholders |
| `paper`, `paper-panel`, `paper-line` | Light surfaces: page, raised panel, hairlines |
| `coal`, `coal-panel`, `coal-line` | The same three surfaces in dark mode |
| `coal-text`, `coal-soft` | Body and secondary text in dark mode |
| `clay`, `clay-soft`, `clay-wash` | The accent: icons, primary buttons, active chips, progress, focus |
| `ochre`, `ochre-soft`, `ochre-wash` | Small warm accents only: empty states, a chip. Never body text or a large surface |

Rules:

- Pair every light class with its dark twin on the same element:
  `text-ink dark:text-coal-text`, `text-ink-faint dark:text-coal-soft`,
  `border-paper-line dark:border-coal-line`. There is no dark variable block, so a
  missing `dark:` class is a visible bug.
- No literal hex in components. If a colour is not a token, it does not belong
  in the chrome. User-chosen colours (a callout tint, a tier colour, a pin) are the
  exception, since they are data.
- Status colours come from the Tailwind palette and mean one thing each:
  `emerald` done or settled, `amber` due soon or needs a look, `rose` overdue,
  an error or delete. Use the 500 shade for text and icons and the 500/10 fill for
  a background (`bg-rose-500/10 text-rose-500`). Do not use `red`, `sky` or
  `violet` for status.
- Hover on a surface is `hover:bg-paper-panel dark:hover:bg-coal-line`. Hover on
  something clickable that is text or an icon is `hover:text-clay`.

## Type

| Role | Class |
|---|---|
| Page title, h1, h2 | `font-display` (Fraunces), set by the editor styles |
| Body text in the editor | 16px Inter, line height 1.7 |
| Widget title | `text-sm font-semibold` |
| Widget body, list items | `text-sm` |
| Buttons, meta, chips | `text-xs`, chips `text-[11px]` |
| Section labels | `text-[11px] font-semibold uppercase tracking-wide`, faint |
| Numbers that change | `font-mono tabular-nums`, so digits do not jump |

Keep `text-[10px]` for dense secondary data only (a table cell badge, a legend).
Big numbers in a stat or countdown use `font-display` at `text-2xl` or
`text-3xl`, never `font-mono` at that size.

## Layout

- **One column.** The editor caps every top-level block at 48rem, the same width
  as the text (`.tiptap > *` in `src/index.css`). A block never runs past the
  right edge of the paragraph above it. Something wider than the column, like a
  table with many fields, scrolls sideways inside its own box; the page itself
  never scrolls sideways, at any width.
- Widgets sit in the flow with `my-3`. Do not add outer margins inside a widget
  to push it around.
- Spacing steps are Tailwind's: `gap-1` inside a tight group (icon and label),
  `gap-2` between items in a row, `gap-3` between sections. `space-y-1` for list
  rows, `space-y-2` for cards in a list.
- At phone width everything still fits in one column with a 16px gutter.
  Toolbars wrap onto a second line instead of pushing the page wider, and buttons
  keep their icon while hiding their label (`hidden sm:inline` on the label).

## The widget shell

Every widget, whether it keeps its data in the page or in a table, has the same
three parts.

```
┌ card ──────────────────────────────────────────────┐
│ ● Title                         meta   [tools] [⋯] │  header
│ ─ optional progress bar or filter chips ─          │
│ body: rows, cards, a big number                    │
│ [ + Add … ]                                        │  footer
└────────────────────────────────────────────────────┘
```

- **Card**: `widgetCard`, which is `rounded-xl`, a hairline border, a
  translucent panel fill and no shadow. A widget that celebrates something (a
  countdown, readiness, a vote) may use `widgetHero`, the clay wash gradient.
  Never `rounded-2xl`, never a solid `bg-paper`, never a shadow on something that
  sits in the page. Shadows are for things that float: popovers `shadow-xl`,
  dialogs and toasts `shadow-2xl`.
- **Header**: `widgetHeader`. A clay icon (`widgetIcon`, 16px), the title
  (`widgetTitle`, truncates rather than wraps), then meta on the right
  (`widgetMeta`: "3/12 packed", "4 due", a total), then tools. Tools are icon
  buttons (`iconButton`, 14px icons) or small text buttons (`quietButton`).
- **Body**: `widgetBody` padding (`p-3`). Rows use `itemRow`. A progress bar is
  `h-1.5 rounded-full` with a `bg-clay` fill on `bg-paper-line`.
- **Footer**: the add action is a dashed full-width button (`addRowButton`) with
  a plus icon and a verb: "Add item", "Add stay".
- **Empty**: when there is nothing yet, say what goes here in one sentence and
  give the add button. Use `emptyState` for a widget that is not set up at all.

### Widgets over a table

Many widgets store their rows in a table (budget, packing, bills, groceries,
routines and the rest of the presets). The rule:

1. The widget shows its own view first: the rows as the thing they are (stays,
   bills due, meals by day), in the shell above.
2. The table is one click away, behind a table icon in the header. That shows
   the full table with its views, filters and fields, in place, and the same icon
   folds it back. The choice is per person and per visit; it does not change the
   page for anyone else.
3. Editing the common things (tick, rename, add, delete) works in the widget
   view. Anything structural (fields, filters, formulas) happens in the table.
4. A table you inserted as a table (Table, Board, Calendar, Linked table) stays a
   table. Only the named presets become widgets.

## Controls

| Control | Class |
|---|---|
| Primary action | `primaryButton`: clay fill, white text, `rounded-lg` |
| Secondary action | `rounded-lg border border-paper-line px-2.5 py-1 text-xs text-ink-soft hover:bg-paper-panel` plus dark twins |
| Quiet or ghost | `quietButton` |
| Icon only | `iconButton`, with a `title` and `aria-label` naming the action |
| Delete | an icon button that turns `hover:text-rose-500` |
| Chip or filter | `chip` plus `chipOn` or `chipOff` |
| Text input | `rounded-lg border border-paper-line bg-paper px-2 py-1 text-sm focus:border-clay`, dark `bg-coal-panel` |
| Inline edit in a widget | a bare input: `bg-transparent outline-none`, inherits the text style |

Every control that only has an icon gets a `title` and an `aria-label`. Inputs
show focus with `focus:border-clay`.

## Copy

- Sentence case. "Add stay", not "Add Stay".
- No em-dashes anywhere, in the UI or in docs. Use a comma, a colon, a full stop
  or a middle dot (`·`) as a separator in meta: "4 nights · 2 left".
- On-screen text never names an internal field, a source file or a command. Say
  what the person gets: "Something went wrong saving this", not "PATCH failed".
  Name a file format only where the person has to produce or pick that format
  (an import from another app, a spreadsheet export).
- A real ellipsis in placeholders and in progress text: "Add an item…",
  "Thinking…".
- Numbers carry their unit: "3 days left", "SEK 1,200".
- Empty states say what goes here, not that nothing is here.

## Known drift to fix when you touch the file

- Inputs split between `dark:bg-coal` and `dark:bg-coal-panel`; use `coal-panel`.

Deliberate exceptions: the callout tint (a user colour, so its hover darkens
whatever colour was picked), weather icons in sky blue, GitHub's own pull request
colours on a GitHub card, and solid surfaces on anything that can go full screen
(a shared map or table).
