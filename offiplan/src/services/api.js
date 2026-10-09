// Client utilisé par l'interface. Il parle aujourd'hui à l'API de simulation locale ;
// brancher un vrai serveur ne demandera de changer que la fonction `request`.

import { createLocalApi, DATA_KEY } from './localApi.js';

const request = createLocalApi();

const id = (value) => encodeURIComponent(value);
const get = (path) => request('GET', path);
const post = (path, body) => request('POST', path, body);
const put = (path, body) => request('PUT', path, body);
const patch = (path, body) => request('PATCH', path, body);
const remove = (path) => request('DELETE', path);
const planPath = (weekStart) => `/plans/${id(weekStart)}`;

export const api = {
  session: () => get('/auth/session'),
  login: (profile) => post('/auth/login', profile),
  logout: () => post('/auth/logout'),
  resetData: () => post('/account/reset'),

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

// Prévient l'interface quand un autre onglet modifie les données de simulation.
export function onExternalChange(callback) {
  const listener = (event) => {
    if (event.key === null || event.key === DATA_KEY) callback();
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
