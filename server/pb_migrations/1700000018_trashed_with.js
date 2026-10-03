/// <reference path="../pb_data/types.d.ts" />

migrate(
  function (db) {
    var dao = new Dao(db);
    var col;
    try {
      col = dao.findCollectionByNameOrId("pages");
    } catch (e) {
      return;
    }
    if (col.schema.getFieldByName("trashedWith")) return;
    col.schema.addField(new SchemaField({ name: "trashedWith", type: "text", required: false, options: { min: null, max: 20, pattern: "" } }));
    dao.saveCollection(col);
  },
  function () {},
);
