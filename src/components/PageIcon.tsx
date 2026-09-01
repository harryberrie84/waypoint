import { isImageIcon } from '../lib/pageIcon';

// Render a page / workspace / row icon: an uploaded image as an <img>, otherwise
// the emoji (or a fallback). `size` is the Tailwind sizing for the image; the
// emoji inherits the surrounding text size.
export function PageIcon({ icon, fallback = '📄', size = 'h-5 w-5' }: { icon?: string | null; fallback?: string; size?: string }) {
  if (isImageIcon(icon)) {
    return <img src={(icon as string).trim()} alt="" className={`${size} shrink-0 rounded object-contain`} />;
  }
  return <>{icon || fallback}</>;
}
