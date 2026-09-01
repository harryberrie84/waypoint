/// <reference path="../pb_data/types.d.ts" />
//
// invite_email.pb.js, emails an invitee when an admin invites them.
//
// The Waypoint client only writes the workspace_invites row (email + role +
// who); this hook does the rest. The email carries a deep link back to the app
// with the invited address baked in (`/?invite=<email>`), so the auth screen
// prefills it and the invitee signs up with the exact email the invite was sent
// to, which is what claim_invites.pb.js needs to turn it into a membership.
//
// Without this hook the invitee gets nothing and has to be told out-of-band to
// register with the right address. Pairs with claim_invites.pb.js (membership)
// and shares the SMTP settings the mention emails use.
//
// Targets PocketBase 0.22.x. Requires working SMTP (Admin UI → Mail settings)
// and Application URL set (Admin UI → Application) so the link is absolute.
// Install: drop in pb_hooks/ next to the binary, restart `./pocketbase serve`.

onRecordAfterCreateRequest(function (e) {
  // Inside the handler, like everything else in pb_hooks here: PocketBase
  // evaluates each hook in its own runtime, so file-scope declarations are not
  // reliably in scope when it fires.
  var ROLE_BLURB = {
    admin: "as an admin (full access, can manage members)",
    editor: "as an editor (can view and edit)",
    viewer: "as a viewer (read-only)",
  };

  var inv = e.record;
  var email = String(inv.get("email") || "").trim();
  if (!email) return;

  var settings = $app.settings();
  var fromAddress = settings.meta.senderAddress;
  var fromName = settings.meta.senderName || "Waypoint";
  var appUrl = (settings.meta.appUrl || "").replace(/\/+$/, "");

  // Workspace name (for the subject + body). Fall back to a generic noun.
  var wsName = "a workspace";
  try {
    var ws = $app.dao().findRecordById("workspaces", inv.get("workspace"));
    if (ws && ws.get("name")) wsName = ws.get("name");
  } catch (_) { /* deleted/missing workspace, keep the generic name */ }

  // Inviter's display name, best-effort.
  var inviter = "Someone";
  try {
    var by = inv.get("invitedBy");
    if (by) {
      var u = $app.dao().findRecordById("users", by);
      if (u) inviter = u.get("name") || u.email() || inviter;
    }
  } catch (_) { /* keep the generic name */ }

  var role = inv.get("role") || "editor";
  var roleBlurb = ROLE_BLURB[role] || ROLE_BLURB.editor;

  var link = appUrl
    ? appUrl + "/?invite=" + encodeURIComponent(email) + "&ws=" + encodeURIComponent(wsName)
    : "";

  var button = link
    ? '<p style="margin:20px 0">' +
        '<a href="' + link + '" style="background:#e05a86;color:#fff;text-decoration:none;' +
        'padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block">' +
        'Join ' + wsName + '</a></p>' +
        '<p style="color:#999;font-size:12px">or paste this into your browser:<br>' + link + '</p>'
    : '<p>Open Waypoint and create an account (or sign in) with <strong>' + email + '</strong> to join.</p>';

  var message = new MailerMessage({
    from: { address: fromAddress, name: fromName },
    to: [{ address: email }],
    subject: inviter + " invited you to " + wsName + " on Waypoint",
    html:
      '<p><strong>' + inviter + '</strong> invited you to <strong>' + wsName + '</strong> ' + roleBlurb + '.</p>' +
      button +
      '<p style="color:#999;font-size:12px">Sign up with this exact email (' + email +
      ') so you land in the right workspace.</p>',
  });

  try {
    $app.newMailClient().send(message);
  } catch (err) {
    console.log("[invite_email] send failed for " + email + ": " + err);
  }
}, "workspace_invites");
