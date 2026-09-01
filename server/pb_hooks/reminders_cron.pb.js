/// <reference path="../pb_data/types.d.ts" />
//
// reminders_cron.pb.js, server-side reminder delivery. The client poller
// (NotificationsBell) only fires while a tab is open; this fires regardless, so
// a reminder set days ago still emails on time. Targets PocketBase 0.22.x
// (cronAdd + $app.dao()), matching notify_mentions.pb.js.
//
// Reminder state lives entirely inside the existing `table_rows.cells` JSON: a
// reminder column is a datetime, and we mark a sibling key `${columnId}__notified`
// = the target string once we've sent for that value. No schema change, and the
// sentinel is unknown-field-safe, the client renders cells off `table.columns`,
// never `Object.keys(cells)`, so the extra key is inert in the UI.
//
// Recipient: every `person` column on the row (each value is a users.id, single or
// array) → those users' emails; failing that, the table owner. Requires SMTP
// configured in the PocketBase dashboard.

cronAdd("reminders", "*/10 * * * *", () => {
  const now = Date.now();
  const LEAD = { at: 0, "1h": 3600e3, "1d": 86400e3 };

  const settings = $app.settings();
  const fromAddress = settings.meta.senderAddress;
  const fromName = settings.meta.senderName || "Waypoint";
  const appUrl = settings.meta.appUrl || "";

  const parseJSON = (v, fallback) => {
    if (typeof v === "string") { try { return JSON.parse(v); } catch (_) { return fallback; } }
    return v == null ? fallback : v;
  };

  // tableId -> { reminderCols: [{id, lead, name}], personCols: [ids], owner }
  const tables = $app.dao().findRecordsByFilter("tables", "id != ''", "", 0, 0);
  const meta = {};
  tables.forEach((t) => {
    const cols = parseJSON(t.get("columns"), []) || [];
    const reminderCols = cols.filter((c) => c.type === "reminder")
      .map((c) => ({ id: c.id, lead: c.reminderLead || "at", name: c.name || "Reminder" }));
    if (!reminderCols.length) return;
    meta[t.id] = {
      reminderCols: reminderCols,
      personCols: cols.filter((c) => c.type === "person").map((c) => c.id),
      titleCol: cols.length ? cols[0].id : null,
      owner: t.get("owner"),
    };
  });

  const emailFor = (userId) => {
    if (!userId) return null;
    let user;
    try { user = $app.dao().findRecordById("users", String(userId)); } catch (_) { return null; }
    const email = user.email && user.email();
    return email || null;
  };

  Object.keys(meta).forEach((tableId) => {
    const m = meta[tableId];
    const rows = $app.dao().findRecordsByFilter("table_rows", "table = {:t}", "", 0, 0, { t: tableId });

    rows.forEach((row) => {
      const cells = parseJSON(row.get("cells"), null);
      if (!cells) return;
      let dirty = false;

      m.reminderCols.forEach((col) => {
        const raw = cells[col.id];
        const target = Date.parse(raw);
        if (!target) return;
        const notedKey = col.id + "__notified";
        if (cells[notedKey] === raw) return;              // already sent for this value
        const fireAt = target - (LEAD[col.lead] || 0);
        if (now < fireAt || now >= target) return;        // outside the window

        // Recipients: person columns first, else the table owner.
        const recipients = {};
        m.personCols.forEach((pid) => {
          const v = cells[pid];
          const ids = Array.isArray(v) ? v : v ? [v] : [];
          ids.forEach((id) => { const e = emailFor(id); if (e) recipients[e] = true; });
        });
        if (Object.keys(recipients).length === 0) {
          const e = emailFor(m.owner);
          if (e) recipients[e] = true;
        }
        const to = Object.keys(recipients);
        if (!to.length) { cells[notedKey] = raw; dirty = true; return; } // nobody to mail; don't retry forever

        const title = (m.titleCol && cells[m.titleCol]) || "a row";
        const message = new MailerMessage({
          from: { address: fromAddress, name: fromName },
          to: to.map((address) => ({ address: address })),
          subject: `Reminder · ${col.name}`,
          html:
            `<p><strong>${title}</strong>, ${col.name}</p>` +
            `<p>Due ${raw}.</p>` +
            (appUrl ? `<p><a href="${appUrl}">Open Waypoint</a></p>` : ""),
        });
        try {
          $app.newMailClient().send(message);
          cells[notedKey] = raw;
          dirty = true;
        } catch (err) {
          console.log("[reminders_cron] send failed: " + err);
        }
      });

      if (dirty) { row.set("cells", cells); $app.dao().saveRecord(row); }
    });
  });
});
