import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

export default function Modal({ title, description, onClose, children, footer, size = 'md' }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    const initial = dialog.querySelector('[data-autofocus]') || dialog.querySelector('.modal-body')?.querySelector(FOCUSABLE) || dialog.querySelector(FOCUSABLE);
    initial?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const nodes = [...dialog.querySelectorAll(FOCUSABLE)];
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.body.classList.add('has-modal');
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('has-modal');
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRef.current(); }}>
      <section className={`modal modal-${size}`} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className="icon-btn" aria-label="Fermer la fenêtre" onClick={() => closeRef.current()}><X size={20} /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ title, children, confirmLabel = 'Confirmer', tone = 'primary', busy = false, onConfirm, onCancel }) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Annuler</button>
          <button type="button" className={`btn btn-${tone}`} onClick={onConfirm} disabled={busy} data-autofocus>
            {busy ? 'Un instant…' : confirmLabel}
          </button>
        </>
      )}
    >
      {children}
    </Modal>
  );
}
