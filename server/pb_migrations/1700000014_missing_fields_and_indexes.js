/// <reference path="../pb_data/types.d.ts" />

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
      pages: ["workspace", "parent", "updated"],
      tables: ["workspace", "updated"],
      table_rows: ["table", "workspace", "updated"],
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
        return;
      }

      (FIELDS[name] || []).forEach(function (f) {
        if (!col.schema.getFieldByName(f.name)) col.schema.addField(new SchemaField(f));
      });

      var have = [];
      var current = col.indexes || [];
      for (var i = 0; i < current.length; i++) have.push(String(current[i]));
      (INDEXES[name] || []).forEach(function (field) {
        if (field !== "updated" && !col.schema.getFieldByName(field)) return;
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
    var dao = new Dao(db);
    var INDEXES = {
      pages: ["workspace", "parent", "updated"],
      tables: ["workspace", "updated"],
      table_rows: ["table", "workspace", "updated"],
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
      }
    });
  },
);
