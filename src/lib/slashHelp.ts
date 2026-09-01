// Reference catalog for the slash menu, surfaced in the Help panel. This is
// hand-kept to match editor/SlashCommands.tsx, when a command is added there,
// add it here too. Triggers are the shorthand you'd actually type; the menu
// also matches on title and keywords, so most blocks answer to several.

export interface HelpCommand {
  trigger: string;
  name: string;
  desc: string;
  // Optional second line for syntax or a gotcha worth calling out.
  note?: string;
}

export interface HelpSection {
  id: string;
  title: string;
  blurb: string;
  commands: HelpCommand[];
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'text',
    title: 'Text & structure',
    blurb: 'The plain writing blocks. Each has a shorthand, but typing any keyword filters the menu just as well.',
    commands: [
      { trigger: '/h1', name: 'Heading 1', desc: 'Top-level section title.' },
      { trigger: '/h2', name: 'Heading 2', desc: 'The next level down.' },
      { trigger: '/h3', name: 'Heading 3', desc: 'Smallest heading.' },
      { trigger: '/bullet', name: 'Bulleted list', desc: 'An unordered list.' },
      { trigger: '/number', name: 'Numbered list', desc: 'An ordered list.' },
      { trigger: '/todo', name: 'To-do', desc: 'A checklist with checkboxes.' },
      { trigger: '/quote', name: 'Quote', desc: 'An indented callout.' },
      { trigger: '/code', name: 'Code block', desc: 'Monospaced, with no formatting applied to what you type.' },
      { trigger: '/divider', name: 'Divider', desc: 'A horizontal rule between sections.' },
      {
        trigger: '/toggle',
        name: 'Toggle',
        desc: 'A collapsible section. The first line is the title and stays; the rest folds away on the chevron.',
      },
      { trigger: '/toc', name: 'Table of contents', desc: "A live outline of the page's headings; click one to jump to it." },
      { trigger: '/math', name: 'Math', desc: 'A TeX equation, rendered with KaTeX as you type.' },
      {
        trigger: '/diagram',
        name: 'Diagram',
        desc: 'A flow or sequence drawn from Mermaid text.',
        note: 'Start with flowchart TD or sequenceDiagram, then describe the nodes.',
      },
      {
        trigger: '/synced',
        name: 'Synced page',
        desc: "A live read-only mirror of another page. Edit the source and every mirror updates.",
        note: 'Good for shared house rules or packing basics; use Open to edit at the source.',
      },
      {
        trigger: '/image',
        name: 'Image',
        desc: 'Upload or paste a picture.',
        note: 'Large ones are downscaled to fit; anything still over ~2 MB is rejected.',
      },
      {
        trigger: '/file',
        name: 'File',
        desc: 'Attach a PDF, ticket or boarding pass. It shows as a download chip.',
        note: 'Capped at ~1.5 MB so it fits inside the page.',
      },
      {
        trigger: '/page',
        name: 'Page',
        desc: 'Make a sub-page under this one and drop a live link to it here.',
        note: 'You stay on the current page instead of jumping to the new one.',
      },
    ],
  },
  {
    id: 'tools',
    title: 'Quick tools',
    blurb: 'Small things that compute as you write. Add the bit after the colon to feed them.',
    commands: [
      {
        trigger: '/date',
        name: 'Date',
        desc: 'Insert a date written in words.',
        note: '/date:next friday, /date:in 3 weeks, /date:25 dec. Add a time like 9am for one.',
      },
      { trigger: '/calc', name: 'Calculator', desc: 'Work out a sum in place.', note: '/calc:2+3*4, /calc:(1200+800)/2.' },
      {
        trigger: '/convert',
        name: 'Convert',
        desc: 'Convert a currency at the live rate.',
        note: '/convert:30000 jpy, or /convert:50 eur to sek. Defaults to your base currency.',
      },
      {
        trigger: '/timer',
        name: 'Timer',
        desc: 'A countdown you start in the page.',
        note: 'Set the minutes, then start, pause or reset. It keeps time even if you reload.',
      },
    ],
  },
  {
    id: 'db',
    title: 'Databases & views',
    blurb: 'Each spins up one relational table and opens it in a different view. The rows are the same records underneath, so switching views never copies data.',
    commands: [
      { trigger: '/table', name: 'Table', desc: 'The plain grid.' },
      {
        trigger: '/linked table',
        name: 'Linked table',
        desc: 'Show a table that already exists on another page, with its own filters and view. The rows are shared, so the same database can appear on many pages each filtered differently (one prefecture per page, only the unvisited, and so on).',
        note: 'Pick the table, then filter or sort it from its toolbar; the source and the other copies are untouched.',
      },
      { trigger: '/board', name: 'Board', desc: 'Kanban columns grouped by a status field.' },
      { trigger: '/calendar', name: 'Calendar', desc: 'Rows dropped onto a month grid by their date.' },
      { trigger: '/timeline', name: 'Timeline', desc: 'Gantt bars drawn from start and end dates.' },
      { trigger: '/gallery', name: 'Gallery', desc: 'Rows shown as cards.' },
      { trigger: '/map', name: 'Map', desc: 'Rows with coordinates pinned on a map.' },
    ],
  },
  {
    id: 'trip',
    title: 'Trip presets',
    blurb: 'Tables that already have the right columns and view for a travel job. Same database engine as above, set up for you.',
    commands: [
      { trigger: '/accommodation', name: 'Accommodation', desc: 'Hotels and Airbnbs with check-in, check-out, nights and cost.' },
      { trigger: '/journal', name: 'Journal', desc: 'A photo travelogue laid out as a gallery.' },
      { trigger: '/itinerary', name: 'Itinerary route', desc: 'Stops pinned on a map and joined into a route, day by day.' },
      { trigger: '/transport', name: 'Transport', desc: 'Flights, trains, buses and ferries with times and booking refs.' },
      { trigger: '/schedule', name: 'Day schedule', desc: 'One day split hour by hour.' },
      {
        trigger: '/budget',
        name: 'Budget',
        desc: 'Expenses with who paid and how each splits.',
        note: 'A live settle-up under the grid works out who owes whom.',
      },
      { trigger: '/packing', name: 'Packing list', desc: 'A checklist with priority and a packed-% readout.' },
      { trigger: '/reservation', name: 'Reservation', desc: 'A single booking card (flight / stay / train / ticket) with a confirmation number and a live countdown. The one-off sibling of /reservations; same widget, single mode.' },
    ],
  },
  {
    id: 'live',
    title: 'Interactive blocks',
    blurb: 'Live widgets you and your collaborators act on, kept in sync between everyone on the page.',
    commands: [
      {
        trigger: '/poll',
        name: 'Poll',
        desc: 'Vote on a date, place or plan, one row per option, single or multiple choice.',
        note: 'Votes are stored as rows, so two people voting at once won\u2019t overwrite each other.',
      },
      {
        trigger: '/form:travel-stop',
        name: 'Form',
        desc: 'A reusable set of fields shown as a form. Pick any key after the colon.',
        note: 'Blocks sharing a key share one schema, so editing the fields updates them all.',
      },
      { trigger: '/place', name: 'Place', desc: 'A card with a city\u2019s local time, weather and date, kept current.' },
      { trigger: '/weather', name: 'Weather', desc: 'A multi-day forecast for a place: conditions plus high/low per day, so an over-planned wet day is obvious. Pick 3, 7, 10 or 14 days.', note: 'Free, keyless Open-Meteo; only forecasts about 16 days out.' },
      { trigger: '/bookmark', name: 'Bookmark', desc: 'Paste a URL, get a link card with its title and preview.' },
      {
        trigger: '/currency',
        name: 'Currency',
        desc: 'One amount shown in every currency you add, at the latest rate the app has. Pin a rate you were actually quoted to see how far off it is, and swap which currency the amount is held in.',
        note: 'Also a page tab. Rates come from a free keyless source that publishes about daily, so the header says when they are from; once fetched they keep working offline.',
      },
      { trigger: '/countdown', name: 'Countdown', desc: 'Days left until a date you set. Hold several at once, each with its own label and emoji, and add a cover photo to turn one into a hero card for the trip.', note: 'A table can read a counter with countdown("label").' },
      { trigger: '/vote', name: 'Vote', desc: 'Decide together: add options and everyone taps ❤️ to vote. Live tallies with bars, the leader gets a trophy, and voters’ avatars show who picked what. Single-choice or vote-for-several.', note: 'Votes live in the block and sync to everyone on the page.' },
      { trigger: '/thisorthat', name: 'This or that', desc: 'A quick two-way call: two big cards, tap your pick. Switching sides moves your vote, the leading side lights up, and avatars show who chose what. Lighter than /vote for the "sushi or ramen tonight?" moments.' },
      { trigger: '/readiness', name: 'Trip readiness', desc: 'A milestone checklist (flights booked, somewhere to stay, passports, insurance, packed) with a big live percentage ring, so the whole crew sees at a glance what is still undone. Starts with a sensible list you can edit.' },
      { trigger: '/packing', name: 'Packing tracker', desc: 'A shared packing checklist with a live "X / Y packed" bar and a per-person filter, so you can split the bag and each tick off your own list.', note: 'A widget, distinct from the /packing list table; ticks sync to everyone.' },
      { trigger: '/reservations', name: 'Reservations (widget)', desc: 'Flights, stays, trains and tickets in one card, each with a confirmation number and a live countdown to the next one. Dated ones also show on the page Calendar tab. The many-bookings sibling of /reservation (which is the single-card version).' },
      { trigger: '/compare', name: 'Compare', desc: 'A side-by-side decision table: options across the top, your own criteria down the side, a star for the pick. You fill the values, nothing invented.' },
      { trigger: '/customcount', name: 'Custom count', desc: 'A countdown-style card that shows the live value of any cell you pick from a named grid (choose the grid, column and row), with your own label, icon and optional prefix/suffix. Use it for a budget total, a remaining count, a status, anything a grid cell holds.', note: 'Holds several cards at once; the value updates whenever the grid does.' },
      {
        trigger: '/split budget',
        name: 'Split budget',
        desc: 'Split costs between anyone (by name, not just members), no table needed. Log who paid and who shares each expense; it shows each person’s net and the fewest transfers to settle up.',
        note: 'A table can read its total with budget("name") and a person’s net with owed("name", "who").',
      },
      { trigger: '/embed', name: 'Embed', desc: 'Drop in a YouTube clip, Google Map, Doc or Spotify track; most embeddable links work.' },
    ],
  },
  {
    id: 'ttrpg',
    title: 'Tabletop & dice',
    blurb: 'For running a tabletop game. An admin turns these on per workspace in the Members panel; they reuse the same table engine as everything else.',
    commands: [
      {
        trigger: '/character',
        name: 'Character sheet',
        desc: 'A form for a PC, abilities, HP, AC and the rest, that becomes its own page.',
        note: 'The page drops onto a mindmap as a node, so you can wire the party together.',
      },
      {
        trigger: '/roll',
        name: 'Roll dice',
        desc: 'Drops a d20.',
        note: 'Use /roll:2d6+3 for custom notation; /roll:4d6kh3 keeps the highest three. The menu preview is the exact roll that gets inserted.',
      },
      { trigger: '/rolltable', name: 'Roll table', desc: 'A weighted table for encounters, loot or rumors; draw from it at random.' },
      { trigger: '/initiative', name: 'Initiative tracker', desc: 'Combat order with HP and conditions.' },
      {
        trigger: '/campaign',
        name: 'Campaign bible',
        desc: 'Seven linked tables, PCs, NPCs, locations, factions, quests, sessions and items, wired together with live relations.',
      },
    ],
  },
  {
    id: 'auto',
    title: 'Automation',
    blurb: 'Rules that run when something on the page changes.',
    commands: [
      { trigger: '/flow', name: 'Flow', desc: 'Opens the automation canvas for this page: when X happens, do Y.' },
    ],
  },
  {
    id: 'formulas',
    title: 'Formulas',
    blurb: 'A formula column computes from the other columns in its row. Reference a column by its name in [square brackets]; a single-word name also works without them. Dates are counted in whole days, so subtracting two of them gives a number. The /formula block uses the same syntax inline, and can read values you named on the page like "STR = 15".',
    commands: [
      { trigger: '[Price] * [Qty]', name: 'Arithmetic', desc: 'The four operators, parentheses and ^ for powers. Example: a line total from a price and a quantity.', note: 'Also: + - / and ( ) to group.' },
      { trigger: 'days([End], [Start])', name: 'Days between two dates', desc: 'Subtracts two date columns and gives the number of days. Order is end minus start, so a future end is positive.', note: 'today() is the number for the current day, e.g. days([Deadline], today()) is days left.' },
      { trigger: 'workdays(today(), [Deadline])', name: 'Swedish working days', desc: 'Counts Monday to Friday and skips Swedish red days (helgdagar, the Easter ones included) between the two dates.', note: 'Pair with daysoff(...) for the days off; together they add up to days(...).' },
      { trigger: 'countdown("Fukuoka")', name: 'A countdown counter', desc: 'The days-to-go shown by a /countdown counter on the same page, by its label, so a table can use that number.', note: 'The label must match the one on the counter. Use it like any number, e.g. countdown("Trip") - 7.' },
      { trigger: 'budget("Japan")', name: 'A split budget total', desc: 'The total spent in a /split budget on the page, by its title, in that budget’s base currency.', note: 'A missing title is an error, so a typo shows rather than a silent zero.' },
      { trigger: 'owed("Japan", "Alice")', name: 'A person’s net in a budget', desc: 'What a named person’s balance is in a split budget: positive means they are owed money, negative means they owe.', note: 'The name must match a person in that budget.' },
      { trigger: 'tablesum("Stops", "Nights")', name: 'A total from another table', desc: 'The total of a number or formula column on another table, by the table name and the column name, so one table can roll up another.', note: 'tablecount("Stops") is that table’s row count. The table has to be on a page you have open.' },
      { trigger: 'daysoff([Start], [End])', name: 'Days off', desc: 'Counts weekends plus red days between two dates: every day that is not a working day.', note: 'holiday([Date]) is 1 when that single date is a Swedish red day, else 0.' },
      { trigger: 'if([Paid], "yes", "no")', name: 'Conditions', desc: 'Picks the second value when the first is true (a ticked checkbox, or a non-zero number), otherwise the third.', note: 'Compare with > < >= <= == != and combine with and(...) / or(...) / not(...).' },
      { trigger: 'sum([A], [B], [C])', name: 'Aggregates', desc: 'Adds its arguments. Same shape for avg, min, max, count and product.', note: 'round(x), roundto(x, 2), abs, floor, ceil, sqrt, pow, clamp(x, lo, hi), percent(part, whole).' },
      { trigger: 'fx([Amount], "JPY", "SEK")', name: 'Currency', desc: 'Converts an amount from one currency to another at the latest rate the app has.', note: 'Leave the last code off to use your base currency.' },
      { trigger: 'concat([First], " ", [Last])', name: 'Text', desc: 'Joins values into one string. With format([Date], "long") you can build a label like a sentence.', note: 'Also: upper, lower, trim, left(s, n), right(s, n), len, replace(s, find, with).' },
    ],
  },
];

// Filter the catalog by a query, matching trigger, name or description. Returns
// whole sections with only their matching commands; empty sections drop out.
export function searchHelp(query: string): HelpSection[] {
  const q = query.toLowerCase().trim();
  if (!q) return HELP_SECTIONS;
  const out: HelpSection[] = [];
  for (const section of HELP_SECTIONS) {
    const commands = section.commands.filter(
      (c) =>
        c.trigger.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.desc.toLowerCase().includes(q) ||
        (c.note?.toLowerCase().includes(q) ?? false),
    );
    if (commands.length) out.push({ ...section, commands });
  }
  return out;
}
