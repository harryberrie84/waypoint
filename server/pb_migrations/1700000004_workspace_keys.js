/// <reference path="../pb_data/types.d.ts" />
//
// 1700000004_workspace_keys.js, shared-workspace encryption.
//   1. `workspace_keys`: the workspace content key wrapped to each member.
//   2. adds `publicKey` to `workspace_members` so members can wrap the key to one
//      another. PocketBase 0.22 JS migration.
//
// Install: copy to `pb_migrations/` next to the binary, then restart serve.
// (Or do it by hand in the Admin UI, fields/rules are in pocketbase/schema.json.)

migrate(
  function (db) {
    var dao = new Dao(db);
    var wsId = dao.findCollectionByNameOrId("workspaces").id;

    var col = new Collection({
      name: "workspace_keys",
      type: "base",
      schema: [
        { name: "workspace", type: "relation", required: true, options: { collectionId: wsId, cascadeDelete: true, maxSelect: 1 } },
        { name: "user", type: "relation", required: true, options: { collectionId: "_pb_users_auth_", cascadeDelete: true, maxSelect: 1 } },
        { name: "wrappedKey", type: "text", required: false, options: { max: 4000 } },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_workspace_keys ON workspace_keys (workspace, user)"],
      listRule: '@request.auth.id != "" && workspace.workspace_members_via_workspace.user ?= @request.auth.id',
      viewRule: '@request.auth.id != "" && workspace.workspace_members_via_workspace.user ?= @request.auth.id',
      createRule: '@request.auth.id != "" && workspace.workspace_members_via_workspace.user ?= @request.auth.id',
      updateRule: '@request.auth.id != "" && workspace.workspace_members_via_workspace.user ?= @request.auth.id',
      deleteRule: '@request.auth.id != "" && workspace.workspace_members_via_workspace.user ?= @request.auth.id',
    });
    dao.saveCollection(col);

    // Add publicKey to workspace_members.
    var members = dao.findCollectionByNameOrId("workspace_members");
    members.schema.addField(
      new SchemaField({ name: "publicKey", type: "text", required: false, options: { max: 1000 } }),
    );
    dao.saveCollection(members);
  },
  function (db) {
    var dao = new Dao(db);
    dao.deleteCollection(dao.findCollectionByNameOrId("workspace_keys"));
    var members = dao.findCollectionByNameOrId("workspace_members");
    members.schema.removeField(members.schema.getFieldByName("publicKey").id);
    dao.saveCollection(members);
  },
);
