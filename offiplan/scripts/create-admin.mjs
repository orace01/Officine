#!/usr/bin/env node
// Crée le compte titulaire via l'API d'administration de Supabase Auth, en contournant
// l'inscription publique (désactivée, voir `enable_signup = false` dans supabase/config.toml) :
// pour cette première version, une seule personne doit pouvoir se connecter.
//
// Usage :
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/create-admin.mjs <email> ["Nom complet"]
//
// Un mot de passe est généré et affiché une seule fois : notez-le immédiatement.
// À relancer avec les variables d'un projet Supabase hébergé (Project Settings → API)
// pour y créer le même compte.

import { randomBytes } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const [email, name] = process.argv.slice(2);

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Variables manquantes : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (affichées par `pnpm supabase:start`, ou Project Settings → API pour un projet hébergé).');
  process.exit(1);
}
if (!email) {
  console.error('Usage : node scripts/create-admin.mjs <email> ["Nom complet"]');
  process.exit(1);
}

const password = randomBytes(18).toString('base64url');

const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  body: JSON.stringify({ email, password, email_confirm: true, user_metadata: name ? { name } : undefined }),
});

const body = await response.json();
if (!response.ok) {
  console.error(`Échec (${response.status}) :`, body.msg || body.message || JSON.stringify(body));
  process.exit(1);
}

console.log('Compte créé :', body.id);
console.log('  E-mail       :', email);
console.log('  Mot de passe :', password);
console.log('\nNotez ce mot de passe maintenant : il n’est affiché qu’une seule fois.');
