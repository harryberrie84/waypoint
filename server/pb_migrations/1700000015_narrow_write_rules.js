/// <reference path="../pb_data/types.d.ts" />

migrate(
  function (db) {
    var dao = new Dao(db);
    var rules = {
        "pages": {
            "listRule": "(@request.auth.id != \"\" && @collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id && (visibility != \"private\" || owner = @request.auth.id || editors:each ?= @request.auth.id || viewers:each ?= @request.auth.id)) || (publicToken != \"\" && publicToken = @request.query.token)",
            "viewRule": "(@request.auth.id != \"\" && @collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id && (visibility != \"private\" || owner = @request.auth.id || editors:each ?= @request.auth.id || viewers:each ?= @request.auth.id)) || (publicToken != \"\" && publicToken = @request.query.token)",
            "createRule": "@request.auth.id != \"\" && (@collection.workspace_members:wm.workspace ?= workspace && @collection.workspace_members:wm.user ?= @request.auth.id && @collection.workspace_members:wm.role ?!= \"viewer\")",
            "updateRule": "@request.auth.id != \"\" && @collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id && (visibility != \"private\" || owner = @request.auth.id || editors:each ?= @request.auth.id) && (@request.data.workspace:isset = false || (@collection.workspace_members:nwm.workspace ?= @request.data.workspace && @collection.workspace_members:nwm.user ?= @request.auth.id && @collection.workspace_members:nwm.role ?!= \"viewer\")) && (@collection.workspace_members:wm.workspace ?= workspace && @collection.workspace_members:wm.user ?= @request.auth.id && @collection.workspace_members:wm.role ?!= \"viewer\") && (owner = @request.auth.id || editors:each ?= @request.auth.id || viewers:length = 0 || viewers.id != @request.auth.id)",
            "deleteRule": "@request.auth.id != \"\" && @collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id && (visibility != \"private\" || owner = @request.auth.id || editors:each ?= @request.auth.id) && (@collection.workspace_members:wm.workspace ?= workspace && @collection.workspace_members:wm.user ?= @request.auth.id && @collection.workspace_members:wm.role ?!= \"viewer\") && (owner = @request.auth.id || editors:each ?= @request.auth.id || viewers:length = 0 || viewers.id != @request.auth.id)"
        },
        "tables": {
            "listRule": "@request.auth.id != \"\" && @collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id",
            "viewRule": "@request.auth.id != \"\" && @collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id",
            "createRule": "@request.auth.id != \"\" && (@collection.workspace_members:wm.workspace ?= workspace && @collection.workspace_members:wm.user ?= @request.auth.id && @collection.workspace_members:wm.role ?!= \"viewer\")",
            "updateRule": "@request.auth.id != \"\" && (@collection.workspace_members:wm.workspace ?= workspace && @collection.workspace_members:wm.user ?= @request.auth.id && @collection.workspace_members:wm.role ?!= \"viewer\") && (@request.data.workspace:isset = false || (@collection.workspace_members:nwm.workspace ?= @request.data.workspace && @collection.workspace_members:nwm.user ?= @request.auth.id && @collection.workspace_members:nwm.role ?!= \"viewer\"))",
            "deleteRule": "@request.auth.id != \"\" && (@collection.workspace_members:wm.workspace ?= workspace && @collection.workspace_members:wm.user ?= @request.auth.id && @collection.workspace_members:wm.role ?!= \"viewer\")"
        },
        "table_rows": {
            "listRule": "@request.auth.id != \"\" && @collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id",
            "viewRule": "@request.auth.id != \"\" && @collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id",
            "createRule": "@request.auth.id != \"\" && (@collection.workspace_members:wm.workspace ?= workspace && @collection.workspace_members:wm.user ?= @request.auth.id && @collection.workspace_members:wm.role ?!= \"viewer\")",
            "updateRule": "@request.auth.id != \"\" && (@collection.workspace_members:wm.workspace ?= workspace && @collection.workspace_members:wm.user ?= @request.auth.id && @collection.workspace_members:wm.role ?!= \"viewer\") && (@request.data.workspace:isset = false || (@collection.workspace_members:nwm.workspace ?= @request.data.workspace && @collection.workspace_members:nwm.user ?= @request.auth.id && @collection.workspace_members:nwm.role ?!= \"viewer\"))",
            "deleteRule": "@request.auth.id != \"\" && (@collection.workspace_members:wm.workspace ?= workspace && @collection.workspace_members:wm.user ?= @request.auth.id && @collection.workspace_members:wm.role ?!= \"viewer\")"
        },
        "comments": {
            "listRule": "@request.auth.id != \"\" && @collection.workspace_members:pmem.workspace ?= page.workspace && @collection.workspace_members:pmem.user ?= @request.auth.id",
            "viewRule": "@request.auth.id != \"\" && @collection.workspace_members:pmem.workspace ?= page.workspace && @collection.workspace_members:pmem.user ?= @request.auth.id",
            "createRule": "@request.auth.id != \"\" && author = @request.auth.id && (@collection.workspace_members:wpm.workspace ?= page.workspace && @collection.workspace_members:wpm.user ?= @request.auth.id && @collection.workspace_members:wpm.role ?!= \"viewer\")",
            "updateRule": "author = @request.auth.id && @request.data.page:isset = false && @request.data.author:isset = false && (@collection.workspace_members:wpm.workspace ?= page.workspace && @collection.workspace_members:wpm.user ?= @request.auth.id && @collection.workspace_members:wpm.role ?!= \"viewer\")",
            "deleteRule": "author = @request.auth.id"
        },
        "presence": {
            "listRule": "@request.auth.id != \"\" && @collection.workspace_members:pmem.workspace ?= page.workspace && @collection.workspace_members:pmem.user ?= @request.auth.id",
            "viewRule": "@request.auth.id != \"\" && @collection.workspace_members:pmem.workspace ?= page.workspace && @collection.workspace_members:pmem.user ?= @request.auth.id",
            "createRule": "@request.auth.id != \"\" && user = @request.auth.id && (@collection.workspace_members:pmem.workspace ?= page.workspace && @collection.workspace_members:pmem.user ?= @request.auth.id)",
            "updateRule": "user = @request.auth.id && (@request.data.user:isset = false || @request.data.user = @request.auth.id) && (@request.data.page:isset = false || @request.data.page.workspace.workspace_members_via_workspace.user ?= @request.auth.id)",
            "deleteRule": "user = @request.auth.id"
        },
        "workspace_members": {
            "listRule": "@request.auth.id != \"\" && @collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id",
            "viewRule": "@request.auth.id != \"\" && @collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id",
            "createRule": "@request.auth.id != \"\" && @request.data.user = @request.auth.id && @request.data.workspace.owner ?= @request.auth.id",
            "updateRule": "@request.auth.id != \"\" && @request.data.workspace:isset = false && @request.data.user:isset = false && (@request.data.publicKey:isset = false || user = @request.auth.id) && ((workspace.owner = @request.auth.id || (@collection.workspace_members:adm.workspace ?= workspace && @collection.workspace_members:adm.user ?= @request.auth.id && @collection.workspace_members:adm.role ?= \"admin\")) || (user = @request.auth.id && @request.data.role:isset = false))",
            "deleteRule": "@request.auth.id != \"\" && (user = @request.auth.id || (workspace.owner = @request.auth.id || (@collection.workspace_members:adm.workspace ?= workspace && @collection.workspace_members:adm.user ?= @request.auth.id && @collection.workspace_members:adm.role ?= \"admin\")))"
        },
        "workspace_keys": {
            "listRule": "@request.auth.id != \"\" && @collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id",
            "viewRule": "@request.auth.id != \"\" && @collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id",
            "createRule": "@request.auth.id != \"\" && @collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id",
            "updateRule": "@request.auth.id != \"\" && (@collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id) && (user = @request.auth.id || (workspace.owner = @request.auth.id || (@collection.workspace_members:adm.workspace ?= workspace && @collection.workspace_members:adm.user ?= @request.auth.id && @collection.workspace_members:adm.role ?= \"admin\"))) && @request.data.workspace:isset = false",
            "deleteRule": "@request.auth.id != \"\" && (@collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id) && (user = @request.auth.id || (workspace.owner = @request.auth.id || (@collection.workspace_members:adm.workspace ?= workspace && @collection.workspace_members:adm.user ?= @request.auth.id && @collection.workspace_members:adm.role ?= \"admin\")))"
        },
        "yupdates": {
            "listRule": "@request.auth.id != \"\" && workspace != \"\" && @collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id",
            "viewRule": "@request.auth.id != \"\" && workspace != \"\" && @collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id",
            "createRule": "@request.auth.id != \"\" && workspace != \"\" && (@collection.workspace_members:wm.workspace ?= workspace && @collection.workspace_members:wm.user ?= @request.auth.id && @collection.workspace_members:wm.role ?!= \"viewer\")",
            "updateRule": null,
            "deleteRule": "@request.auth.id != \"\" && workspace != \"\" && (@collection.workspace_members:wm.workspace ?= workspace && @collection.workspace_members:wm.user ?= @request.auth.id && @collection.workspace_members:wm.role ?!= \"viewer\")"
        },
        "page_versions": {
            "listRule": "@request.auth.id != \"\" && workspace != \"\" && @collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id",
            "viewRule": "@request.auth.id != \"\" && workspace != \"\" && @collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id",
            "createRule": "@request.auth.id != \"\" && workspace != \"\" && (@collection.workspace_members:wm.workspace ?= workspace && @collection.workspace_members:wm.user ?= @request.auth.id && @collection.workspace_members:wm.role ?!= \"viewer\")",
            "updateRule": null,
            "deleteRule": "@request.auth.id != \"\" && workspace != \"\" && (@collection.workspace_members:wm.workspace ?= workspace && @collection.workspace_members:wm.user ?= @request.auth.id && @collection.workspace_members:wm.role ?!= \"viewer\")"
        },
        "uploads": {
            "listRule": "@request.auth.id != \"\" && workspace != \"\" && @collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id",
            "viewRule": "",
            "createRule": "@request.auth.id != \"\" && (workspace = \"\" || (@collection.workspace_members:wm.workspace ?= workspace && @collection.workspace_members:wm.user ?= @request.auth.id && @collection.workspace_members:wm.role ?!= \"viewer\"))",
            "updateRule": null,
            "deleteRule": "@request.auth.id != \"\" && workspace != \"\" && (@collection.workspace_members:wm.workspace ?= workspace && @collection.workspace_members:wm.user ?= @request.auth.id && @collection.workspace_members:wm.role ?!= \"viewer\")"
        },
        "file_trash": {
            "listRule": "@request.auth.id != \"\" && workspace != \"\" && @collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id",
            "viewRule": "@request.auth.id != \"\" && workspace != \"\" && @collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id",
            "createRule": "@request.auth.id != \"\" && workspace != \"\" && (@collection.workspace_members:wm.workspace ?= workspace && @collection.workspace_members:wm.user ?= @request.auth.id && @collection.workspace_members:wm.role ?!= \"viewer\")",
            "updateRule": "@request.auth.id != \"\" && workspace != \"\" && (@collection.workspace_members:wm.workspace ?= workspace && @collection.workspace_members:wm.user ?= @request.auth.id && @collection.workspace_members:wm.role ?!= \"viewer\")",
            "deleteRule": "@request.auth.id != \"\" && workspace != \"\" && (@collection.workspace_members:wm.workspace ?= workspace && @collection.workspace_members:wm.user ?= @request.auth.id && @collection.workspace_members:wm.role ?!= \"viewer\")"
        },
        "reminders": {
            "listRule": "@request.auth.id != \"\" && workspace != \"\" && @collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id",
            "viewRule": "@request.auth.id != \"\" && workspace != \"\" && @collection.workspace_members:mem.workspace ?= workspace && @collection.workspace_members:mem.user ?= @request.auth.id",
            "createRule": "@request.auth.id != \"\" && workspace != \"\" && (@collection.workspace_members:wm.workspace ?= workspace && @collection.workspace_members:wm.user ?= @request.auth.id && @collection.workspace_members:wm.role ?!= \"viewer\")",
            "updateRule": "@request.auth.id != \"\" && workspace != \"\" && (@collection.workspace_members:wm.workspace ?= workspace && @collection.workspace_members:wm.user ?= @request.auth.id && @collection.workspace_members:wm.role ?!= \"viewer\")",
            "deleteRule": "@request.auth.id != \"\" && workspace != \"\" && (@collection.workspace_members:wm.workspace ?= workspace && @collection.workspace_members:wm.user ?= @request.auth.id && @collection.workspace_members:wm.role ?!= \"viewer\")"
        }
    };
    Object.keys(rules).forEach(function (name) {
      var col;
      try {
        col = dao.findCollectionByNameOrId(name);
      } catch (e) {
        return;
      }
      var r = rules[name];
      col.listRule = r.listRule;
      col.viewRule = r.viewRule;
      col.createRule = r.createRule;
      col.updateRule = r.updateRule;
      col.deleteRule = r.deleteRule;
      dao.saveCollection(col);
    });
  },
  function (db) {},
);
