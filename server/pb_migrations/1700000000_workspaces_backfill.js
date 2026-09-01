/// <reference path="../pb_data/types.d.ts" />
//
// 1700000000_workspaces_backfill.js, one-time backfill for feature 4.
//
// Creates a single default workspace, makes every existing user an admin of it,
// and stamps `workspace` onto every page / table / table_row that doesn't have
// one yet. Runs exactly once (PocketBase tracks it in _migrations) on the next
// `./pocketbase serve`.
//
// PocketBase 0.22 JS migration. Install: copy to `pb_migrations/` next to the
// binary (create the folder if needed), then restart serve.
//
// ORDER + SAFETY:
//   1. Add the `workspace` fields + the three new collections FIRST (see
//      FEATURE4_BACKEND.md), this migration assumes they exist.
//   2. BACK UP pb_data before running. Test against a copy first.
//   3. The list/view rules keep empty-workspace records visible until this
//      runs, so applying the rules before or after this is safe either way.

migrate(
  function (db) {
    var dao = new Dao(db);

    // --- 1. Ensure one default workspace --------------------------------
    var wsCol = dao.findCollectionByNameOrId("workspaces");
    var existing = dao.findRecordsByFilter("workspaces", "id != ''", "created", 1, 0);
    var ws;
    if (existing && existing.length) {
      ws = existing[0];
    } else {
      ws = new Record(wsCol);
      ws.set("name", "Workspace");
      ws.set("icon", "\uD83D\uDDFA\uFE0F"); // 🗺️
      // owner: first user if any, else left blank
      var firstUser = dao.findRecordsByFilter("users", "id != ''", "created", 1, 0);
      if (firstUser && firstUser.length) ws.set("owner", firstUser[0].id);
      dao.saveRecord(ws);
    }
    var wsId = ws.id;

    // --- 2. Seat every existing user as an admin member -----------------
    var memberCol = dao.findCollectionByNameOrId("workspace_members");
    var users = dao.findRecordsByFilter("users", "id != ''", "created", 5000, 0);
    users.forEach(function (u) {
      var seated = null;
      try {
        seated = dao.findFirstRecordByFilter(
          "workspace_members",
          "workspace = {:w} && user = {:u}",
          { w: wsId, u: u.id },
        );
      } catch (_) {
        seated = null;
      }
      if (!seated) {
        var m = new Record(memberCol);
        m.set("workspace", wsId);
        m.set("user", u.id);
        m.set("userName", u.get("name") || u.email());
        m.set("role", "admin");
        dao.saveRecord(m);
      }
    });

    // --- 3. Backfill the `workspace` field on existing records ----------
    ["pages", "tables", "table_rows"].forEach(function (coll) {
      var batch;
      // Re-query each pass: as we stamp rows they leave the empty set.
      do {
        batch = dao.findRecordsByFilter(coll, "workspace = ''", "created", 500, 0);
        batch.forEach(function (rec) {
          rec.set("workspace", wsId);
          dao.saveRecord(rec);
        });
      } while (batch && batch.length === 500);
    });
  },
  function (/* db */) {
    // No safe automatic down-migration: we can't know which records were
    // empty before. Restore from your pb_data backup if you need to revert.
  },
);
