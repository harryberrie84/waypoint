/// <reference path="../pb_data/types.d.ts" />
//
// 1700000014_missing_fields_and_indexes.js, two things an existing install lacks.
//
// Four fields the client has been writing that no schema declared. PocketBase
// drops an unknown field and still answers 200, so each one looked saved:
//   - pages.trashed: a trashed page came back on reload and the Trash stayed
//     empty, so the 14-day purge never found anything to purge.
//   - tables.views, tables.automations, workspaces.numberStyle: only ever kept in
//     the browser that set them, never on another device or for another member.
//
// And indexes on the fields the client filters by (a page's comments, its
// presence, a table's rows, a workspace's pages and tables) and on invite email,
// which the sign-in hook looks up. Without them each of those reads scans the
// whole collection, and the realtime rule checks run once per connected client.
//
// Idempotent: a field is added only if no field of that name exists, and an
// index only if its name is not already there, so an install where some of this
// was added by hand in the Admin UI is left as it is.
//
// PocketBase 0.22 JS migration. Install: copy to pb_migrations/, restart serve.

migrate(
  function (db) {
    var dao = new Dao(db);

    var FIELDS = {
      pages: [{ name: "trashed", type: "bool", required: false, options: {} }],
      tables: [
        { name: "views", type: "json", required: false, options: { maxSize: 2000000 } },
        { name: "automations", type: "json", required: false, options: { maxSize: 2000000 } },
      ],
      workspaces: [{ name: "numberStyle", type: "text", required: false, options: { min: null, max: 20, pattern: "" } }],
    };
    var INDEXES = {
      pages: ["workspace", "parent"],
      tables: ["workspace"],
      table_rows: ["table", "workspace"],
      comments: ["page", "thread", "row"],
      presence: ["page", "user"],
      workspace_invites: ["email"],
      uploads: ["workspace"],
      file_trash: ["workspace"],
    };

    var names = {};
    Object.keys(FIELDS).forEach(function (n) { names[n] = true; });
    Object.keys(INDEXES).forEach(function (n) { names[n] = true; });

    Object.keys(names).forEach(function (name) {
      var col;
      try {
        col = dao.findCollectionByNameOrId(name);
      } catch (e) {
        return; // collection not on this install, nothing to add to
      }

      (FIELDS[name] || []).forEach(function (f) {
        if (!col.schema.getFieldByName(f.name)) col.schema.addField(new SchemaField(f));
      });

      var have = [];
      var current = col.indexes || [];
      for (var i = 0; i < current.length; i++) have.push(String(current[i]));
      (INDEXES[name] || []).forEach(function (field) {
        // Only index a column that exists, or saveCollection fails the migration
        // and PocketBase will not start.
        if (!col.schema.getFieldByName(field)) return;
        var idxName = "idx_" + name + "_" + field;
        for (var j = 0; j < have.length; j++) {
          if (have[j].indexOf("`" + idxName + "`") !== -1 || have[j].indexOf(" " + idxName + " ") !== -1) return;
        }
        have.push("CREATE INDEX `" + idxName + "` ON `" + name + "` (`" + field + "`)");
      });
      col.indexes = have;

      dao.saveCollection(col);
    });
  },
  function (db) {
    // Down: drop the indexes only. The fields hold data people wrote, so they
    // stay; removing a column is a decision, not an undo.
    var dao = new Dao(db);
    var INDEXES = {
      pages: ["workspace", "parent"],
      tables: ["workspace"],
      table_rows: ["table", "workspace"],
      comments: ["page", "thread", "row"],
      presence: ["page", "user"],
      workspace_invites: ["email"],
      uploads: ["workspace"],
      file_trash: ["workspace"],
    };
    Object.keys(INDEXES).forEach(function (name) {
      try {
        var col = dao.findCollectionByNameOrId(name);
        var ours = INDEXES[name].map(function (f) { return "`idx_" + name + "_" + f + "`"; });
        var kept = [];
        var current = col.indexes || [];
        for (var i = 0; i < current.length; i++) {
          var s = String(current[i]);
          if (!ours.some(function (o) { return s.indexOf(o) !== -1; })) kept.push(s);
        }
        col.indexes = kept;
        dao.saveCollection(col);
      } catch (e) {
        /* collection gone, nothing to undo */
      }
    });
  },
);
