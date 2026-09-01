/// <reference path="../pb_data/types.d.ts" />
//
// 1700000006_public_pages.js, makes public page links (and shared recipes) work:
// adds the `pages.publicToken` field and lets an anonymous request read a page
// when it carries a matching ?token=. Appends the public clause to whatever the
// list/view rules already are, so existing member access is untouched. Idempotent.
// PocketBase 0.22 JS migration.
//
// Install: copy to `pb_migrations/` next to the binary, then restart serve.

migrate(
  function (db) {
    var dao = new Dao(db);
    var col = dao.findCollectionByNameOrId("pages");

    if (!col.schema.getFieldByName("publicToken")) {
      col.schema.addField(new SchemaField({ name: "publicToken", type: "text", required: false, options: { max: 64 } }));
    }

    var pub = 'publicToken != "" && publicToken = @request.query.token';
    function open(rule) {
      // null = admin-only, "" = already open to anyone: leave those alone. Only
      // widen a real auth rule, and never add the clause twice.
      if (rule == null || rule === "") return rule;
      if (rule.indexOf("@request.query.token") !== -1) return rule;
      return "(" + rule + ") || (" + pub + ")";
    }

    col.listRule = open(col.listRule);
    col.viewRule = open(col.viewRule);

    dao.saveCollection(col);
  },
  function (db) {
    var dao = new Dao(db);
    var col = dao.findCollectionByNameOrId("pages");
    var f = col.schema.getFieldByName("publicToken");
    if (f) {
      col.schema.removeField(f.id);
      dao.saveCollection(col);
    }
  },
);
