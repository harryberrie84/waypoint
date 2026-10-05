import { useEffect, useRef } from 'react';

// Escape closes the panel on top, and only that one. Panels open over each other
// (the icon picker inside Settings, say), so each open panel joins a stack and a
// single listener closes the newest. The confirm dialog handles Escape itself,
// earlier, and stops it, so a confirm over a panel closes just the confirm.
const stack: { close: () => void }[] = [];
let listening = false;

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  e.preventDefault();
  e.stopPropagation();
  top.close();
}

export function useEscape(open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const entry = { close: () => closeRef.current() };
    stack.push(entry);
    if (!listening) {
      window.addEventListener('keydown', onKey);
      listening = true;
    }
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [open]);
}
