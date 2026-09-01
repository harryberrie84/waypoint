// ---------------------------------------------------------------------------
// Domain model (PocketBase-backed)
// ---------------------------------------------------------------------------
// Each interface below maps 1:1 to a PocketBase collection record. The client
// keeps an in-memory mirror (Zustand) hydrated from the API and kept fresh by
// realtime SSE subscriptions. Optimistic mutations write to the store first,
// then persist; SSE echoes reconcile the canonical server state back in.

export type Theme = 'light' | 'dark';

// --- Pages ------------------------------------------------------------------

// A Photos-tab image, stored in the dedicated `pages.photos` field (NOT the page
// body), so it never renders in the Notes editor but still shows in the Photos and
// Files tabs. Each carries its own date + album. Persists via the simple optimistic
// field-sync (like map/tierlist), not Yjs, so it can't hit the content-reseed race.
export interface PagePhoto {
  id: string;
  url: string; // upload url or a data URL
  alt?: string;
  date?: string; // ISO capture/upload date (editable by hand)
  album?: string;
  note?: string; // Moodboard caption: why this picture is on the wall
}

// A Files-tab attachment, stored in the dedicated `pages.files` field, the exact
// sibling of PagePhoto. The Files tab used to derive its whole list from the page
// BODY, so adding a file there had to append a block to your notes: the body was the
// only place a file reference could live. Now a file added from the Files tab lands
// here instead and stays out of the Notes editor. Anything genuinely in the body (a
// dragged image, a /file block) still shows in the tab, it just isn't put there BY
// the tab.
export interface PageFile {
  id: string;
  url: string;
  name: string;
  mime?: string;
  size?: number;
  note?: string; // Moodboard caption, same as PagePhoto.note
}

export interface Page {
  id: string;
  title: string;
  icon: string;
  parent: string; // parent page id, '' for top-level (PB relations are '' when empty)
  order: number;
  content: unknown | null; // TipTap JSON doc
  owner: string; // user id who created it
  workspace?: string; // owning workspace (feature 4; optional → empty resolves to the default ws pre-migration)
  trashed: boolean; // soft-delete flag; trashed pages are hidden from the tree
  visibility: 'workspace' | 'private'; // 'workspace' = all members; 'private' = owner + shares
  editors: string[]; // user ids granted edit when private (multi-relation on the page)
  viewers: string[]; // user ids granted read-only when private
  template: boolean; // reusable template, spawnable into fresh pages
  // When set, anyone with the link (/?share=<token>) can read this page without
  // an account. Only plaintext pages get one (an encrypted page has no key to
  // share). Optional and graceful, like the other late-added fields.
  publicToken?: string;
  // Encrypted Yjs snapshot for real-time co-editing (the server can't read it).
  // Absent until a page is first edited collaboratively; the plaintext `content`
  // stays the source for search, mirrors, public shares and print.
  ydoc?: string;
  cover: string; // cover image url or gradient preset key ('' = none)
  map: PageMapData | null; // workspace map: manual pins + routes (null until set)
  mindmap: MindmapData | null; // free-canvas graph (null until set)
  flow: FlowData | null; // automation canvas: triggers → filters → actions (null until set)
  kanban: KanbanData | null; // standalone kanban board: columns of cards (null until set)
  tierlist: import('./lib/tierList').TierListData | null; // page-level tier list tab (null until set)
  rates: import('./lib/fxBoard').FxBoardData | null; // page-level Currency tab: one amount, many currencies (null until set)
  sheet: import('./lib/sheet').SheetData | null; // page-level Sheet tab: a real grid with formulas and charts (null until used)
  cards: import('./lib/srs').Deck | null; // page-level Flashcards tab: an SM-2 deck (null until used)
  rota: import('./lib/rota').RotaData | null; // page-level Rota tab: recurring jobs that rotate (null until used)
  bracket: import('./lib/bracket').BracketData | null; // page-level Bracket tab: a knockout tournament (null until used)
  defaultTab: string; // which tab opens by default on this page (shared; '' = Notes/last-visited)
  photos: PagePhoto[]; // Photos-tab images, stored OUT of the page body so they never render in Notes
  files: PageFile[]; // Files-tab attachments, likewise kept out of the body
  updated: string; // PB auto timestamp (ISO)
  created: string;
}

