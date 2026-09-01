/// <reference path="../pb_data/types.d.ts" />
//
// 1700000011_reminders.js, the opaque reminder schedule (encryption redesign).
// Adds a `reminders` collection of minimal tokens the server cron fires:
//   { workspace, fireAt, target, recipients: [users.id], sent }
// No row/table reference and no title, so moving the schedule here lets the client
// encrypt the WHOLE table_rows.cells object (the datetime, assignees and title all
// stop leaking), while the cron still knows when to fire and whom to email. The
// email it sends is generic, the content stays client-side and encrypted.
//
// The collection is additive and sits EMPTY on this release: the client half that
// writes tokens, and the cron that reads them, are the next step and are not in
// this build. Reminders currently run off the row cells, which is what
// pb_hooks/reminders_cron.pb.js reads. Applying this now costs nothing and means
// the cutover is a client update rather than a schema change.
//
// PocketBase 0.22 JS migration.

migrate(
  function (db) {
    var dao = new Dao(db);
    var WS_SCOPED =
      '@request.auth.id != "" ' +
      '&& (workspace = "" || (@collection.workspace_members.workspace ?= workspace ' +
      '&& @collection.workspace_members.user ?= @request.auth.id))';

    var exists = true;
    try { dao.findCollectionByNameOrId("reminders"); } catch (e) { exists = false; }
    if (exists) return;

    var col = new Collection({
      name: "reminders",
      type: "base",
      schema: [
        { name: "workspace", type: "text", required: false, options: { max: 60 } },
        { name: "fireAt", type: "text", required: true, options: { max: 40 } },
        { name: "target", type: "text", required: true, options: { max: 40 } },
        { name: "recipients", type: "json", required: false, options: { maxSize: 20000 } },
        { name: "sent", type: "text", required: false, options: { max: 40 } },
      ],
      indexes: ["CREATE INDEX `idx_reminders_sent` ON `reminders` (`sent`)"],
      listRule: WS_SCOPED,
      viewRule: WS_SCOPED,
      createRule: '@request.auth.id != ""',
      updateRule: WS_SCOPED,
      deleteRule: WS_SCOPED,
    });
    dao.saveCollection(col);
  },
  function (db) {
    var dao = new Dao(db);
    try {
      dao.deleteCollection(dao.findCollectionByNameOrId("reminders"));
    } catch (e) {}
  },
);
