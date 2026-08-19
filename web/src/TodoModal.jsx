import { useEffect, useMemo, useRef } from 'react';

// The TODO/FIXME list, grouped by file. A focus-trapped modal dialog: Tab stays
// inside it, Escape closes it, and focus returns to whatever opened it.
export function TodoModal({ todos, onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    // Remember what had focus so it can be restored when the dialog closes.
    const previouslyFocused = document.activeElement;
    dialogRef.current?.focus();

    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Keep Tab inside the dialog.
      const focusable = dialogRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  const groups = useMemo(() => {
    const byFile = new Map();
    for (const t of todos) {
      if (!byFile.has(t.file)) byFile.set(t.file, []);
      byFile.get(t.file).push(t);
    }
    return [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [todos]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="todo-modal-title"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title" id="todo-modal-title">TODO / FIXME · {todos.length}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          {groups.map(([file, items]) => (
            <div key={file} className="todo-group">
              <div className="todo-group-file">{file}</div>
              <ul className="todo-list">
                {items.map((t, i) => (
                  <li key={i} className="todo-item">
                    <span className={`todo-kw ${t.keyword.toLowerCase()}`}>{t.keyword}</span>
                    <span className="todo-text">{t.text || '(no description)'}</span>
                    <span className="todo-loc">:{t.line}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