// --- Workspace map ----------------------------------------------------------
// Per-page map state stored in `pages.map` (JSON). Holds the user's own pins
// (manual drops and places saved from search) and the linked `sources`. Place
// pins that come from a table, whether embedded on the page or linked in from
// another page via `sources`, are derived live from the store, not stored here,
// so they stay in sync. Routes reference pins by id (table place pin ids are
// stable `place:<rowId>:<colId>`), and unresolved endpoints are simply skipped.

export type PageMapPinKind = 'manual' | 'place';
export type PageMapMode = 'flight' | 'drive' | 'walk' | 'cycle';

export interface PageMapPin {
  id: string;
  lat: number;
  lon: number;
  name: string;
  kind: PageMapPinKind;
  // Set on place pins derived from a linked source table, so the marker takes
  // that source's colour. Undefined → the default (manual = pink, place = blue).
  color?: string;
}

export interface PageMapRoute {
  id: string;
  fromPinId: string;
  toPinId: string;
  mode: PageMapMode;
}

// A table from anywhere in the workspace linked into this page's map. Its place
// rows pin live (derived from the store, so editing a row updates every map that
// links it) in this source's colour, which is how one large map can tell a
// "Tokyo" list from a "Fukuoka" list.
export interface PageMapSource {
  tableId: string;
  color: string; // hex; the pin colour for this source's places
  label?: string; // optional display name; falls back to the table's own name
}

export interface PageMapData {
  pins: PageMapPin[]; // user-added pins (manual drops + saved search places)
  routes: PageMapRoute[];
  sources?: PageMapSource[]; // linked external tables, live-synced, coloured per source
  shareId?: string; // the public shared-copy page id (a read-only /?share= link)
  shareToken?: string; // its public token; present == currently shared
}

// --- Mindmap ----------------------------------------------------------------
// A free-canvas graph stored in `pages.mindmap` (JSON), the same "free-placed
// nodes + connections in a JSON field" shape as the map, on the same graceful
// path (optional field, localStorage mirror, server wins once present). Nodes
// that reference another record (page/person) render live from the store, like
// the map's table-derived place pins, so they don't copy the title in.

export type MindNodeKind = 'text' | 'place' | 'person' | 'page' | 'number' | 'widget' | 'row' | 'image';

/** A checkable sticky, the one small "widget" node kind. */
export interface MindWidgetValue {
  text: string;
  checked: boolean;
}

/** A `row` node references a table row, or (rowId absent) a whole table. The
 *  label/chips resolve live from the store, like the page/person nodes. */
export interface MindRowValue {
  tableId: string;
  rowId?: string;
}

/** Per-kind payload: text/page/person carry a string (text / page id / user id),
 *  number a number, place a GeoValue, widget a MindWidgetValue, row a
 *  MindRowValue. `kind` disambiguates which member is in play. */
export type MindPayload = string | number | GeoValue | MindWidgetValue | MindRowValue;

export interface MindNode {
  id: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  kind: MindNodeKind;
  color?: string;
  collapsed?: boolean;
  payload: MindPayload;
}

export interface MindEdge {
  id: string;
  from: string; // node id
  to: string; // node id
  label?: string;
  directed?: boolean; // arrowhead at `to`
  biDir?: boolean; // arrowheads at both ends (implies directed)
  style?: 'solid' | 'dashed';
  color?: string; // optional accent; falls back to the neutral edge colour
}

export interface MindViewport {
  x: number; // screen-space pan
  y: number;
  zoom: number;
}

export interface MindmapData {
  nodes: MindNode[];
  edges: MindEdge[];
  viewport?: MindViewport;
}

// --- Kanban board -----------------------------------------------------------
// A standalone per-page board (its own tab, like map/mindmap/flow): ordered
// columns, each an ordered list of cards. Stored in `pages.kanban` (JSON).
export interface KanbanCard {
  id: string;
  title: string;
  note?: string;
  color?: string; // optional accent (a TAG_COLORS value)
}

export interface KanbanColumn {
  id: string;
  title: string;
  cards: KanbanCard[];
}

export interface KanbanData {
  // A table-backed board (cards are rows, the rich row pop-out applies). The older
  // lightweight board kept its cards inline in `columns`; both shapes are allowed
  // so existing boards keep working and can be migrated.
  tableId?: string;
  columns?: KanbanColumn[];
}

