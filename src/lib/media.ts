// Media kind detection, shared by the previewer, the Files tab and the uploader.
// Kept here rather than in a component so the harness can test it.

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv|mkv|avi)(\?|#|$)/i;

/** A video the browser can play inline. `.ogg` stays audio, which is handled
 *  before this in every caller. */
export function isVideoMedia(m: { mime: string; name: string; url: string }): boolean {
  return /^video\//i.test(m.mime) || VIDEO_EXT.test(m.name) || /^data:video\//i.test(m.url);
}

/** The same test for a freshly picked File, which has no url yet. */
export function isVideoFile(file: { type: string; name: string }): boolean {
  return isVideoMedia({ mime: file.type, name: file.name, url: '' });
}
