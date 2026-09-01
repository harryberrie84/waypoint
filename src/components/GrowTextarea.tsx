import { useEffect, useRef } from 'react';

// A textarea that always shows all its text: it grows to fit on mount, on every
// change and on window resize (so wrapped lines on a narrow phone are visible).
// Sizing runs after paint (a plain useEffect) with a stable ref, so it never gets
// in the way of typing. Long text wraps down instead of scrolling sideways,
// which is what makes it the right field for list-item text (recipes, cases,
// checklists) that people write whole sentences into.
export function GrowTextarea({
  value,
  onChange,
  placeholder,
  className,
  onKeyDown,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const grow = () => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  };
  useEffect(grow); // re-measure after every render (e.g. the value changing)
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // Re-measure when the box's width settles or changes (first layout on mobile,
    // a column reflow, an orientation change) so it shows all the text without
    // needing a keystroke first.
    const ro = new ResizeObserver(() => grow());
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      className={className}
      style={{ resize: 'none', overflow: 'hidden' }}
    />
  );
}
