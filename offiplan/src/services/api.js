// Client utilisé par l'interface : authentification via Supabase Auth, tout le reste (officine,
// équipe, plannings…) via la fonction Edge `api`, qui revérifie elle-même l'identité et le rôle
// de la personne (voir `supabase/functions/api/index.ts`).

import { supabase } from './supabaseClient.js';

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api`;

// Les messages de Supabase Auth ne sont pas traduits ; on reprend ceux qui peuvent apparaître
// dans le formulaire de connexion pour rester cohérent avec le reste de l'interface.
const AUTH_MESSAGES = {
  'Invalid login credentials': 'Adresse courriel ou mot de passe incorrect.',
  'Email not confirmed': 'Cette adresse courriel n’a pas encore été confirmée.',
};

function translateAuthError(error) {
  return new Error(AUTH_MESSAGES[error.message] || error.message);
}

async function authedFetch(method, path, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch(`${FUNCTIONS_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: ['GET', 'DELETE'].includes(method) ? undefined : JSON.stringify(body || {}),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(payload?.message || `Une erreur est survenue (${response.status}).`);
  return payload;
}

const id = (value) => encodeURIComponent(value);
const get = (path) => authedFetch('GET', path);
const post = (path, body) => authedFetch('POST', path, body);
const put = (path, body) => authedFetch('PUT', path, body);
const patch = (path, body) => authedFetch('PATCH', path, body);
const remove = (path) => authedFetch('DELETE', path);
const planPath = (weekStart) => `/plans/${id(weekStart)}`;

export const api = {
  session: async () => {
    const { data } = await supabase.auth.getSession();
    return { user: data.session ? { id: data.session.user.id } : null };
  },
  login: async ({ email, password }) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw translateAuthError(error);
  },
  logout: () => supabase.auth.signOut(),

  workspace: () => get('/workspace'),
  createPharmacy: (values) => post('/pharmacy', values),
  updatePharmacy: (values) => put('/pharmacy', values),
  saveSettings: (settings) => put('/pharmacy/settings', settings),
  completeSetupStep: (step) => post('/pharmacy/setup', { step }),
  finishSetup: () => post('/pharmacy/setup', { done: true }),

  needs: () => get('/needs'),
  saveNeeds: (needs) => put('/needs', { needs }),
  addActivity: (name) => post('/activities', { name }),
  renameActivity: (activityId, name) => put(`/activities/${id(activityId)}`, { name }),
  removeActivity: (activityId) => remove(`/activities/${id(activityId)}`),

  team: () => get('/team'),
  addMember: (values) => post('/team', values),
  updateMember: (memberId, values) => put(`/team/${id(memberId)}`, values),
  removeMember: (memberId) => remove(`/team/${id(memberId)}`),
  inviteMember: (memberId, role) => post(`/team/${id(memberId)}/invitation`, { role }),
  revokeAccess: (memberId) => remove(`/team/${id(memberId)}/access`),
  invitation: (token) => get(`/invitations/${id(token)}`),
  acceptInvitation: (token) => post(`/invitations/${id(token)}/accept`),

  requests: () => get('/requests'),
  createRequest: (values) => post('/requests', values),
  reviewRequest: (requestId, status, reviewNote) => patch(`/requests/${id(requestId)}`, { status, reviewNote }),
  cancelRequest: (requestId) => remove(`/requests/${id(requestId)}`),

  plan: (weekStart) => get(planPath(weekStart)),
  generatePlan: (weekStart) => post(`${planPath(weekStart)}/generate`),
  saveDraft: (weekStart, schedule) => put(`${planPath(weekStart)}/draft`, { schedule }),
  discardDraft: (weekStart) => remove(`${planPath(weekStart)}/draft`),
  publishPlan: (weekStart, versionId) => post(`${planPath(weekStart)}/publish`, { versionId }),
  repairPlan: (weekStart) => post(`${planPath(weekStart)}/repair`),
  restoreVersion: (weekStart, versionId) => post(`${planPath(weekStart)}/restore`, { versionId }),
  mySchedule: (weekStart) => get(`/my/schedule/${id(weekStart)}`),
};

// Prévient l'interface quand la session change (connexion, déconnexion, rafraîchissement de
// jeton dans un autre onglet du même navigateur).
export function onExternalChange(callback) {
  const { data: subscription } = supabase.auth.onAuthStateChange(() => callback());
  return () => subscription.subscription.unsubscribe();
}
