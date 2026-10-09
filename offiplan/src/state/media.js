import { useSyncExternalStore } from 'react';

// Vrai quand la requête média correspond (ex. écran de téléphone), mis à jour au redimensionnement.
export function useMediaQuery(query) {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

export const COMPACT_SCREEN = '(max-width: 640px)';
