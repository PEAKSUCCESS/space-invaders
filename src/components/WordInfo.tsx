import { useEffect, useRef, useState } from 'react';

interface Props {
  definition?: string;
  label?: string; // the word itself, for the aria-label
}

// A small "i"-in-a-circle that reveals a word's native-language definition to
// the RIGHT of the icon. The popover is position:fixed (placed from the icon's
// screen rect) so it escapes the scrollable bucket list instead of being clipped
// by it. Closes on outside-click, scroll, or resize.
export function WordInfo({ definition, label }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    // Capture so it also catches scrolling inside the bucket list, not just window.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (!definition) return null;

  const toggle = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    // Anchor to the right edge of the icon, vertically centred on it.
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ top: r.top + r.height / 2, left: r.right + 8 });
    setOpen(true);
  };

  return (
    <span className="word-info" ref={ref} onClick={(e) => e.stopPropagation()}>
      <span
        className="word-info-btn"
        role="button"
        tabIndex={0}
        aria-label={label ? `Definition of ${label}` : 'Show definition'}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle(e);
          }
        }}
      >
        i
      </span>
      {open && pos && (
        <span className="word-info-pop" role="tooltip" style={{ top: pos.top, left: pos.left }}>
          {definition}
        </span>
      )}
    </span>
  );
}
