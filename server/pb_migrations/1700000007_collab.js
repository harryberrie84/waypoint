/// <reference path="../pb_data/types.d.ts" />
//
// 1700000007_collab.js, real-time co-editing on encrypted pages. Adds:
//   - a `ydoc` field on `pages`, the encrypted Yjs snapshot (base64 of an
//     envelope), so a page that joins late can sync from one blob instead of
//     replaying every edit. The server never reads it, it is ciphertext.
//   - a `yupdates` collection, a relay of incremental Yjs updates between the
//     people on a page right now. `data` is an encrypted update (the workspace
//     key, the server cannot read it); clients subscribe by `page` over realtime,
//     decrypt and apply. Rows are disposable, the snapshot is the durable copy.
//
// The plaintext page content is still saved as before (for search, mirrors,
// public shares and print), so nothing downstream changes; this is additive.
// PocketBase 0.22 JS migration. Install: copy to pb_migrations/, restart serve.

migrate(
  function (db) {
    var dao = new Dao(db);

    // 1) pages.ydoc, the encrypted snapshot.
    var pages = dao.findCollectionByNameOrId("pages");
    if (!pages.schema.getFieldByName("ydoc")) {
      pages.schema.addField(new SchemaField({ name: "ydoc", type: "text", required: false, options: { max: 5000000 } }));
      dao.saveCollection(pages);
    }

    // 2) yupdates, the live relay. Content is encrypted, so reads are auth-gated
    // and the bytes are opaque; the author is stamped on create.
    var col = new Collection({
      name: "yupdates",
      type: "base",
      schema: [
        { name: "page", type: "text", required: true, options: { max: 60 } },
        { name: "workspace", type: "text", required: false, options: { max: 60 } },
        { name: "author", type: "text", required: false, options: { max: 60 } },
        { name: "data", type: "text", required: true, options: { max: 5000000 } },
      ],
      indexes: ["CREATE INDEX idx_yupdates_page ON yupdates (page)"],
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
      dao.deleteCollection(dao.findCollectionByNameOrId("yupdates"));
    } catch (e) {}
    var pages = dao.findCollectionByNameOrId("pages");
    var f = pages.schema.getFieldByName("ydoc");
    if (f) {
      pages.schema.removeField(f.id);
      dao.saveCollection(pages);
    }
  },
);
