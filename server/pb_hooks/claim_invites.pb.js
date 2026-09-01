/// <reference path="../pb_data/types.d.ts" />
//
// claim_invites.pb.js, turns pending workspace_invites into real memberships.
//
// You can't relate an invite to an account that may not exist yet, so an invite
// stores an email. This hook bridges the two sides:
//   • when someone registers OR logs in, we claim every pending invite for their
//     email (covers "invited before they had an account");
//   • when an invite is created for an email that ALREADY has an account, we
//     claim it immediately (covers "invited an existing teammate") so they don't
//     have to log out and back in to see the workspace.
// In all cases we create a workspace_members row and mark the invite accepted.
// That's why invites are by email and there's no user directory to browse.
//
// Matching is case-insensitive in JS, not via a PB filter: PocketBase's filter
// has no lower(), and we still have to rescue legacy invites stored mixed-case.
// Mirrors src/lib/workspace.ts `pendingInvitesFor` (the tested pure version).
//
// Membership writes go through $app.dao().saveRecord, which bypasses the
// collection's create rule by design, the rule only gates the client.
//
// THE HELPERS ARE REPEATED INSIDE EACH HANDLER, AND THEY HAVE TO BE. PocketBase
// evaluates every hook in its own isolated runtime, so a function declared at
// file scope is simply not there when the handler runs. It fails at request
// time, not at startup, and the failure is loud in the worst place: registering
// returned "Something went wrong while processing your request." to a brand new
// user whose account had in fact just been created, because this fires AFTER the
// record is written. Do not "tidy" these back up to the top of the file.
//
// Targets PocketBase 0.22.x (same hook/DAO style as notify_mentions.pb.js).
// Install: drop in pb_hooks/ next to the binary, restart `./pocketbase serve`.

// New account (registration).
onRecordAfterCreateRequest(function (e) {
  claimInvitesFor(e.record);

  function emailOf(user) {
    if (!user) return "";
    // Auth records expose email() in 0.22; fall back to the field for safety.
    var v = (typeof user.email === "function" ? user.email() : "") || user.getString("email") || "";
    return String(v).trim().toLowerCase();
  }

  function acceptInvite(inv, user, email) {
    var wsId = inv.get("workspace");
    if (!wsId) return;

    // Skip if they're already a member, a second login (or the immediate-claim
    // path racing the auth path) shouldn't duplicate the row.
    var already = null;
    try {
      already = $app.dao().findFirstRecordByFilter(
        "workspace_members",
        "workspace = {:w} && user = {:u}",
        { w: wsId, u: user.id },
      );
    } catch (_) {
      already = null; // not found throws, treat as "no membership yet"
    }

    if (!already) {
      try {
        var col = $app.dao().findCollectionByNameOrId("workspace_members");
        var m = new Record(col);
        m.set("workspace", wsId);
        m.set("user", user.id);
        m.set("userName", user.get("name") || email);
        m.set("role", inv.get("role") || "editor");
        $app.dao().saveRecord(m);
      } catch (err) {
        console.log("[claim_invites] member create failed: " + err);
        return; // leave the invite pending so it retries next login
      }
    }

    try {
      inv.set("status", "accepted");
      $app.dao().saveRecord(inv);
    } catch (err) {
      console.log("[claim_invites] mark-accepted failed: " + err);
    }
  }

  function claimInvitesFor(user) {
    var email = emailOf(user);
    if (!email) return;

    // Pull pending invites and match on the lowercased email in JS (case-
    // insensitive, legacy-safe). Volume is a trip crew, so the cap is generous.
    var invites = [];
    try {
      invites = $app.dao().findRecordsByFilter("workspace_invites", "status = 'pending'", "-created", 500, 0);
    } catch (err) {
      console.log("[claim_invites] lookup failed: " + err);
      return;
    }

    invites.forEach(function (inv) {
      var invEmail = String(inv.get("email") || "").trim().toLowerCase();
      if (invEmail === email) acceptInvite(inv, user, email);
    });
  }
}, "users");

// Existing account logging in (the invite arrived after they already had an
// account). Fires after a successful auth.
onRecordAuthRequest(function (e) {
  claimInvitesFor(e.record);

  function emailOf(user) {
    if (!user) return "";
    var v = (typeof user.email === "function" ? user.email() : "") || user.getString("email") || "";
    return String(v).trim().toLowerCase();
  }

  function acceptInvite(inv, user, email) {
    var wsId = inv.get("workspace");
    if (!wsId) return;

    var already = null;
    try {
      already = $app.dao().findFirstRecordByFilter(
        "workspace_members",
        "workspace = {:w} && user = {:u}",
        { w: wsId, u: user.id },
      );
    } catch (_) {
      already = null;
    }

    if (!already) {
      try {
        var col = $app.dao().findCollectionByNameOrId("workspace_members");
        var m = new Record(col);
        m.set("workspace", wsId);
        m.set("user", user.id);
        m.set("userName", user.get("name") || email);
        m.set("role", inv.get("role") || "editor");
        $app.dao().saveRecord(m);
      } catch (err) {
        console.log("[claim_invites] member create failed: " + err);
        return;
      }
    }

    try {
      inv.set("status", "accepted");
      $app.dao().saveRecord(inv);
    } catch (err) {
      console.log("[claim_invites] mark-accepted failed: " + err);
    }
  }

  function claimInvitesFor(user) {
    var email = emailOf(user);
    if (!email) return;

    var invites = [];
    try {
      invites = $app.dao().findRecordsByFilter("workspace_invites", "status = 'pending'", "-created", 500, 0);
    } catch (err) {
      console.log("[claim_invites] lookup failed: " + err);
      return;
    }

    invites.forEach(function (inv) {
      var invEmail = String(inv.get("email") || "").trim().toLowerCase();
      if (invEmail === email) acceptInvite(inv, user, email);
    });
  }
}, "users");

// Invite created for someone who already has an account → claim it now so the
// workspace shows up without them having to re-authenticate. If no account
// exists yet this is a no-op; the registration hook above will catch them later.
onRecordAfterCreateRequest(function (e) {
  var email = String(e.record.get("email") || "").trim().toLowerCase();
  if (!email) return;

  var user = null;
  try {
    user = $app.dao().findFirstRecordByFilter("users", "email = {:e}", { e: email });
  } catch (_) {
    user = null; // not registered yet, nothing to claim
  }
  if (user) acceptInvite(e.record, user, email);

  function acceptInvite(inv, u, mail) {
    var wsId = inv.get("workspace");
    if (!wsId) return;

    var already = null;
    try {
      already = $app.dao().findFirstRecordByFilter(
        "workspace_members",
        "workspace = {:w} && user = {:u}",
        { w: wsId, u: u.id },
      );
    } catch (_) {
      already = null;
    }

    if (!already) {
      try {
        var col = $app.dao().findCollectionByNameOrId("workspace_members");
        var m = new Record(col);
        m.set("workspace", wsId);
        m.set("user", u.id);
        m.set("userName", u.get("name") || mail);
        m.set("role", inv.get("role") || "editor");
        $app.dao().saveRecord(m);
      } catch (err) {
        console.log("[claim_invites] member create failed: " + err);
        return;
      }
    }

    try {
      inv.set("status", "accepted");
      $app.dao().saveRecord(inv);
    } catch (err) {
      console.log("[claim_invites] mark-accepted failed: " + err);
    }
  }
}, "workspace_invites");
