/// <reference path="../pb_data/types.d.ts" />
//
// link_preview.pb.js, read the title, description and image of a pasted link.
//
// A browser cannot read another site's HTML, so something has to fetch the page.
// Here that something is the box this Waypoint runs on, not a metadata service,
// so nobody else learns what anyone bookmarked. No API key, no quota.
//
//   GET /link-preview?url=https://example.org/post
//   -> 200 { title, description, image }, or 204 when nothing could be read
//
// This endpoint makes the server fetch a URL that a user supplies, so it is
// deliberately fenced in: signed-in users only, http and https only, no
// credentials in the URL, and no loopback, private, link-local or CGNAT address.
// The fence reads the literal host in the URL. A public name that RESOLVES to a
// private address still gets through: there is no resolver in here to ask.
// Documented rather than fixed, because it reaches nothing a device already on
// that network could not reach itself.
//
// Targets PocketBase 0.22.x, like the hooks beside it.
//
// Every helper below lives INSIDE the handler on purpose. PocketBase evaluates
// each hook in its own isolated runtime, so a function declared at file scope is
// simply not there when the handler runs: it fails at request time with
// "ReferenceError: <name> is not defined", not at startup. invite_email.pb.js is
// the one hook that has ever run in production, and this is the shape it uses.

routerAdd(
  "GET",
  "/link-preview",
  (c) => {
    const raw = (c.queryParam("url") || "").trim();
    const m = /^(https?):\/\/([^/?#]+)/i.exec(raw);
    if (!m) return c.json(400, { message: "url must be http or https" });
    const authority = m[2];
    if (authority.indexOf("@") !== -1) return c.json(400, { message: "url must not carry credentials" });
    const host = authority.split(":")[0];
    if (isPrivateHost(host)) return c.json(400, { message: "that address is not reachable from here" });

    let res;
    try {
      res = $http.send({
        url: raw,
        method: "GET",
        timeout: 6,
        headers: {
          // Named honestly. Sites that block unknown agents send a 403 either
          // way, and pretending to be a browser would be the wrong default for
          // a tool whose whole point is not lying about who is asking.
          "User-Agent": "Waypoint link preview (self-hosted)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } catch (err) {
      console.log("[link_preview] fetch failed: " + err);
      return c.noContent(204);
    }
    if (res.statusCode < 200 || res.statusCode >= 300) return c.noContent(204);

    // Metadata lives in <head>. Cap what is scanned so a huge or hostile page
    // cannot turn one paste into a long regex walk.
    const html = String(res.raw || "").slice(0, 250000);
    const meta = {
      title: pick(html, ["og:title", "twitter:title"]) || tagText(html, "title"),
      description: pick(html, ["og:description", "twitter:description", "description"]),
      image: absolute(pick(html, ["og:image", "twitter:image"]), raw),
    };
    if (!meta.title && !meta.description && !meta.image) return c.noContent(204);
    return c.json(200, meta);

    // --- helpers ---------------------------------------------------------------
    function isPrivateHost(host) {
      const h = host.toLowerCase();
      if (!h) return true;
      if (h === "localhost" || h === "0.0.0.0") return true;
      if (/\.(localhost|local|internal|home|lan)$/.test(h)) return true;
      if (h.indexOf(":") !== -1) return true; // IPv6 literal: no cheap range check, so refuse
      const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
      if (!ip) return false;
      const a = Number(ip[1]);
      const b = Number(ip[2]);
      if (a === 0 || a === 10 || a === 127) return true;
      if (a === 192 && b === 168) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 169 && b === 254) return true;
      if (a === 100 && b >= 64 && b <= 127) return true;
      return false;
    }
    // The first meta tag matching any of these property/name values, in order.
    function pick(html, names) {
      const tags = html.match(/<meta\b[^>]*>/gi) || [];
      for (let i = 0; i < names.length; i++) {
        for (let j = 0; j < tags.length; j++) {
          const tag = tags[j];
          const key = attr(tag, "property") || attr(tag, "name");
          if (key && key.toLowerCase() === names[i]) {
            const v = decode(attr(tag, "content"));
            if (v) return v;
          }
        }
      }
      return "";
    }
    function attr(tag, name) {
      const m = new RegExp(name + '\s*=\s*"([^"]*)"', "i").exec(tag) || new RegExp(name + "\s*=\s*'([^']*)'", "i").exec(tag);
      return m ? m[1] : "";
    }
    function tagText(html, name) {
      const m = new RegExp("<" + name + "[^>]*>([\s\S]*?)</" + name + ">", "i").exec(html);
      return m ? decode(m[1].replace(/\s+/g, " ").trim()) : "";
    }
    // A relative og:image is common. Resolve it against the page it came from,
    // because the client only ever gets an absolute url it can render.
    function absolute(src, pageUrl) {
      if (!src) return "";
      if (/^https?:\/\//i.test(src)) return src;
      const origin = /^(https?:\/\/[^/?#]+)/i.exec(pageUrl);
      if (!origin) return "";
      if (src.indexOf("//") === 0) return origin[1].split(":")[0] + ":" + src;
      if (src.charAt(0) === "/") return origin[1] + src;
      const dir = pageUrl.replace(/[?#].*$/, "").replace(/\/[^/]*$/, "");
      return dir + "/" + src;
    }
    function decode(s) {
      if (!s) return "";
      return s
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .trim();
    }
  },
  $apis.requireRecordAuth(),
);