// --- Flows ------------------------------------------------------------------
// A free-canvas graph stored in `pages.flow` (JSON), the same graceful path as
// the map and mindmap (optional field, localStorage mirror, server wins once
// present). Geometry mirrors MindNode so the canvas code is shared, not forked.
// Nodes are typed: a trigger fires the flow, filters gate it, code computes a
// value, actions write to rows, widgets are manual run buttons. Edges are
// control flow; execution walks them in topological order, each step passing a
// small context to the next. The pure compiler/executor live in lib/flow.ts;
// the store only applies the effects they describe.

export type FlowNodeKind = 'trigger' | 'filter' | 'action' | 'code' | 'widget' | 'note';

export type FlowTriggerKind =
  | 'rowFieldEquals' // a column on a table changes to a value
  | 'rowFieldFilter' // a formula predicate over the row goes false→true
  | 'rowCreated' // a row is added to a table
  | 'rowDeleted' // a row is removed from a table
  | 'pageCheckbox' // a task checkbox on a page is ticked/unticked
  | 'schedule' // a wall-clock time: daily, or a weekday, fires on its own
  | 'manual'; // a widget/run button starts this flow

export interface FlowTrigger {
  kind: FlowTriggerKind;
  tableId?: string; // rowFieldEquals | rowFieldFilter | rowCreated | rowDeleted
  columnId?: string; // rowFieldEquals
  value?: string; // rowFieldEquals (compared like the automation engine)
  expr?: string; // rowFieldFilter, predicate; fires on its rising edge (false→true)
  pageId?: string; // pageCheckbox, which page's content to watch
  checkboxId?: string; // pageCheckbox, stable taskItem id (preferred over text)
  checkboxText?: string; // pageCheckbox, match a taskItem by its text label (fallback / display)
  checkboxState?: 'checked' | 'unchecked'; // pageCheckbox, fire on this transition
  // schedule: a recurring wall-clock slot, evaluated against `now` on a tick so it
  // fires on its own (while a tab is open). A row-less run, so its actions target a
  // table (create / match) or a page (notify / comment), never `thisRow`.
  freq?: 'daily' | 'weekly'; // default daily
  weekday?: number; // 0=Sun..6=Sat, for weekly
  time?: string; // 'HH:mm' local time-of-day to fire (default 09:00)
}

/** A filter gates downstream execution: `expr` is evaluated against the run
 *  context (formula engine, safe, no eval) and must be truthy to pass. */
export interface FlowFilter {
  expr: string; // e.g. "[amount] > 100", "[status] == \"done\""
}

/** Where an action node writes: the triggering row, a new row, the first (or
 *  every) row in another table matching a column value, the notification bell,
 *  or a page's comment thread. */
export type FlowActionTarget =
  | { kind: 'thisRow' }
  | { kind: 'createRow'; tableId: string }
  | { kind: 'matchRow'; tableId: string; columnId: string; value: string; all?: boolean }
  | { kind: 'notify' } // push a notice onto the in-app bell
  | { kind: 'comment'; pageId: string }; // post a comment (mentions email via the existing hook)

export interface FlowActionSpec {
  target: FlowActionTarget;
  actions: import('./lib/automations').AutomationAction[]; // reused verbatim (cell-write targets)
  text?: string; // notify | comment, the message, with [ref] interpolation
}

/** A code node computes a value with the safe expression engine and binds it to
 *  `outKey` in the context for downstream nodes/filters to read. Not JS. */
export interface FlowCodeSpec {
  expr: string;
  outKey: string;
}

/** A manual entry point: a labelled button that starts a standalone run. */
export interface FlowWidgetSpec {
  label: string;
}

export type FlowPayload = FlowTrigger | FlowFilter | FlowActionSpec | FlowCodeSpec | FlowWidgetSpec | string; // note = string

export interface FlowNode {
  id: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  kind: FlowNodeKind;
  color?: string;
  payload: FlowPayload; // disambiguated by kind, same pattern as MindNode
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  branch?: 'pass' | 'fail'; // edges out of a filter: which way the gate sends control
}

export interface FlowData {
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport?: MindViewport; // reuse the mindmap viewport type
  enabled?: boolean; // master switch (default true once it has a trigger)
}

// --- Workspaces -------------------------------------------------------------
// The tier above pages (feature 4). A workspace gates everything beneath it:
// every page/table/row belongs to one, and you only see records in workspaces
// you're a member of. Private vs shared is *derived* (solo membership = private),
// not a stored flag, inviting someone is what moves it to the shared tab.
// The security boundary is the PocketBase membership rules, not this client.

