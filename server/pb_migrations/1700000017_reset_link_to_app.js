/// <reference path="../pb_data/types.d.ts" />

migrate(
  function (db) {
    var dao = new Dao(db);
    var settings = dao.findSettings();
    if (!settings) return;
    var t = settings.meta.resetPasswordTemplate;
    if (t && String(t.actionUrl || "").indexOf("/_/#/auth/confirm-password-reset/") !== -1) {
      t.actionUrl = "{APP_URL}/?reset={TOKEN}";
      dao.saveSettings(settings);
    }
  },
  function (db) {},
);
