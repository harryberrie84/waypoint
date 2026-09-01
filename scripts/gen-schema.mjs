// Build the canonical collection schema and the bootstrap migration from it.
//
// `pocketbase/schema.json` is the single source of truth for what a Waypoint
// database contains. This script normalises it (fixed collection ids so relations
// resolve with no placeholder substitution) and emits
// `server/pb_migrations/1699999999_bootstrap.js`, which stands a database up from
// an empty pb_data with no admin login and no Admin UI clicking.
//
// Run: npm run schema:gen        Check without writing: npm run schema:gen -- --check
//
// An install from before a given field exists is upgraded by the incremental
// migrations beside the bootstrap, which PocketBase applies on start. Nothing
// here needs an admin login.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = join(ROOT, 'pocketbase', 'schema.json');
const OUT = join(ROOT, 'server', 'pb_migrations', '1699999999_bootstrap.js');

// The incremental migrations that sit beside the bootstrap. They exist for
// installs older than it, and on a FRESH database every collection they create
// already exists, so they would fail on a duplicate name. The bootstrap marks
// them applied instead. Sorted, so the generated file is byte-stable and the
// drift gate stays meaningful.
const LATER = readdirSync(join(ROOT, 'server', 'pb_migrations'))
  .filter((f) => f.endsWith('.js') && f !== '1699999999_bootstrap.js')
  .sort();
const NL = String.fromCharCode(10);
const LATER_JS = JSON.stringify(LATER, null, 4).split(NL).join(NL + '    ');
const CHECK = process.argv.includes('--check');

// PocketBase ids are 15 chars. Fixing them is what removes the old two-pass
// "import once, copy the generated ids over the PLACEHOLDERs, import again" dance
// from the install: a relation can name its target before that target exists.
const USERS = '_pb_users_auth_'; // PocketBase's own auth collection id
const ID = {
  users: USERS,
  pages: 'wpcolpages00001',
  tables: 'wpcoltables0001',
  table_rows: 'wpcoltablerows1',
  comments: 'wpcolcomments01',
  presence: 'wpcolpresence01',
  workspaces: 'wpcolworkspace1',
  workspace_members: 'wpcolwsmembers1',
  workspace_invites: 'wpcolwsinvites1',
  user_keys: 'wpcoluserkeys01',
  workspace_keys: 'wpcolwskeys0001',
  yupdates: 'wpcolyupdates01',
  page_versions: 'wpcolpagevers01',
  uploads: 'wpcoluploads001',
  file_trash: 'wpcolfiletrash1',
  reminders: 'wpcolreminders1',
};
for (const [k, v] of Object.entries(ID)) {
  if (v.length !== 15) throw new Error(`collection id for ${k} must be 15 chars, got ${v.length}`);
}

// --- rule fragments, the single source for every collection's API rules ------
const AUTHED = '@request.auth.id != ""';
const MEMBER = 'workspace.workspace_members_via_workspace.user ?= @request.auth.id';
const WS = `(workspace = "" || ${MEMBER})`;
const WS_SCOPED = `${AUTHED} && (workspace = "" || (@collection.workspace_members.workspace ?= workspace && @collection.workspace_members.user ?= @request.auth.id))`;
// Deliberately no `workspace = ""` escape: these rows carry a FILE NAME, so an
// unstamped row must be unreadable rather than readable by everyone.
const TRASH_SCOPED = `${AUTHED} && workspace != "" && @collection.workspace_members.workspace ?= workspace && @collection.workspace_members.user ?= @request.auth.id`;

// --- field builders ----------------------------------------------------------
const text = (name, max = null, required = false) => ({ name, type: 'text', required, options: { min: null, max, pattern: '' } });
const json = (name, maxSize = 2000000) => ({ name, type: 'json', required: false, options: { maxSize } });
const bool = (name) => ({ name, type: 'bool', required: false, options: {} });
const file = (name, maxSize, required = false) => ({ name, type: 'file', required, options: { maxSelect: 1, maxSize, mimeTypes: [], thumbs: [], protected: false } });

// Fields the client writes that the old schema.json never declared. `table_rows.content`
// is the one that matters: the row body (the kanban card pop-out, "open as page") is
// written by setRowContent and appears in NEITHER the old schema.json nor the
// reconciler, so a fresh install would have accepted the write, dropped the field, and
// lost every row body silently.
const ADD_FIELDS = {
  users: [json('prefs')],
  pages: [
    bool('template'), json('map'), json('flow'), json('tierlist'), json('rates'),
    json('sheet'), json('cards'), json('rota'), json('bracket'), json('mindmap'),
    json('photos'), json('files'), text('defaultTab', 32), text('ydoc', 5000000),
  ],
  tables: [text('formKey')],
  table_rows: [text('parent', 60), json('reactions'), json('content')],
  presence: [text('cursor', 5000), text('focus', 200)],
};

