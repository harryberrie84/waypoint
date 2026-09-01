/// <reference path="../pb_data/types.d.ts" />
//
// 1700000008_image_icons.js, lets a page or workspace icon be an uploaded image,
// not just an emoji. Two parts:
//   - the `icon` text field on pages and workspaces was capped at 16 chars (fine
//     for an emoji, far too small for an image URL), so an image icon failed to
//     save and vanished on reload. Widen it.
//   - ensure the `uploads` collection exists so an image is stored as a real file
//     and the icon holds a short, durable URL instead of a heavy data URL. Files
//     are publicly viewable (unguessable ids) so an <img> tag can load them.
//
// PocketBase 0.22 JS migration. Install: copy to pb_migrations/, restart serve.

migrate(
  function (db) {
    var dao = new Dao(db);

    ["pages", "workspaces"].forEach(function (name) {
      var col = dao.findCollectionByNameOrId(name);
      var f = col.schema.getFieldByName("icon");
      if (f) {
        f.options = f.options || {};
        f.options.max = 2000000; // same ceiling as cover; holds a URL or a data-URL fallback
        dao.saveCollection(col);
      }
    });

    var hasUploads = true;
    try {
      dao.findCollectionByNameOrId("uploads");
    } catch (e) {
      hasUploads = false;
    }
    if (!hasUploads) {
      var uploads = new Collection({
        name: "uploads",
        type: "base",
        schema: [
          { name: "file", type: "file", required: true, options: { maxSelect: 1, maxSize: 5242880 } },
        ],
        listRule: '@request.auth.id != ""',
        viewRule: "", // public read so an <img src> can load the file
        createRule: '@request.auth.id != ""',
        deleteRule: '@request.auth.id != ""',
      });
      dao.saveCollection(uploads);
    }
  },
  function (db) {
    var dao = new Dao(db);
    ["pages", "workspaces"].forEach(function (name) {
      try {
        var col = dao.findCollectionByNameOrId(name);
        var f = col.schema.getFieldByName("icon");
        if (f) {
          f.options = f.options || {};
          f.options.max = 16;
          dao.saveCollection(col);
        }
      } catch (e) {}
    });
    // Leave the uploads collection in place on revert (it may hold files).
  },
);
