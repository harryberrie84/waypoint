/// <reference path="../pb_data/types.d.ts" />
//
// gate_registration.pb.js, decides who is allowed to create an account.
//
// The users collection has an empty create rule, which means anyone who can
// reach the app can sign up. That is right for the person starting an instance
// and wrong for every moment after it: a self-hosted install ends up behind a
// tunnel, a reverse proxy or a port forward, and an open sign-up form on a
// public address collects strangers.
//
// The gate, in order:
//   1. An admin is making the request. The dashboard must keep working.
//   2. WAYPOINT_OPEN_REGISTRATION is truthy. Opt in, for a deployment that
//      genuinely wants public sign-up.
//   3. No accounts exist yet. The first registration is always allowed, which is
//      what keeps "start the container, open the port, register" working on a
//      fresh install with nothing to configure.
//   4. A pending workspace_invites row matches the address. Invites are stored
//      by email and claimed by claim_invites.pb.js, so this reuses the record
//      that already exists rather than inventing a second kind of token.
//   5. Otherwise refuse.
//
// Matching is case-insensitive in JS rather than through a PB filter, the same
// reason as claim_invites.pb.js: the filter language has no lower(). The exact
// filter runs first as the fast path and the scan is the fallback that rescues
// invites stored mixed-case.
//
// EVERY HELPER LIVES INSIDE ITS HANDLER, AND HAS TO. PocketBase evaluates each
// hook in its own isolated runtime, so a function declared at file scope is not
// there when the handler runs. It fails at request time, not at startup, which
// is how a registration once returned "Something went wrong while processing
// your request." to a user whose account had in fact been created.
//
// Targets PocketBase 0.22.x.

onRecordBeforeCreateRequest(function (e) {
  var email = emailOf(e);

  if (isAdmin(e)) return;
  if (openRegistration()) return;
  if (!anyAccountsYet()) return;
  if (hasPendingInvite(email)) return;

  // The env var is named here and NOT in the message the browser shows: on-screen
  // copy never names a setting the reader cannot see. The operator reads this line.
  console.log(
    "[gate_registration] refused " +
      (email || "(no email)") +
      ": no pending invite. Set WAYPOINT_OPEN_REGISTRATION=true to allow open sign-up.",
  );
  throw new BadRequestError("This instance is invite only. Ask whoever runs it to send you an invite.");

  // --- helpers ---------------------------------------------------------------

  function isAdmin(ev) {
    try {
      var info = $apis.requestInfo(ev.httpContext);
      return !!(info && info.admin);
    } catch (_) {
      return false;
    }
  }

  function openRegistration() {
    var v = "";
    try {
      v = $os.getenv("WAYPOINT_OPEN_REGISTRATION") || "";
    } catch (_) {
      v = "";
    }
    v = String(v).trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "on";
  }

  function emailOf(ev) {
    var v = "";
    try {
      var r = ev.record;
      v = (r && typeof r.email === "function" ? r.email() : "") || (r ? r.getString("email") : "") || "";
    } catch (_) {
      v = "";
    }
    if (!v) {
      // The record may not carry the email yet depending on how the request was
      // shaped, so fall back to the submitted body.
      try {
        var info = $apis.requestInfo(ev.httpContext);
        v = (info && info.data && info.data.email) || "";
      } catch (_) {
        v = "";
      }
    }
    return String(v).trim().toLowerCase();
  }

  function anyAccountsYet() {
    try {
      return !!$app.dao().findFirstRecordByFilter("users", "id != ''");
    } catch (_) {
      return false; // "not found" throws, and that is the empty-instance case
    }
  }

  function hasPendingInvite(addr) {
    if (!addr) return false;

    // Fast path: the address exactly as stored. Covers every invite the current
    // client writes, which lowercases before saving.
    try {
      var exact = $app.dao().findFirstRecordByFilter(
        "workspace_invites",
        "status = 'pending' && email = {:e}",
        { e: addr },
      );
      if (exact) return true;
    } catch (_) {
      /* not found throws; fall through to the scan */
    }

    // Fallback: a case-insensitive sweep of pending invites, for legacy rows
    // stored mixed-case. Unlimited on purpose (limit 0), so a large backlog of
    // pending invites can never push someone's invite off the end and lock them
    // out of an account they were told to create.
    try {
      var pending = $app.dao().findRecordsByFilter("workspace_invites", "status = 'pending'", "", 0, 0);
      for (var i = 0; i < pending.length; i++) {
        if (String(pending[i].getString("email") || "").trim().toLowerCase() === addr) return true;
      }
    } catch (_) {
      /* unreadable; refuse rather than let everyone in on an error */
    }
    return false;
  }
}, "users");

// The auth screen asks here whether to offer "Create account" at all, so a closed
// instance shows a sign-in form rather than a door that reports a refusal only
// after someone has typed their details in.
//
// Unauthenticated and deliberately dull: one boolean, no counts, no addresses,
// nothing an anonymous caller could not learn by pressing the button anyway. An
// older install without this hook 404s here, and the client treats that as open,
// which is exactly what such an install is.
routerAdd("GET", "/api/waypoint/config", (c) => {
  return c.json(200, { openRegistration: openRegistration() || !anyAccountsYet() });

  // --- helpers ---------------------------------------------------------------
  // Repeated rather than shared with the handler above, for the isolated-runtime
  // reason in the file header. Keep the two in step.

  function openRegistration() {
    var v = "";
    try {
      v = $os.getenv("WAYPOINT_OPEN_REGISTRATION") || "";
    } catch (_) {
      v = "";
    }
    v = String(v).trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "on";
  }

  function anyAccountsYet() {
    try {
      return !!$app.dao().findFirstRecordByFilter("users", "id != ''");
    } catch (_) {
      return false;
    }
  }
});