// Collections the base schema never had. Rules copied from the reconciler verbatim.
const NEW_COLLECTIONS = [
  {
    name: 'yupdates', type: 'base', id: ID.yupdates,
    schema: [text('page', 60, true), text('workspace', 60), text('author', 60), text('data', 5000000)],
    indexes: ['CREATE INDEX `idx_yupdates_page` ON `yupdates` (`page`)'],
    listRule: WS_SCOPED, viewRule: WS_SCOPED, createRule: AUTHED, updateRule: null, deleteRule: WS_SCOPED,
  },
  {
    name: 'page_versions', type: 'base', id: ID.page_versions,
    schema: [text('page', 60, true), text('workspace', 60), text('content', 5000000)],
    indexes: ['CREATE INDEX `idx_page_versions_page` ON `page_versions` (`page`)'],
    listRule: WS_SCOPED, viewRule: WS_SCOPED, createRule: AUTHED, updateRule: null, deleteRule: WS_SCOPED,
  },
  {
    // `file` stays publicly viewable so an <img src> loads; list is scoped so nobody
    // can enumerate another workspace's files.
    name: 'uploads', type: 'base', id: ID.uploads,
    schema: [file('file', 104857600, true), text('workspace', 60), text('owner', 60)],
    indexes: [],
    listRule: TRASH_SCOPED, viewRule: '', createRule: AUTHED, updateRule: null, deleteRule: TRASH_SCOPED,
  },
  {
    name: 'file_trash', type: 'base', id: ID.file_trash,
    schema: [
      text('workspace', 60), text('url', 500), text('name', 300), text('page', 60),
      text('removedBy', 60), text('removedByName', 120), text('status', 20),
    ],
    indexes: [],
    listRule: TRASH_SCOPED, viewRule: TRASH_SCOPED, createRule: AUTHED, updateRule: TRASH_SCOPED, deleteRule: TRASH_SCOPED,
  },
  {
    // An opaque reminder schedule: workspace, when, whom, and a sent marker. No row
    // reference and no title, so the server never learns what a reminder is about.
    name: 'reminders', type: 'base', id: ID.reminders,
    schema: [text('workspace', 60), text('fireAt', 40, true), text('target', 40, true), json('recipients', 20000), text('sent', 40)],
    indexes: ['CREATE INDEX `idx_reminders_sent` ON `reminders` (`sent`)'],
    listRule: WS_SCOPED, viewRule: WS_SCOPED, createRule: AUTHED, updateRule: WS_SCOPED, deleteRule: WS_SCOPED,
  },
];

// --- build -------------------------------------------------------------------
const base = JSON.parse(readFileSync(SCHEMA, 'utf8'));

// Web push was built and then torn out. The collection outlived it in this file.
const kept = base.filter((c) => c.name !== 'push_subscriptions');

const PLACEHOLDER = { PLACEHOLDER_WORKSPACES_ID: ID.workspaces, PLACEHOLDER_TABLES_ID: ID.tables, PLACEHOLDER_PAGES_ID: ID.pages };

for (const col of kept) {
  if (!ID[col.name]) throw new Error(`no fixed id assigned for collection "${col.name}"`);
  col.id = ID[col.name];
  col.indexes = col.indexes || [];
  for (const f of col.schema || []) {
    if (f.type === 'relation') {
      const target = f.options.collectionId;
      const resolved = PLACEHOLDER[target] || target;
      if (resolved.startsWith('PLACEHOLDER')) throw new Error(`unresolved placeholder ${target} on ${col.name}.${f.name}`);
      f.options.collectionId = resolved;
    }
  }
  for (const extra of ADD_FIELDS[col.name] || []) {
    if (!col.schema.some((f) => f.name === extra.name)) col.schema.push(extra);
  }
}

// Re-running reads the file this script last wrote, so anything already present
// is kept as-is rather than appended a second time. That is what makes --check a
// real drift gate instead of a diff against itself.
const have = new Set(kept.map((c) => c.name));
const all = [...kept, ...NEW_COLLECTIONS.filter((c) => !have.has(c.name))];

// Every field gets the full 0.22 shape so saveCollection never sees a partial.
for (const col of all) {
  col.schema = (col.schema || []).map((f) => ({
    system: false, id: f.id || fieldId(col.name, f.name), name: f.name, type: f.type,
    required: !!f.required, presentable: false, unique: false, options: f.options || {},
  }));
}

