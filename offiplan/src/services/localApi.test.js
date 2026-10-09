import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalApi } from './localApi.js';
import { findIssues } from '../domain/schedule.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const WEEK = '2026-10-12';
const fixedNow = () => new Date('2026-10-07T09:00:00');

function createClients() {
  const data = new MemoryStorage();
  const client = () => createLocalApi({ dataStorage: data, sessionStorage: new MemoryStorage(), baseUrl: 'http://localhost/', now: fixedNow });
  return { data, client };
}

async function setupPharmacy(api) {
  await api('POST', '/auth/login', { name: 'Alex Martin', email: 'alex@exemple.test' });
  await api('POST', '/pharmacy', { name: 'Pharmacie du Parc', city: 'Nantes' });
  const { activities } = await api('GET', '/workspace');
  const [comptoir] = activities;
  const { needs } = await api('GET', '/needs');
  needs.forEach((day, dayIndex) => Object.values(day).forEach((counts) => { if (dayIndex < 6) counts[comptoir.id] = 1; }));
  await api('PUT', '/needs', { needs });
  return { comptoir };
}

test('parcours complet : officine, équipe, invitation, publication, absence et correction', async () => {
  const { client } = createClients();
  const owner = client();
  const employeeTab = client();
  const { comptoir } = await setupPharmacy(owner);

  const workspace = await owner('GET', '/workspace');
  assert.equal(workspace.membership.role, 'owner');
  assert.deepEqual(workspace.pharmacy.setup.completed, ['officine']);

  const { member: camille } = await owner('POST', '/team', {
    name: 'Camille Durand', roleTitle: 'Préparatrice', weeklyHours: 35, skills: [comptoir.id], restDays: [],
  });
  const ownerEmployeeId = workspace.membership.employeeId;
  const { members } = await owner('GET', '/team');
  const ownerProfile = members.find((member) => member.id === ownerEmployeeId);
  await owner('PUT', `/team/${ownerEmployeeId}`, { ...ownerProfile, restDays: [0, 1, 2, 3, 4, 5] });

  const invited = await owner('POST', `/team/${camille.id}/invitation`, { role: 'employee' });
  assert.equal(invited.member.access.status, 'invited');
  const token = invited.member.access.url.split('#/rejoindre/')[1];
  assert.equal((await employeeTab('GET', `/invitations/${token}`)).state, 'valid');

  await employeeTab('POST', '/auth/login', { name: 'Camille Durand', email: 'camille@exemple.test' });
  await employeeTab('POST', `/invitations/${token}/accept`);
  assert.equal((await employeeTab('GET', '/workspace')).membership.role, 'employee');
  assert.equal((await employeeTab('GET', `/invitations/${token}`)).state, 'used');

  const generated = await owner('POST', `/plans/${WEEK}/generate`);
  const firstSlot = generated.layout.slots[0].id;
  assert.deepEqual(generated.draft.schedule[0][firstSlot][0].assignees, [camille.id]);
  assert.equal((await employeeTab('GET', `/my/schedule/${WEEK}`)).published, null);

  await owner('POST', `/plans/${WEEK}/publish`, { versionId: generated.draft.id });
  const mine = await employeeTab('GET', `/my/schedule/${WEEK}`);
  assert.equal(mine.published.number, 1);
  assert.ok(mine.shifts.some((shift) => shift.dayIndex === 0 && shift.slotId === firstSlot));

  const { request } = await employeeTab('POST', '/requests', {
    type: 'leave', startDate: WEEK, endDate: WEEK, period: 'morning', note: 'Rendez-vous',
  });
  assert.equal(request.status, 'pending');
  assert.equal((await owner('GET', '/workspace')).counts.pendingRequests, 1);
  await owner('PATCH', `/requests/${request.id}`, { status: 'approved' });

  const plan = await owner('GET', `/plans/${WEEK}`);
  const staff = (await owner('GET', '/team')).members;
  const issues = findIssues(plan.published.schedule, { layout: plan.published.layout, staff, absences: plan.absences });
  assert.ok(issues.some((issue) => issue.type === 'absent' && issue.employeeId === camille.id));

  const repaired = await owner('POST', `/plans/${WEEK}/repair`);
  assert.equal(repaired.removed, 2);
  assert.equal(repaired.draft.number, 2);
  assert.equal(repaired.published.number, 1, 'la version publiée reste visible tant que la correction n’est pas publiée');
  await owner('POST', `/plans/${WEEK}/publish`, { versionId: repaired.draft.id });
  const updated = await employeeTab('GET', `/my/schedule/${WEEK}`);
  assert.equal(updated.published.number, 2);
  assert.equal(updated.shifts.some((shift) => shift.dayIndex === 0 && shift.slotId === firstSlot), false);
});

