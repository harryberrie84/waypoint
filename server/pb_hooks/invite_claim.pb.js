/// <reference path="../pb_data/types.d.ts" />
//
// invite_claim.pb.js, the only way into a workspace besides creating it.
//
// An invite carries a one-time secret. The inviter's browser makes it and sends it
// with the invite; only its SHA-256 is stored, so nobody who can read the invite
// row (the invitee's address can) learns the secret. The secret travels in the
// invite link. Claiming needs either:
//   - the secret AND an account whose email is the one invited, or
//   - no secret, but an account whose email address has been verified.
// So registering an unverified account with someone else's address gets nothing,
// and a forwarded link is useless to an account under a different address.
// A claimed invite is marked accepted and cannot be used again; invites expire
// after 14 days.
//
// Helpers are repeated inside each handler: PocketBase runs every handler in its
// own runtime and file-scope functions are not visible there.

onRecordBeforeCreateRequest(function (e) {
  var info = $apis.requestInfo(e.httpContext);
  var token = info && info.data ? info.data.token : "";
  if (typeof token === "string" && token.length >= 32 && token.length <= 200) {
    e.record.set("tokenHash", $security.sha256(token));
  } else {
    e.record.set("tokenHash", "");
  }
}, "workspace_invites");

routerAdd(
  "POST",
  "/api/waypoint/invites/claim",
  function (c) {
    var MAX_AGE_SECONDS = 14 * 24 * 60 * 60;
    var info = $apis.requestInfo(c);
    var user = info.authRecord;
    if (!user) throw new UnauthorizedError("Sign in first.");
    var email = String(user.email() || "").trim().toLowerCase();
    var token = info.data && typeof info.data.token === "string" ? info.data.token : "";

    var candidates = [];
    if (token) {
      try {
        candidates.push(
          $app.dao().findFirstRecordByFilter("workspace_invites", "tokenHash = {:h} && status = 'pending'", {
            h: $security.sha256(token),
          }),
        );
      } catch (_) {
        candidates = [];
      }
    } else if (user.verified()) {
      try {
        candidates = $app.dao().findRecordsByFilter("workspace_invites", "status = 'pending'", "-created", 500, 0);
      } catch (_) {
        candidates = [];
      }
    }

    var now = Math.floor(Date.now() / 1000);
    var seated = [];
    var reason = token && candidates.length === 0 ? "unknown" : "";
    for (var i = 0; i < candidates.length; i++) {
      var inv = candidates[i];
      if (String(inv.get("email") || "").trim().toLowerCase() !== email) {
        if (token) reason = "other-email";
        continue;
      }
      var created = inv.getDateTime("created").time().unix();
      if (now - created > MAX_AGE_SECONDS) {
        if (token) reason = "expired";
        continue;
      }
      var wsId = inv.getString("workspace");
      if (!wsId) continue;
      var already = null;
      try {
        already = $app.dao().findFirstRecordByFilter("workspace_members", "workspace = {:w} && user = {:u}", {
          w: wsId,
          u: user.id,
        });
      } catch (_) {
        already = null;
      }
      if (!already) {
        var col = $app.dao().findCollectionByNameOrId("workspace_members");
        var m = new Record(col);
        m.set("workspace", wsId);
        m.set("user", user.id);
        m.set("userName", user.getString("name") || email);
        var role = inv.getString("role");
        m.set("role", role === "admin" || role === "viewer" ? role : "editor");
        $app.dao().saveRecord(m);
      }
      inv.set("status", "accepted");
      $app.dao().saveRecord(inv);
      seated.push(wsId);
    }
    return c.json(200, { workspaces: seated, reason: seated.length ? "" : reason });
  },
  $apis.requireRecordAuth("users"),
);
