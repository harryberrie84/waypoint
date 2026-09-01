/// <reference path="../pb_data/types.d.ts" />
//
// 1700000010_private_pages_and_collection_scope.js, make "private" a real
// server-side boundary and stop the newer collections leaking across workspaces.
// Two holes, both "locked in the UI, wide open in the API":
//
// 1) A PRIVATE PAGE was only private on the client. The pages list/view rule
//    gated on workspace membership but never looked at a page's visibility,
//    editors or viewers, so a page the owner marked private was filtered out of
//    everyone else's tree yet still readable through the API by any member of
//    the workspace (title, and for a plaintext workspace the body). Worse, the
//    visibility/editors/viewers fields did not exist on the collection at all,
//    so the client's writes were silently dropped, "private" never even reached
//    the server. This adds the three fields and pushes the same check the client
//    uses (selectMyRole in src/store/useData.ts) into the rules:
//      read  (list/view)   = member && (not private || owner || editor || viewer)
//      write (update/del)  = member && (not private || owner || editor)
//    Existing pages have an empty visibility (reads as "workspace"), so nothing
//    that was visible before is hidden now; only pages explicitly set private
//    narrow, and only to the owner, editors and viewers.
//
// 2) yupdates / page_versions / uploads shipped with `@request.auth.id != ""`,
//    so any logged-in account in ANY workspace could list every relay update and
//    every page backup, and list or DELETE every upload. Encryption hides the
//    bytes for encrypted workspaces, but the metadata (who edits what, which
//    pages have history) was open and a plaintext workspace's backups were
//    readable outright.
//      - yupdates / page_versions carry a `workspace` id (the client always
//        stamps it, same backfilled invariant pages rely on); scope read and
//        delete to members of that workspace via @collection.workspace_members.
//      - uploads has no workspace/owner field to scope by and must stay publicly
//        VIEWABLE (an <img src> loads it with no auth), so its leak is the
//        enumerable list and the open delete, not the file URL. Lock list and
//        delete (the client only ever creates an upload and builds its URL, it
//        never lists or deletes one), which removes the enumeration and the
//        cross-tenant delete without touching the public file URL.
//
// table_rows is deliberately NOT touched here: a row has no visibility/editors/
// viewers and no link back to a page, so page privacy can't be expressed on it
// yet (it already gates on workspace membership). Carrying privacy onto tables
// is a follow-up.
//
// PocketBase 0.22 JS migration. BACK UP pb_data and test on a copy, API rules
// have no automated test. The down step restores the previous rules and drops
// the three page fields.

migrate(
  function (db) {
    var dao = new Dao(db);

    // --- 1) pages: add the privacy fields, then enforce them ----------------
    var pages = dao.findCollectionByNameOrId("pages");
    if (!pages.schema.getFieldByName("visibility")) {
      pages.schema.addField(new SchemaField({
        name: "visibility", type: "select", required: false,
        options: { maxSelect: 1, values: ["workspace", "private"] },
      }));
    }
    var usersId = dao.findCollectionByNameOrId("users").id;
    ["editors", "viewers"].forEach(function (name) {
      if (!pages.schema.getFieldByName(name)) {
        pages.schema.addField(new SchemaField({
          name: name, type: "relation", required: false,
          options: { collectionId: usersId, cascadeDelete: false, minSelect: null, maxSelect: null },
        }));
      }
    });
    dao.saveCollection(pages); // save the fields before any rule references them

    // The same predicate selectMyRole uses: the owner always wins; editors and
    // viewers grant access on a private page; a non-private page stays open to
    // any member. Viewers read but do not write.
    var MEMBER = 'workspace.workspace_members_via_workspace.user ?= @request.auth.id';
    var READ = '(visibility != "private" || owner = @request.auth.id || editors.id ?= @request.auth.id || viewers.id ?= @request.auth.id)';
    var WRITE = '(visibility != "private" || owner = @request.auth.id || editors.id ?= @request.auth.id)';
    var PUBLIC = '(publicToken != "" && publicToken = @request.query.token)';

    pages.listRule = '(@request.auth.id != "" && ' + MEMBER + ' && ' + READ + ') || ' + PUBLIC;
    pages.viewRule = pages.listRule;
    pages.updateRule = '@request.auth.id != "" && ' + MEMBER + ' && ' + WRITE;
    pages.deleteRule = pages.updateRule;
    dao.saveCollection(pages);

    // --- 2) scope the newer collections to their workspace ------------------
    // workspace is a plain text id on these collections, so join through
    // @collection.workspace_members the way the workspace_members create rule
    // already joins @collection.workspace_invites (same-row semantics).
    var WS_MEMBER =
      '@request.auth.id != "" ' +
      '&& @collection.workspace_members.workspace ?= workspace ' +
      '&& @collection.workspace_members.user ?= @request.auth.id';

    ["yupdates", "page_versions"].forEach(function (name) {
      var c;
      try { c = dao.findCollectionByNameOrId(name); } catch (e) { return; }
      c.listRule = WS_MEMBER;
      c.viewRule = WS_MEMBER;
      // Create stays account-gated: the client stamps workspace itself, and
      // tightening create needs a deeper @request.data join, the same call the
      // 1700000002 migration made for pages/tables/rows.
      c.createRule = '@request.auth.id != ""';
      c.deleteRule = WS_MEMBER;
      dao.saveCollection(c);
    });

    // uploads: nothing to scope by, and the file must stay publicly viewable for
    // an <img src>. Lock list and delete (the client never does either), which
    // kills enumeration and cross-tenant deletes; leave view public and create
    // account-gated.
    try {
      var up = dao.findCollectionByNameOrId("uploads");
      up.listRule = null;   // no enumerating every workspace's files
      up.viewRule = "";     // keep public so an <img src> loads with no auth
      up.createRule = '@request.auth.id != ""';
      up.deleteRule = null; // no deleting another workspace's files
      dao.saveCollection(up);
    } catch (e) {}
  },
  function (db) {
    var dao = new Dao(db);

    // pages: restore the membership-only rules and drop the privacy fields.
    var pages = dao.findCollectionByNameOrId("pages");
    var MEMBER = 'workspace.workspace_members_via_workspace.user ?= @request.auth.id';
    var PUBLIC = '(publicToken != "" && publicToken = @request.query.token)';
    pages.listRule = '(@request.auth.id != "" && ' + MEMBER + ') || ' + PUBLIC;
    pages.viewRule = pages.listRule;
    pages.updateRule = '@request.auth.id != "" && ' + MEMBER;
    pages.deleteRule = pages.updateRule;
    ["editors", "viewers", "visibility"].forEach(function (name) {
      var f = pages.schema.getFieldByName(name);
      if (f) pages.schema.removeField(f.id);
    });
    dao.saveCollection(pages);

    var AUTHED = '@request.auth.id != ""';
    ["yupdates", "page_versions"].forEach(function (name) {
      try {
        var c = dao.findCollectionByNameOrId(name);
        c.listRule = AUTHED; c.viewRule = AUTHED; c.createRule = AUTHED; c.deleteRule = AUTHED;
        dao.saveCollection(c);
      } catch (e) {}
    });
    try {
      var up = dao.findCollectionByNameOrId("uploads");
      up.listRule = AUTHED; up.viewRule = ""; up.createRule = AUTHED; up.deleteRule = AUTHED;
      dao.saveCollection(up);
    } catch (e) {}
  },
);
