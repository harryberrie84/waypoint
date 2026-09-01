/// <reference path="../pb_data/types.d.ts" />
//
// 1700000005_comment_threads.js, adds a `thread` field to the `comments`
// collection so a comment can be anchored to a highlighted span of text (an
// inline comment), not just a page or a row. The client tags inline comments with
// a thread id that also lives on the editor mark; page and row threads leave it
// empty. Defensively ensures `row` and `mentions` exist too, since older installs
// added those by hand. PocketBase 0.22 JS migration.
//
// Install: copy to `pb_migrations/` next to the binary, then restart serve.

migrate(
  function (db) {
    var dao = new Dao(db);
    var col = dao.findCollectionByNameOrId("comments");

    function ensure(def) {
      if (!col.schema.getFieldByName(def.name)) col.schema.addField(new SchemaField(def));
    }

    ensure({ name: "thread", type: "text", required: false, options: { max: 60 } });
    ensure({ name: "row", type: "text", required: false, options: { max: 60 } });
    ensure({ name: "mentions", type: "json", required: false, options: { maxSize: 20000 } });

    dao.saveCollection(col);
  },
  function (db) {
    var dao = new Dao(db);
    var col = dao.findCollectionByNameOrId("comments");
    var f = col.schema.getFieldByName("thread");
    if (f) {
      col.schema.removeField(f.id);
      dao.saveCollection(col);
    }
  },
);
