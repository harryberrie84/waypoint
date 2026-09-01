// A page icon is either an emoji (the usual case) or an uploaded image URL. This
// tells the two apart so the icon renders as an <img> rather than printing a URL.
export function isImageIcon(icon: string | undefined | null): boolean {
  return !!icon && /^(https?:|data:|blob:|\/)/.test(icon.trim());
}
