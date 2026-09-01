/// <reference path="../pb_data/types.d.ts" />
//
// ics_feed.pb.js, serves a live calendar feed for a table at
//   GET /ics/table/:id
// so a phone can *subscribe* (not just download) and keep the itinerary in sync.
//
// This is the server half of ICS export. The client builds the same .ics for the
// download button; this hook rebuilds it on the fly from the table's rows so the
// subscribed calendar updates whenever you edit the trip.
//
// Targets PocketBase 0.22.x (the version Waypoint runs on): routerAdd + the
// $app.dao() API. The feed is unauthenticated, treat the URL like a secret
// (same model as Google Calendar's private-address links).
//
// Every helper below lives INSIDE the handler on purpose. PocketBase evaluates
// each hook in its own isolated runtime, so a function declared at file scope is
// not there when the handler runs: it fails at request time with
// "ReferenceError: <name> is not defined", never at startup.

routerAdd("GET", "/ics/table/:id", (c) => {
  const id = c.pathParam("id");

  let table;
  try {
    table = $app.dao().findRecordById("tables", id);
  } catch (_) {
    return c.string(404, "table not found");
  }

  const columns = asArray(table.get("columns"));
  const view = asObject(table.get("views"));
  const cols = resolveColumns(columns, view);
  if (!cols.start) return calendar(table.get("name"), []); // nothing dated yet

  let rows = [];
  try {
    rows = $app.dao().findRecordsByFilter("table_rows", "table = {:t}", "+position", 0, 0, { t: id });
  } catch (_) {
    rows = [];
  }

  const events = [];
  rows.forEach((row) => {
    const cells = asObject(row.get("cells"));
    const sp = parseDate(cells[cols.start]);
    if (!sp) return;
    const ep = cols.end ? parseDate(cells[cols.end]) : null;
    const summary = textOf(cells[cols.title]) || "Untitled";
    const place = cols.place ? geoName(cells[cols.place]) : "";
    events.push(vevent(row.id, sp, ep, summary, place));
  });

  const body = calendar(table.get("name"), events);
  c.response().header().set("Content-Type", "text/calendar; charset=utf-8");
  return c.string(200, body);

  // --- helpers ---------------------------------------------------------------

  function asArray(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === "string") { try { return JSON.parse(v) || []; } catch (_) { return []; } }
    return [];
  }
  function asObject(v) {
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
    if (typeof v === "string") { try { return JSON.parse(v) || {}; } catch (_) { return {}; } }
    return {};
  }

  // Mirror the client's column resolution: prefer the saved view's columns, else
  // the first datetime/date column for the start and a place column for location.
  function resolveColumns(columns, view) {
    const byId = {};
    columns.forEach((c) => { byId[c.id] = c; });
    const dated = (id) => (byId[id] && (byId[id].type === "date" || byId[id].type === "datetime") ? id : null);
    const firstOfType = (t) => { const c = columns.find((x) => x.type === t); return c ? c.id : null; };
    const firstText = () => { const c = columns.find((x) => x.type === "text"); return c ? c.id : (columns[0] && columns[0].id); };

    const start =
      dated(view.startTimeColumnId) || dated(view.dateColumnId) || dated(view.arrivalColumnId) ||
      firstOfType("datetime") || firstOfType("date");
    const end =
      dated(view.endTimeColumnId) || dated(view.endDateColumnId) || dated(view.departureColumnId);
    return { start: start, end: end, title: firstText(), place: firstOfType("place") };
  }

  function parseDate(v) {
    if (typeof v !== "string") return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(v);
    if (!m) return null;
    return { y: m[1], mo: m[2], d: m[3], hasTime: m[4] !== undefined, hh: m[4] || "00", mm: m[5] || "00" };
  }
  function addDay(p) {
    const dt = new Date(Date.UTC(+p.y, +p.mo - 1, +p.d + 1));
    return pad(dt.getUTCFullYear()) + pad(dt.getUTCMonth() + 1) + pad(dt.getUTCDate());
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function ymd(p) { return p.y + p.mo + p.d; }

  function textOf(v) {
    if (typeof v === "string") return v;
    if (v == null) return "";
    return String(v);
  }
  function geoName(v) {
    if (v && typeof v === "object" && typeof v.name === "string") return v.name;
    return "";
  }
  function esc(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  }

  function vevent(uid, sp, ep, summary, place) {
    const lines = ["BEGIN:VEVENT", "UID:" + uid + "@waypoint", "DTSTAMP:" + stampNow()];
    let trigger;
    if (sp.hasTime) {
      lines.push("DTSTART:" + ymd(sp) + "T" + sp.hh + sp.mm + "00");
      const e = ep || { y: sp.y, mo: sp.mo, d: sp.d, hh: pad((+sp.hh + 1) % 24), mm: sp.mm, hasTime: true };
      lines.push("DTEND:" + ymd(e) + "T" + e.hh + e.mm + "00");
      trigger = "-PT1H";
    } else {
      lines.push("DTSTART;VALUE=DATE:" + ymd(sp));
      lines.push("DTEND;VALUE=DATE:" + addDay(ep || sp));
      trigger = "-P1D";
    }
    lines.push("SUMMARY:" + esc(summary));
    if (place) lines.push("LOCATION:" + esc(place));
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + esc(summary), "TRIGGER:" + trigger, "END:VALARM");
    lines.push("END:VEVENT");
    return lines.join("\r\n");
  }

  function stampNow() {
    const d = new Date();
    return pad(d.getUTCFullYear()) + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
      "T" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
  }

  function calendar(name, events) {
    const head = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Waypoint//Trip Planner//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:" + esc(name || "Waypoint"),
    ];
    return head.concat(events).concat(["END:VCALENDAR"]).join("\r\n");
  }
});
