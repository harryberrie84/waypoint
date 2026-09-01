/// <reference path="../pb_data/types.d.ts" />
//
// 1700000003_user_keys.js, creates `user_keys` for end-to-end content
// encryption. One row per user, holding ONLY wrapped (encrypted) copies of that
// user's master key: the server never sees the key in usable form, so the
// operator can't read encrypted page content. PocketBase 0.22 JS migration.
//
// Install: copy to `pb_migrations/` next to the binary, then restart serve.
// (Or add the collection by hand, fields and rules are in pocketbase/schema.json.)

migrate(
  function (db) {
    var dao = new Dao(db);

    var col = new Collection({
      name: "user_keys",
      type: "base",
      schema: [
        {
          name: "user",
          type: "relation",
          required: true,
          options: { collectionId: "_pb_users_auth_", cascadeDelete: true, maxSelect: 1 },
        },
        { name: "wrappedKey", type: "text", required: false, options: { max: 4000 } },
        { name: "pwSalt", type: "text", required: false, options: { max: 200 } },
        { name: "recoveryKey", type: "text", required: false, options: { max: 4000 } },
        { name: "recoverySalt", type: "text", required: false, options: { max: 200 } },
        { name: "iterations", type: "number", required: false, options: {} },
        { name: "publicKey", type: "text", required: false, options: { max: 1000 } },
        { name: "wrappedPrivateKey", type: "text", required: false, options: { max: 4000 } },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_user_keys_user ON user_keys (user)"],
      listRule: '@request.auth.id != "" && user = @request.auth.id',
      viewRule: '@request.auth.id != "" && user = @request.auth.id',
      createRule: '@request.auth.id != "" && @request.data.user = @request.auth.id',
      updateRule: '@request.auth.id != "" && user = @request.auth.id',
      deleteRule: '@request.auth.id != "" && user = @request.auth.id',
    });

    dao.saveCollection(col);
  },
  function (db) {
    var dao = new Dao(db);
    dao.deleteCollection(dao.findCollectionByNameOrId("user_keys"));
  },
);
