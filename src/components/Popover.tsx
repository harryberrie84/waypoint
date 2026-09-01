import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

// Popover, renders its menu in a portal at <body>, positioned (fixed) under the
// anchor element. This escapes any `overflow` clipping from table scroll areas,
// flips above when there's no room below, clamps to the viewport, and sits above
// map panes / modals. Handles click-outside.
export function Popover({
  open,
  onClose,
  anchorRef,
  children,
  width = 240,
  align = 'left',
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  width?: number;
  align?: 'left' | 'right';
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', visibility: 'hidden', zIndex: 1300 });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      if (!a) return;
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const w = Math.min(width, vw - 16); // never wider than the viewport (phones)
      const mh = menuRef.current?.offsetHeight ?? 0;
      const below = vh - a.bottom;
      const openUp = below < Math.min(mh || 240, 280) && a.top > below;
      let left = align === 'right' ? a.right - w : a.left;
      left = Math.max(8, Math.min(left, vw - w - 8));
      const top = openUp ? Math.max(8, a.top - (mh || 0) - 4) : a.bottom + 4;
      const maxHeight = (openUp ? a.top : vh - a.bottom) - 12;
      setStyle({ position: 'fixed', top, left, width: w, maxHeight, overflowY: 'auto', zIndex: 1300, visibility: 'visible' });
    };
    place();
    // Re-measure after first paint (menu height now known).
    const raf = requestAnimationFrame(place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, align, width, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(t) && anchorRef.current && !anchorRef.current.contains(t)) onClose();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={menuRef}
      style={style}
      className="rounded-lg border border-paper-line bg-paper p-1 text-left shadow-xl dark:border-coal-line dark:bg-coal-panel"
    >
      {children}
    </div>,
    document.body,
  );
}
