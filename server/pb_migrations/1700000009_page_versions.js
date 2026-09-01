/// <reference path="../pb_data/types.d.ts" />
//
// 1700000009_page_versions.js, lightweight page backups. A `page_versions` row is a
// snapshot of a page's content, taken now and then as you edit, so you can roll a
// page back. `content` is stored exactly as the page stores it, so for an encrypted
// workspace it is ciphertext the server cannot read. The client throttles how often
// a snapshot is taken and prunes old ones (a cap per page, and a few days), so this
// never grows without bound.
//
// PocketBase 0.22 JS migration. Install: copy to pb_migrations/, restart serve.

migrate(
  function (db) {
    var dao = new Dao(db);
    var col = new Collection({
      name: "page_versions",
      type: "base",
      schema: [
        { name: "page", type: "text", required: true, options: { max: 60 } },
        { name: "workspace", type: "text", required: false, options: { max: 60 } },
        { name: "content", type: "text", required: false, options: { max: 5000000 } },
      ],
      indexes: ["CREATE INDEX idx_page_versions_page ON page_versions (page)"],
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != ""',
      deleteRule: '@request.auth.id != ""',
    });
    dao.saveCollection(col);
  },
  function (db) {
    var dao = new Dao(db);
    try {
      dao.deleteCollection(dao.findCollectionByNameOrId("page_versions"));
    } catch (e) {}
  },
);