// Deterministic, so regenerating produces a byte-identical file and --check works.
function fieldId(collection, field) {
  let h = 0;
  for (const ch of `${collection}.${field}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(36).padStart(10, '0').slice(0, 10);
}

const canonical = JSON.stringify(all, null, 2) + '\n';

const migration = `/// <reference path="../pb_data/types.d.ts" />
//
// 1699999999_bootstrap.js, the whole schema from nothing.
//
// GENERATED by scripts/gen-schema.mjs from pocketbase/schema.json. Do not edit by
// hand, edit the schema and re-run \`npm run schema:gen\`.
//
// This runs before every other migration (hence the number) and is what lets a
// container come up against an empty pb_data with no admin login and no Admin UI
// steps. Collection ids are fixed, so a relation can name its target before that
// target exists and the old "import twice and paste the ids over the placeholders"
// dance is gone.
//
// Idempotent: an install that already has these collections is skipped entirely, so
// this is safe to ship alongside the incremental migrations that follow it.

migrate(
  function (db) {
    var dao = new Dao(db);

    // An existing install already has its schema; the later migrations own its
    // upgrades. Only a fresh database gets built from here.
    try {
      dao.findCollectionByNameOrId("pages");
      return;
    } catch (e) {
      // not found, so this is a fresh database, carry on
    }

    var defs = ${JSON.stringify(all, null, 4).split('\n').join('\n    ')};

    // Two passes: create every collection first so a relation's target always
    // exists by the time the relation is saved, then attach the schemas.
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      if (d.name === "users") continue; // PocketBase ships the auth collection
      var col = new Collection({ id: d.id, name: d.name, type: d.type });
      dao.saveCollection(col);
    }

    for (var j = 0; j < defs.length; j++) {
      var def = defs[j];
      var c = dao.findCollectionByNameOrId(def.name);
      // addField, one field at a time. \`new Schema(array)\` looks right and is
      // not: the constructor takes a Partial<Schema> object, so an array builds
      // an empty schema. This is the idiom every other migration here uses.
      //
      // Matched by NAME, not id. PocketBase ships the users collection with its
      // own \`name\` field, and addField matches on id: our fixed ids do not equal
      // the ones it generated, so adding \`name\` again appended a SECOND column
      // and the migration died with "duplicate column name: name".
      var have = {};
      var current = c.schema.fields();
      for (var q = 0; q < current.length; q++) {
        if (current[q] && current[q].name) have[current[q].name] = true;
      }
      for (var k = 0; k < def.schema.length; k++) {
        var f = def.schema[k];
        if (have[f.name]) continue; // already there, leave it exactly as it is
        c.schema.addField(new SchemaField(f));
      }
      if (def.indexes) c.indexes = def.indexes;
      c.listRule = def.listRule === null ? null : def.listRule;
      c.viewRule = def.viewRule === null ? null : def.viewRule;
      c.createRule = def.createRule === null ? null : def.createRule;
      c.updateRule = def.updateRule === null ? null : def.updateRule;
      c.deleteRule = def.deleteRule === null ? null : def.deleteRule;
      if (def.options && def.type === "auth") c.options = def.options;
      dao.saveCollection(c);
    }

    // Everything the later migrations were written to create now exists, so
    // running them would fail on a duplicate collection name. Mark them applied.
    // They are not dead: an install older than this bootstrap skips the block
    // above and applies them normally, which is the whole reason they stay.
    var later = ${LATER_JS};
    var stamp = Date.now() * 1000;
    for (var m = 0; m < later.length; m++) {
      db.newQuery("INSERT OR IGNORE INTO _migrations (file, applied) VALUES ({:f}, {:a})")
        .bind({ f: later[m], a: stamp + m })
        .execute();
    }
  },
  function (db) {
    // Down: drop only what this migration creates, never the users collection.
    var dao = new Dao(db);
    var names = ${JSON.stringify(all.filter((c) => c.name !== 'users').map((c) => c.name).reverse())};
    for (var i = 0; i < names.length; i++) {
      try {
        dao.deleteCollection(dao.findCollectionByNameOrId(names[i]));
      } catch (e) {}
    }
  },
);
`;

if (CHECK) {
  const curSchema = readFileSync(SCHEMA, 'utf8');
  const curMig = readFileSync(OUT, 'utf8');
  const drift = [];
  if (curSchema !== canonical) drift.push('pocketbase/schema.json');
  if (curMig !== migration) drift.push('server/pb_migrations/1699999999_bootstrap.js');
  if (drift.length) {
    console.error('schema drift in: ' + drift.join(', '));
    console.error('run `npm run schema:gen` and commit the result');
    process.exit(1);
  }
  console.log(`schema up to date (${all.length} collections)`);
} else {
  writeFileSync(SCHEMA, canonical);
  writeFileSync(OUT, migration);
  console.log(`wrote pocketbase/schema.json and the bootstrap migration (${all.length} collections)`);
}
