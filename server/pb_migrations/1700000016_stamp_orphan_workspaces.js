/// <reference path="../pb_data/types.d.ts" />

migrate(
  function (db) {
    var tables = ["yupdates", "page_versions"];
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      try {
        db.newQuery(
          "UPDATE `" + t + "` SET workspace = (SELECT p.workspace FROM pages p WHERE p.id = `" + t + "`.page) " +
            "WHERE (workspace = '' OR workspace IS NULL) " +
            "AND EXISTS (SELECT 1 FROM pages p WHERE p.id = `" + t + "`.page AND p.workspace != '')",
        ).execute();
      } catch (e) {
        console.log("[stamp_orphan_workspaces] " + t + ": " + e);
      }
    }
  },
  function (db) {},
);
