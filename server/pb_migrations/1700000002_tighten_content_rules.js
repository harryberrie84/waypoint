/// <reference path="../pb_data/types.d.ts" />
//
// 1700000002_tighten_content_rules.js, enforce the workspace boundary at the
// record level. Before this, pages/tables/table_rows/comments/presence were
// readable by ANY signed-in account (listRule/viewRule = `@request.auth.id != ""`),
// so the membership gate existed only in the UI, not the API. This requires the
// requester to be a member of the record's workspace to read it, and to edit or
// delete pages/tables/rows. PocketBase 0.22 JS migration.
//
// ORDER MATTERS:
//   1. The `workspace` fields + the three workspace collections must already
//      exist, and 1700000000_workspaces_backfill must have run, otherwise a
//      record with an empty `workspace` fails the membership join and disappears
//      (including from its owner). Run the backfill first.
//   2. BACK UP pb_data and test on a copy. There is no automation test for API
//      rules; verify by hand with a non-member account (it should get nothing).
//
// Create rules are deliberately left as `@request.auth.id != ""`: the client
// always stamps `workspace` on create, and tightening create needs a deeper
// `@request.data` join that should be verified on a live instance first. The
// read leak (the actual hole) is closed by list/view; cross-workspace edits are
// closed by update/delete.

var MEMBER = 'workspace.workspace_members_via_workspace.user ?= @request.auth.id';
var MEMBER_VIA_PAGE = 'page.workspace.workspace_members_via_workspace.user ?= @request.auth.id';
var AUTHED = '@request.auth.id != ""';

migrate(
  function (db) {
    var dao = new Dao(db);
    var set = function (name, rules) {
      var c = dao.findCollectionByNameOrId(name);
      for (var k in rules) c[k] = rules[k];
      dao.saveCollection(c);
    };

    ["pages", "tables", "table_rows"].forEach(function (n) {
      set(n, {
        listRule: AUTHED + " && " + MEMBER,
        viewRule: AUTHED + " && " + MEMBER,
        updateRule: AUTHED + " && " + MEMBER,
        deleteRule: AUTHED + " && " + MEMBER,
      });
    });

    set("comments", {
      listRule: AUTHED + " && " + MEMBER_VIA_PAGE,
      viewRule: AUTHED + " && " + MEMBER_VIA_PAGE,
    });
    set("presence", {
      listRule: AUTHED + " && " + MEMBER_VIA_PAGE,
      viewRule: AUTHED + " && " + MEMBER_VIA_PAGE,
    });
  },
  function (db) {
    // Revert to the permissive pre-change rules (read for everyone authed).
    var dao = new Dao(db);
    var set = function (name, rules) {
      var c = dao.findCollectionByNameOrId(name);
      for (var k in rules) c[k] = rules[k];
      dao.saveCollection(c);
    };

    ["pages", "tables", "table_rows"].forEach(function (n) {
      set(n, { listRule: AUTHED, viewRule: AUTHED, updateRule: AUTHED, deleteRule: AUTHED });
    });
    set("comments", { listRule: AUTHED, viewRule: AUTHED });
    set("presence", { listRule: AUTHED, viewRule: AUTHED });
  },
);
