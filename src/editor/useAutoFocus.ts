import { useEffect, useRef } from 'react';

// Focus a NodeView's input/textarea once it should be active. A slash command
// inserts its node with editor.chain().focus(), which grabs focus before the React
// view mounts, so a plain `autoFocus` loses the race and keystrokes hit the editor
// behind (replacing the node). A requestAnimationFrame after mount lands focus in
// the field instead. Pass a boolean to refocus when a picker opens.
export function useAutoFocus<T extends HTMLElement>(active = true) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const id = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [active]);
  return ref;
}
