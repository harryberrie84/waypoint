/// <reference path="../pb_data/types.d.ts" />
//
// write_guards.pb.js, checks the API rules cannot express.
//
// Uploads: a file that a browser would run as a page or a script is refused. The
// server already sends uploads as sandboxed downloads, so this is a second lock,
// not the first: nothing the app uploads is ever one of these (pictures, video,
// audio and documents are), and an SVG is inlined by the app instead of stored.
//
// Reminders: every recipient must be a member of the reminder's workspace. The
// list is a JSON field, which a rule cannot look inside, so without this anyone
// who can write a reminder could have the server email any account.
//
// Each handler keeps its helpers inside itself: PocketBase runs every hook in its
// own runtime, so file-level helpers are not in scope when a request arrives.

onRecordBeforeCreateRequest((e) => {
  const BLOCKED = /\.(html?|xhtml|xht|svgz?|xml|xsl|js|mjs|cjs)$/i;
  const files = (e.uploadedFiles && e.uploadedFiles["file"]) || [];
  for (let i = 0; i < files.length; i++) {
    const name = String((files[i] && files[i].originalName) || "");
    if (BLOCKED.test(name)) throw new BadRequestError("This kind of file cannot be uploaded.");
  }
}, "uploads");

onRecordBeforeCreateRequest((e) => {
  const workspace = e.record.getString("workspace");
  let ids = [];
  try {
    ids = JSON.parse(e.record.getString("recipients") || "[]") || [];
  } catch (_) {
    ids = [];
  }
  if (!Array.isArray(ids)) throw new BadRequestError("Reminder recipients must be a list.");
  for (let i = 0; i < ids.length; i++) {
    let member = null;
    try {
      member = $app.dao().findFirstRecordByFilter("workspace_members", "workspace = {:w} && user = {:u}", { w: workspace, u: String(ids[i]) });
    } catch (_) {
      member = null;
    }
    if (!member) throw new BadRequestError("A reminder can only go to members of its workspace.");
  }
}, "reminders");

onRecordBeforeUpdateRequest((e) => {
  const workspace = e.record.getString("workspace");
  let ids = [];
  try {
    ids = JSON.parse(e.record.getString("recipients") || "[]") || [];
  } catch (_) {
    ids = [];
  }
  if (!Array.isArray(ids)) throw new BadRequestError("Reminder recipients must be a list.");
  for (let i = 0; i < ids.length; i++) {
    let member = null;
    try {
      member = $app.dao().findFirstRecordByFilter("workspace_members", "workspace = {:w} && user = {:u}", { w: workspace, u: String(ids[i]) });
    } catch (_) {
      member = null;
    }
    if (!member) throw new BadRequestError("A reminder can only go to members of its workspace.");
  }
}, "reminders");
