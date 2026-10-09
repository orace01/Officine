import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, X } from 'lucide-react';
import { Link } from '../router.jsx';

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const counter = useRef(0);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((toast) => toast.id !== id)), []);

  const notify = useCallback((toast) => {
    counter.current += 1;
    const id = counter.current;
    setToasts((list) => [...list.slice(-2), { tone: 'success', ...toast, id }]);
    window.setTimeout(() => dismiss(id), toast.tone === 'error' || toast.action ? 8000 : 4500);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toast-region" aria-live="polite">
        {toasts.map((toast) => {
          const Icon = toast.tone === 'error' ? CircleAlert : CheckCircle2;
          return (
            <div className={`toast toast-${toast.tone}`} key={toast.id} role={toast.tone === 'error' ? 'alert' : 'status'}>
              <Icon size={20} aria-hidden="true" />
              <div>
                <strong>{toast.title}</strong>
                {toast.message && <p>{toast.message}</p>}
                {toast.action && <Link to={toast.action.to} className="toast-action" onClick={() => dismiss(toast.id)}>{toast.action.label}</Link>}
              </div>
              <button type="button" className="icon-btn" aria-label="Fermer le message" onClick={() => dismiss(toast.id)}><X size={16} /></button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// Exécute une action asynchrone : gère l'état « en cours » et affiche l'erreur éventuelle.
// Renvoie { ok, value } pour que l'appelant enchaîne seulement en cas de succès.
export function useAction() {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (action, { success, errorTitle = 'Action impossible' } = {}) => {
    setBusy(true);
    try {
      const value = await action();
      if (success) notify(typeof success === 'string' ? { title: success } : success);
      return { ok: true, value };
    } catch (error) {
      notify({ tone: 'error', title: errorTitle, message: error.message });
      return { ok: false, error };
    } finally {
      setBusy(false);
    }
  }, [notify]);
  return useMemo(() => [run, busy], [run, busy]);
}
