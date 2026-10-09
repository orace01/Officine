// Client Supabase unique pour toute l'application : authentification et appel de la fonction
// Edge `api`. Le navigateur n'interroge jamais les tables directement (voir la migration SQL,
// qui n'accorde aucune politique RLS à anon/authenticated) ; toute lecture ou écriture passe par
// cette fonction, qui revérifie elle-même l'identité et le rôle de la personne.

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Variables Supabase manquantes : copiez .env.example vers .env.local et renseignez VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.',
  );
}

export const supabase = createClient(url, anonKey);
