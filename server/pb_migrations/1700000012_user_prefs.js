/// <reference path="../pb_data/types.d.ts" />
//
// 1700000012_user_prefs.js, add a per-user `prefs` JSON field to the auth
// `users` collection. It holds private, per-user UI preferences that should
// follow the person across their devices but never be shared with other
// workspace members. First use: `prefs.landing` = { workspaceId: pageId }, the
// home page each workspace opens to (src/lib/landing.ts).
//
// A user updates only their OWN record (the users collection's default
// updateRule, `id = @request.auth.id`, already allows this), so no rule change
// is needed. The client mirrors the value to localStorage too, so it degrades
// gracefully and works per-device before/without this field.
//
// PocketBase 0.22 JS migration. Install: copy to pb_migrations/, restart serve.

migrate(
  function (db) {
    var dao = new Dao(db);
    var users = dao.findCollectionByNameOrId("users");
    if (!users.schema.getFieldByName("prefs")) {
      users.schema.addField(
        new SchemaField({
          name: "prefs",
          type: "json",
          required: false,
          options: { maxSize: 200000 },
        }),
      );
      dao.saveCollection(users);
    }
  },
  function (db) {
    var dao = new Dao(db);
    try {
      var users = dao.findCollectionByNameOrId("users");
      var f = users.schema.getFieldByName("prefs");
      if (f) {
        users.schema.removeField(f.id);
        dao.saveCollection(users);
      }
    } catch (e) {
      /* collection gone, nothing to undo */
    }
  },
);