export type WorkspaceRole = 'admin' | 'editor' | 'viewer';

// How numbers are typed/parsed in a workspace. 'swedish' (default) accepts both
// comma and dot as the decimal mark; 'standard' uses dot for decimals and treats
// commas as thousands separators.
export type NumberStyle = 'swedish' | 'standard';

export interface Workspace {
  id: string;
  name: string;
  icon: string;
  owner: string; // users.id of the creator
  // Admin-toggled per workspace: surfaces the tabletop/D&D tools (dice, campaign
  // tables, character sheets). Optional and graceful, absent means off, and the
  // value mirrors to localStorage until the `tabletop` field exists server-side.
  tabletop?: boolean;
  // When true, page content written in this workspace is encrypted by default
  // (no per-page lock needed). Same graceful/mirror treatment as `tabletop`.
  encrypted?: boolean;
  // How numbers are typed/parsed here. Default (absent) is 'swedish'. Same
  // graceful/mirror treatment as the flags above.
  numberStyle?: NumberStyle;
  created: string;
  updated: string;
}

/** A `workspace_members` record, the roster and the permission source. The
 *  denormalized `userName` lets us render names without a global user list
 *  (the same trick comments.authorName uses). Unique on (workspace, user). */
export interface WorkspaceMember {
  id: string;
  workspace: string;
  user: string;
  userName: string;
  role: WorkspaceRole;
  // The member's ECDH public key, self-published so other members can wrap the
  // workspace's encryption key to them. Empty until they've set up their vault.
  publicKey?: string;
  created: string;
}

/** A pending invite by email, you can't relate to an account that may not
 *  exist yet, so the invite stores an email and a server hook claims it into a
 *  membership when that email signs in. This is why you never browse users. */
export interface WorkspaceInvite {
  id: string;
  workspace: string;
  email: string;
  role: WorkspaceRole;
  invitedBy: string;
  status: 'pending' | 'accepted';
  created: string;
}

// --- Sharing / permissions --------------------------------------------------

export type ShareRole = 'viewer' | 'editor';

/** Effective role a given user has on a page. */
export type PageRole = 'owner' | 'editor' | 'viewer' | 'none';

// --- Relational tables ------------------------------------------------------

export type ColumnType = 'text' | 'number' | 'select' | 'multiselect' | 'date' | 'datetime' | 'checkbox' | 'url' | 'place' | 'attachment' | 'reminder' | 'relation' | 'rollup' | 'lookup' | 'progress' | 'button' | 'person' | 'formula' | 'checklist';

// One row of a checklist cell: text + done, with an optional due date and one
// assignee (a member id). Stored as a JSON array in the cell value.
export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
  due?: string; // YYYY-MM-DD
  who?: string; // member id
}

/** How far ahead of a reminder column's datetime to surface it. */
export type ReminderLead = 'at' | '1h' | '1d';

export interface SelectOption {
  id: string;
  label: string;
  color: string;
  done?: boolean; // a board stage that means "complete"; its rows drop off Home
}

export interface Column {
  id: string;
  name: string;
  type: ColumnType;
  options?: SelectOption[];
  formula?: string;
  width: number;
  numberFormat?: NumberFormat; // number/formula/rollup display
  relationTableId?: string; // relation, target table whose rows this links to
  rollupRelationColumnId?: string; // rollup, which relation column on THIS table to follow
  rollupTargetColumnId?: string; // rollup, which column in the target table to aggregate
  rollupFn?: RollupFn; // rollup, how to aggregate
  lookupRelationColumnId?: string; // lookup, which relation column on THIS table to follow
  lookupTargetColumnId?: string; // lookup, which column in the target table to read
  buttonLabel?: string; // button, caption
  buttonActions?: import('./lib/automations').AutomationAction[]; // button, actions to run on click
  reminderLead?: ReminderLead; // reminder, how far ahead of the cell's datetime to alert
  peopleMulti?: boolean; // person, allow more than one assignee (default: single)
  agg?: AggregationKind; // grid footer, which summary to show under this column
  // When true, a viewer/share role never sees this column, the DM-secret gate.
  // Optional → absent means visible, so existing tables are unaffected. The real
  // boundary is the server strip once public share links land; this is the UX.
  dmOnly?: boolean;
  // date/datetime only: treat this date as a deadline so its rows appear in the
  // Home agenda (overdue / today / upcoming). Off by default, so a plain calendar
  // date is just an event and never reads as "overdue". Reminder columns and
  // checklist due-dates are always tasks regardless of this.
  agendaDue?: boolean;
}

