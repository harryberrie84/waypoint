/// <reference path="../pb_data/types.d.ts" />
//
// fresh_fields.pb.js, a save that only changes the fields it sends.
//
// PocketBase's own update loads a record, applies the request and writes every
// column back. Two saves to different fields of the same record that overlap (a
// page body from one person, its spreadsheet from another; a title and a cover
// from one tab) therefore undo each other, silently, with both answered 200.
//
// PATCH /api/waypoint/save/{collection}/{id} does the same update inside one
// transaction that first takes the database's write lock with a no-op write, then
// reads the record as it is committed now, checks the collection's normal update
// rule, applies only the sent fields through the regular form (so validation,
// hooks and realtime all behave as usual) and commits. Overlapping saves wait
// their turn instead of overwriting each other.

routerAdd(
  "PATCH",
  "/api/waypoint/save/:collection/:id",
  function (c) {
    var ALLOWED = { pages: true, tables: true, table_rows: true, workspaces: true };
    var name = c.pathParam("collection");
    var id = c.pathParam("id");
    if (!ALLOWED[name]) throw new NotFoundError();
    var info = $apis.requestInfo(c);
    var data = info.data || {};
    var saved = null;
    $app.dao().runInTransaction(function (txDao) {
      txDao
        .db()
        .newQuery("UPDATE `" + name + "` SET id = id WHERE id = {:id}")
        .bind({ id: id })
        .execute();
      var record;
      try {
        record = txDao.findRecordById(name, id);
      } catch (_) {
        throw new NotFoundError();
      }
      if (!info.admin) {
        var rule = record.collection().updateRule;
        if (rule === null || rule === undefined) throw new ForbiddenError();
        if (!txDao.canAccessRecord(record, info, rule)) throw new NotFoundError();
      }
      var form = new RecordUpsertForm($app, record);
      form.setDao(txDao);
      form.loadData(data);
      form.submit();
      saved = record;
    });
    return c.json(200, saved);
  },
);
