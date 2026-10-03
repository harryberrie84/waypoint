/// <reference path="../pb_data/types.d.ts" />
//
// notify_mentions.pb.js, emails each @-mentioned user when a comment is created.
//
// This is server-side: it runs inside PocketBase, so notifications send even if
// the person who wrote the comment closes their browser. The Waypoint client
// only writes the `mentions` array onto the comment; this hook does the rest.
//
// Targets PocketBase 0.22.x (the version Waypoint runs on). For 0.23+ the hook
// name and API differ, and this file needs porting.
//
// Install: drop this file in the `pb_hooks/` folder next to your pocketbase
// binary, then restart `./pocketbase serve`. Requires the `comments.mentions`
// JSON field, which the schema declares, and SMTP set up in the dashboard.

onRecordAfterCreateRequest((e) => {
  const record = e.record;

  // mentions is a JSON field, usually an array of user ids, but be defensive.
  let mentions = [];
  try { mentions = JSON.parse(record.getString("mentions") || "[]"); } catch (_) { mentions = []; }
  if (!Array.isArray(mentions) || !mentions.length) return;

  const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const settings = $app.settings();
  const fromAddress = settings.meta.senderAddress;
  const fromName = settings.meta.senderName || "Waypoint";
  const appUrl = settings.meta.appUrl || "";

  const author = esc(record.getString("authorName") || "Someone");
  const body = esc(record.getString("body").slice(0, 500));
  const pageId = record.get("page");

  let wsId = "";
  let pageRec = null;
  try {
    pageRec = $app.dao().findRecordById("pages", pageId);
    wsId = pageRec.getString("workspace");
  } catch (_) {
    return;
  }
  if (!wsId) return;
  const listed = (field, uid) => {
    const ids = pageRec.getStringSlice(field) || [];
    for (let i = 0; i < ids.length; i++) if (String(ids[i]) === uid) return true;
    return false;
  };
  const canReadPage = (uid) =>
    pageRec.getString("visibility") !== "private" || pageRec.getString("owner") === uid || listed("editors", uid) || listed("viewers", uid);
  const isMember = (uid) => {
    try {
      $app.dao().findFirstRecordByFilter("workspace_members", "workspace = {:w} && user = {:u}", { w: wsId, u: uid });
      return true;
    } catch (_) {
      return false;
    }
  };

  // De-duplicate ids.
  const seen = {};
  mentions.forEach((rawId) => {
    const uid = String(rawId);
    if (!uid || seen[uid]) return;
    seen[uid] = true;
    if (uid === record.getString("author") || !isMember(uid) || !canReadPage(uid)) return;

    let user;
    try {
      user = $app.dao().findRecordById("users", uid);
    } catch (_) {
      return; // unknown user id, skip
    }
    const email = user.email && user.email();
    if (!email) return;

    const link = appUrl ? `${appUrl}` : "";
    const message = new MailerMessage({
      from: { address: fromAddress, name: fromName },
      to: [{ address: email }],
      subject: `${author} mentioned you in Waypoint`,
      html:
        `<p><strong>${author}</strong> mentioned you in a comment:</p>` +
        `<blockquote style="border-left:3px solid #e05a86;margin:0;padding:4px 12px;color:#444">${body}</blockquote>` +
        (link ? `<p><a href="${link}">Open Waypoint</a></p>` : "") +
        `<p style="color:#999;font-size:12px">page: ${pageId}</p>`,
    });

    try {
      $app.newMailClient().send(message);
    } catch (err) {
      console.log("[notify_mentions] send failed for " + email + ": " + err);
    }
  });
}, "comments");
