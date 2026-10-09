// Routeur minimal basé sur le fragment d'URL (#/planning/2026-10-05) :
// il fonctionne sur n'importe quel hébergement statique, sans configuration serveur.

import { useEffect, useMemo, useSyncExternalStore } from 'react';

const listeners = new Set();
let lastHash = window.location.hash;
let guardMessage = null;
let bypassGuard = false;

window.addEventListener('hashchange', () => {
  if (guardMessage && !bypassGuard && window.location.hash !== lastHash) {
    if (!window.confirm(guardMessage)) {
      window.history.replaceState(null, '', lastHash || '#/');
      return;
    }
    guardMessage = null;
  }
  bypassGuard = false;
  lastHash = window.location.hash;
  listeners.forEach((listener) => listener());
});

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function parse(hash) {
  const [pathname = '', search = ''] = hash.replace(/^#/, '').split('?');
  return { path: `/${pathname.split('/').filter(Boolean).join('/')}`, search };
}

export function useLocation() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return useMemo(() => parse(hash), [hash]);
}

export function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

// `force` contourne la confirmation des modifications non enregistrées (après un enregistrement réussi).
export function navigate(to, { replace = false, force = false } = {}) {
  const target = `#${to}`;
  if (window.location.hash === target) return;
  bypassGuard = force;
  if (force) guardMessage = null;
  if (replace) {
    window.history.replaceState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = to;
  }
}

export function matchPath(pattern, path) {
  const expected = pattern.split('/').filter(Boolean);
  const actual = path.split('/').filter(Boolean);
  const optional = expected.filter((segment) => segment.endsWith('?')).length;
  if (actual.length > expected.length || actual.length < expected.length - optional) return null;
  const params = {};
  for (let index = 0; index < expected.length; index += 1) {
    const segment = expected[index];
    const value = actual[index];
    if (segment.startsWith(':')) {
      if (value !== undefined) params[segment.slice(1).replace('?', '')] = decodeURIComponent(value);
    } else if (segment !== value) {
      return null;
    }
  }
  return params;
}

export function Link({ to, children, ...props }) {
  return <a href={`#${to}`} {...props}>{children}</a>;
}

export function Redirect({ to }) {
  useEffect(() => {
    navigate(to, { replace: true });
  }, [to]);
  return null;
}

// Demande confirmation avant de quitter une page dont le formulaire n'est pas enregistré.
export function useUnsavedChanges(dirty, message = 'Vos modifications ne sont pas enregistrées. Quitter cette page quand même ?') {
  useEffect(() => {
    if (!dirty) return undefined;
    guardMessage = message;
    const beforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      if (guardMessage === message) guardMessage = null;
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [dirty, message]);
}