export type NumberFormat = 'plain' | 'comma' | 'yen' | 'sek' | 'eur' | 'usd' | 'percent';
export type RollupFn = 'sum' | 'avg' | 'min' | 'max' | 'count';

export interface GeoValue {
  name: string;
  lat: number;
  lon: number;
  // Optional POI details from OSM (Nominatim extratags). All optional so plain
  // name-only places, older cells, and the geocode fallback keep working. OSM has
  // no review score, so there is deliberately no `rating`, `stars` is the hotel
  // star-class tag where it exists, not a user rating.
  category?: string; // e.g. 'restaurant', 'hotel', 'cafe'
  cuisine?: string; // OSM `cuisine` tag, e.g. 'ramen;japanese'
  openingHours?: string; // raw OSM `opening_hours` string, shown as-is
  website?: string;
  phone?: string;
  address?: string; // human-readable, from Nominatim's display_name
  stars?: number; // hotel star class where OSM has the `stars` tag
}
/** A file embedded in a cell or block as a base64 data URL, no PB file storage.
 *  Lives in the existing `cells`/`content` JSON, so the ~2MB field cap applies
 *  (see processAttachmentFile). */
export interface AttachmentValue {
  name: string;
  mime: string;
  size: number; // bytes, for display
  data: string; // base64 data URL
}
export type CellValue = string | number | boolean | string[] | GeoValue | AttachmentValue | null;

/** A `tables` record. `columns` is a JSON field; rows live in `table_rows`. */
export interface TableData {
  id: string;
  name: string;
  columns: Column[];
  views?: object | null; // persisted ViewConfig (synced across devices when the field exists)
  automations?: import('./lib/automations').Automation[] | null; // table automations
  formKey?: string; // set when this table backs /form:<key> blocks, hidden from the normal table/relation pickers
  owner: string;
  workspace?: string; // owning workspace (feature 4; optional, graceful pre-migration)
  updated: string;
  created: string;
}

/** A `table_rows` record, one per row, enabling cell-level SSE. */
export interface TableRow {
  id: string;
  table: string; // tables.id
  workspace?: string; // owning workspace (feature 4; optional, graceful pre-migration)
  parent: string; // parent row id for sub-items, '' = top-level
  cells: Record<string, CellValue>; // columnId -> value (JSON field)
  // When the persisted cells are encrypted and not yet opened, the ciphertext
  // envelope sits here and `cells` is empty until the workspace key decrypts it.
  // setCell refuses to write while this is set, so ciphertext is never clobbered.
  cellsEnc?: string;
  content?: object | null; // TipTap JSON for the row's page body (the "open as page" content)
  // The body's ciphertext envelope in an encrypted workspace, exactly like cellsEnc:
  // `content` stays null until the workspace key decrypts it in memory. setRowContent
  // refuses to write while this is set, so the row-detail editor (which mounts with a
  // null doc) can never save an empty body over ciphertext it hasn't read yet.
  contentEnc?: string;
  reactions?: import('./lib/reactions').ReactionMap | null; // emoji -> user ids (votes)
  position: number; // sort order within the table
  created: string;
  updated: string;
}

export type AggregationKind = 'none' | 'sum' | 'avg' | 'count' | 'min' | 'max';

// --- Comments ---------------------------------------------------------------

export interface Comment {
  id: string;
  page: string; // pages.id (the page the thread lives on; also set for row threads)
  row: string; // table_rows.id when this comment is on a specific row, else ''
  thread: string; // an inline-comment anchor id (matches an editor mark), else ''
  author: string; // users.id
  authorName: string; // denormalized for display without an extra fetch
  body: string;
  mentions: string[]; // user ids @-mentioned in the body
  created: string;
  updated: string;
}

// --- Presence ---------------------------------------------------------------

export interface PresenceRecord {
  id: string;
  page: string;
  user: string;
  userName: string;
  mode: 'viewing' | 'editing';
  heartbeat: string; // ISO timestamp, refreshed periodically
  updated: string;
  cursor?: string; // ephemeral collaboration-cursor payload (Yjs awareness update, encoded)
  focus?: string; // which tab/view they're on (doc/map/flow/kanban/…), for the tab badges
}

// --- Auth -------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}