test('retirer le titulaire des plannings ne lui retire pas son accès', async () => {
  const { client } = createClients();
  const owner = client();
  await setupPharmacy(owner);
  const { membership } = await owner('GET', '/workspace');
  const { members } = await owner('GET', '/team');
  const profile = members.find((member) => member.id === membership.employeeId);
  await owner('PUT', `/team/${profile.id}`, { ...profile, schedulable: false });
  const after = await owner('GET', '/workspace');
  assert.equal(after.membership.role, 'owner');
  await assert.rejects(owner('DELETE', `/team/${profile.id}`), /titulaire/);
});

test('une personne retirée reste modifiable dans un brouillon existant', async () => {
  const { client } = createClients();
  const owner = client();
  const { comptoir } = await setupPharmacy(owner);
  const { member } = await owner('POST', '/team', { name: 'Lou Bernard', roleTitle: 'Préparateur', weeklyHours: 35, skills: [comptoir.id] });
  const generated = await owner('POST', `/plans/${WEEK}/generate`);
  await owner('DELETE', `/team/${member.id}`);
  const saved = await owner('PUT', `/plans/${WEEK}/draft`, { schedule: generated.draft.schedule });
  assert.equal(saved.draft.id, generated.draft.id);
  const staff = (await owner('GET', '/team')).members;
  const issues = findIssues(saved.draft.schedule, { layout: saved.draft.layout, staff, absences: [] });
  assert.ok(issues.some((issue) => issue.type === 'removed'));
});

test('regénérer conserve l’ancien brouillon dans l’historique et permet de le restaurer', async () => {
  const { client } = createClients();
  const owner = client();
  await setupPharmacy(owner);
  const first = await owner('POST', `/plans/${WEEK}/generate`);
  const edited = structuredClone(first.draft.schedule);
  const slotId = first.layout.slots[0].id;
  edited[0][slotId][0].assignees = [];
  await owner('PUT', `/plans/${WEEK}/draft`, { schedule: edited });
  const second = await owner('POST', `/plans/${WEEK}/generate`);
  assert.equal(second.draft.number, 2);
  assert.equal(second.history.find((version) => version.number === 1).status, 'archived');
  const restored = await owner('POST', `/plans/${WEEK}/restore`, { versionId: first.draft.id });
  assert.equal(restored.draft.number, 3);
  assert.deepEqual(restored.draft.schedule[0][slotId][0].assignees, []);
});

test('modifier les créneaux conserve les besoins des créneaux inchangés', async () => {
  const { client } = createClients();
  const owner = client();
  const { comptoir } = await setupPharmacy(owner);
  const { pharmacy } = await owner('GET', '/workspace');
  const [first, , third] = pharmacy.settings.slots;
  await owner('PUT', '/pharmacy/settings', {
    openDays: pharmacy.settings.openDays,
    slots: [first, third, { start: '18:00', end: '19:30' }],
  });
  const { needs } = await owner('GET', '/needs');
  assert.equal(Object.keys(needs[0]).length, 3);
  assert.equal(needs[0][first.id][comptoir.id], 1);
  assert.equal(Object.values(needs[0]).filter((counts) => counts[comptoir.id] === 0).length, 1);
  await assert.rejects(owner('PUT', '/pharmacy/settings', {
    openDays: pharmacy.settings.openDays,
    slots: [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '13:00' }],
  }), /chevauchent/);
});

test('un collaborateur ne voit que ses demandes et ne peut pas administrer', async () => {
  const { client } = createClients();
  const owner = client();
  const { comptoir } = await setupPharmacy(owner);
  const { member } = await owner('POST', '/team', { name: 'Noé Garcia', roleTitle: 'Rayonniste', skills: [comptoir.id] });
  const { member: other } = await owner('POST', '/team', { name: 'Jade Roux', roleTitle: 'Préparatrice', skills: [comptoir.id] });
  await owner('POST', '/requests', { employeeId: other.id, type: 'leave', startDate: WEEK, endDate: WEEK, period: 'full' });
  const invited = await owner('POST', `/team/${member.id}/invitation`, { role: 'employee' });
  const employee = client();
  await employee('POST', '/auth/login', { name: 'Noé Garcia', email: 'noe@exemple.test' });
  await employee('POST', `/invitations/${invited.member.access.url.split('/').pop()}/accept`);
  assert.equal((await employee('GET', '/requests')).requests.length, 0);
  await assert.rejects(employee('GET', '/team'), (error) => error.status === 403);
  await assert.rejects(employee('POST', `/plans/${WEEK}/generate`), (error) => error.status === 403);
});

test('réinitialiser les données efface les profils et l’officine', async () => {
  const { client } = createClients();
  const owner = client();
  await setupPharmacy(owner);
  await owner('POST', '/account/reset');
  await assert.rejects(owner('GET', '/workspace'), (error) => error.status === 401);
});
