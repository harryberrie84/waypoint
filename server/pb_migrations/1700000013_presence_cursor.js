/// <reference path="../pb_data/types.d.ts" />
//
// 1700000013_presence_cursor.js, add two ephemeral fields to the `presence`
// collection so live collaboration can ride the existing heartbeat record:
//   - `cursor`: the sender's encoded Yjs awareness update (their caret/selection;
//     encrypted with the workspace key on a locked page, so the server can't read
//     where anyone is). Bounded but generous.
//   - `focus`: which tab/view they're on (doc/kanban/map/…), for the tab badges.
// Both optional. The client already writes them best-effort and PocketBase drops
// unknown fields, so the feature simply no-ops until this runs.
//
// PocketBase 0.22 JS migration. Install: copy to pb_migrations/, restart serve.

migrate(
  function (db) {
    var dao = new Dao(db);
    var col = dao.findCollectionByNameOrId("presence");
    var add = function (name, max) {
      if (!col.schema.getFieldByName(name)) {
        col.schema.addField(new SchemaField({ name: name, type: "text", required: false, options: { max: max } }));
      }
    };
    add("cursor", 20000);
    add("focus", 64);
    dao.saveCollection(col);
  },
  function (db) {
    var dao = new Dao(db);
    try {
      var col = dao.findCollectionByNameOrId("presence");
      ["cursor", "focus"].forEach(function (n) {
        var f = col.schema.getFieldByName(n);
        if (f) col.schema.removeField(f.id);
      });
      dao.saveCollection(col);
    } catch (e) {
      /* collection gone, nothing to undo */
    }
  },
);
