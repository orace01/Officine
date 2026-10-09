import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onExternalChange } from '../services/api.js';

const WorkspaceContext = createContext(null);

// Aucune identification n'est demandée : un profil générique est créé à la première visite dans
// cet onglet (une adresse unique garantit un profil distinct par onglet) et reste modifiable
// ensuite depuis sa fiche dans l'équipe.
function guestProfile() {
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10);
  return { name: 'Profil', email: `profil-${suffix}@planiflow.local` };
}

// Charge le profil connecté et son officine. `revision` augmente à chaque rafraîchissement :
// les pages s'en servent pour recharger leurs propres données après une modification.
export function WorkspaceProvider({ children }) {
  const [state, setState] = useState({ status: 'loading' });
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.session();
      if (!user) await api.login(guestProfile());
      setState({ status: 'ready', ...(await api.workspace()) });
    } catch (error) {
      setState({ status: 'error', error });
    }
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    refresh();
    return onExternalChange(refresh);
  }, [refresh]);

  const value = useMemo(() => {
    const activities = state.activities || [];
    return {
      ...state,
      revision,
      refresh,
      isManager: ['owner', 'manager'].includes(state.membership?.role),
      activeActivities: activities.filter((activity) => !activity.archived),
      activityById: new Map(activities.map((activity) => [activity.id, activity])),
    };
  }, [state, revision, refresh]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}

// Charge une ressource et la recharge quand ses dépendances changent ; les données
// précédentes restent affichées pendant le rechargement pour éviter les clignotements.
export function useResource(loader, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true }));
    loader().then(
      (data) => { if (!cancelled) setState({ data, error: null, loading: false }); },
      (error) => { if (!cancelled) setState({ data: null, error, loading: false }); },
    );
    return () => { cancelled = true; };
  }, deps);
  return state;
}
