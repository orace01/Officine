import test from 'node:test';
import assert from 'node:assert/strict';
import {
  absencesForWeek, coverage, findIssues, generateSchedule, periodCoversSlot, plannedHours, repairSchedule, updateTask,
} from './schedule.js';

const slots = [
  { id: 's1', start: '09:00', end: '11:00' },
  { id: 's2', start: '11:00', end: '13:00' },
  { id: 's3', start: '14:00', end: '16:00' },
  { id: 's4', start: '16:00', end: '18:00' },
];
const layout = { openDays: [true, true, true, true, true, true, false], slots };
const comptoir = { id: 'comptoir', name: 'Comptoir' };
const reception = { id: 'reception', name: 'Réception' };
const dates = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];

function needsFor(counts) {
  return Array.from({ length: 7 }, (_, dayIndex) => (layout.openDays[dayIndex]
    ? Object.fromEntries(slots.map((slot) => [slot.id, { ...counts }]))
    : {}));
}

function person(id, overrides = {}) {
  return { id, name: id, weeklyHours: null, skills: ['comptoir'], restDays: [], schedulable: true, ...overrides };
}

test('ne place jamais une personne deux fois sur le même créneau', () => {
  const schedule = generateSchedule({
    layout, needs: needsFor({ comptoir: 1, reception: 1 }), activities: [comptoir, reception],
    staff: [person('alex', { skills: ['comptoir', 'reception'] })],
  });
  for (const day of schedule) for (const tasks of Object.values(day)) {
    const ids = tasks.flatMap((task) => task.assignees);
    assert.equal(new Set(ids).size, ids.length);
  }
  assert.equal(coverage(schedule).missing, 24);
});

test('respecte les jours de repos et les jours fermés', () => {
  const schedule = generateSchedule({
    layout, needs: needsFor({ comptoir: 1 }), activities: [comptoir],
    staff: [person('a', { restDays: [0] }), person('b')],
  });
  assert.deepEqual(schedule[0].s1[0].assignees, ['b']);
  assert.deepEqual(schedule[6], {});
});

test('n’affecte pas une personne sans la compétence demandée', () => {
  const schedule = generateSchedule({
    layout, needs: needsFor({ reception: 1 }), activities: [comptoir, reception],
    staff: [person('a')],
  });
  assert.deepEqual(schedule[0].s1[0], { activityId: 'reception', required: 1, assignees: [] });
});

test('tient compte des absences validées selon la période', () => {
  const requests = [{ id: 'r1', employeeId: 'c', status: 'approved', startDate: '2026-10-05', endDate: '2026-10-05', period: 'morning' }];
  const absences = absencesForWeek(requests, dates);
  const schedule = generateSchedule({ layout, needs: needsFor({ comptoir: 1 }), activities: [comptoir], staff: [person('c')], absences });
  assert.deepEqual(schedule[0].s1[0].assignees, []);
  assert.deepEqual(schedule[0].s2[0].assignees, []);
  assert.deepEqual(schedule[0].s3[0].assignees, ['c']);
  assert.deepEqual(schedule[1].s1[0].assignees, ['c']);
});

test('ne dépasse pas le volume horaire hebdomadaire indiqué', () => {
  const schedule = generateSchedule({
    layout, needs: needsFor({ comptoir: 1 }), activities: [comptoir],
    staff: [person('partiel', { weeklyHours: 10 }), person('titulaire', { name: 'zz' })],
  });
  const hours = plannedHours(schedule, slots);
  assert.equal(hours.partiel, 10);
  assert.equal(coverage(schedule).missing, 0);
});

test('répartit la charge entre les personnes disponibles', () => {
  const schedule = generateSchedule({
    layout, needs: needsFor({ comptoir: 1 }), activities: [comptoir],
    staff: [person('a', { weeklyHours: 35 }), person('b', { weeklyHours: 35 })],
  });
  const hours = plannedHours(schedule, slots);
  assert.ok(Math.abs(hours.a - hours.b) <= 4, `écart trop important : ${hours.a} h / ${hours.b} h`);
});

test('distingue matin et après-midi à partir des horaires du créneau', () => {
  assert.equal(periodCoversSlot('morning', { start: '11:00', end: '13:00' }), true);
  assert.equal(periodCoversSlot('afternoon', { start: '11:00', end: '13:00' }), false);
  assert.equal(periodCoversSlot('morning', { start: '12:00', end: '14:00' }), true);
  assert.equal(periodCoversSlot('afternoon', { start: '12:00', end: '14:00' }), true);
});

test('signale manques, absences, doublons et dépassements d’heures', () => {
  let schedule = generateSchedule({ layout, needs: needsFor({ comptoir: 2 }), activities: [comptoir], staff: [person('a', { weeklyHours: 4 })] });
  schedule = updateTask(schedule, 1, 's1', 'comptoir', { assignees: ['a', 'a'] });
  const absences = [{ employeeId: 'a', dayIndex: 0, period: 'full' }];
  const types = new Set(findIssues(schedule, { layout, staff: [person('a', { weeklyHours: 4 })], absences }).map((issue) => issue.type));
  assert.deepEqual([...types].sort(), ['absent', 'double', 'gap', 'hours']);
});

test('signale une personne retirée des plannings mais encore affectée', () => {
  const staff = [person('a')];
  const schedule = generateSchedule({ layout, needs: needsFor({ comptoir: 1 }), activities: [comptoir], staff });
  const issues = findIssues(schedule, { layout, staff: [person('a', { schedulable: false })] });
  assert.ok(issues.some((issue) => issue.type === 'inactive'));
});

test('la correction automatique remplace une personne absente', () => {
  const staff = [person('a', { weeklyHours: 20 }), person('b', { weeklyHours: 20 })];
  const schedule = generateSchedule({ layout, needs: needsFor({ comptoir: 1 }), activities: [comptoir], staff });
  const absentId = schedule[2].s1[0].assignees[0];
  const absences = [{ employeeId: absentId, dayIndex: 2, period: 'full' }];
  const { schedule: repaired, removed, added } = repairSchedule(schedule, { layout, staff, absences });
  assert.ok(removed >= 1);
  assert.ok(added >= 1);
  assert.equal(repaired[2].s1[0].assignees.includes(absentId), false);
  assert.equal(findIssues(repaired, { layout, staff, absences }).some((issue) => issue.severity === 'error'), false);
});

test('updateTask retire le poste quand il ne reste ni besoin ni personne', () => {
  const schedule = updateTask(updateTask(Array.from({ length: 7 }, () => ({})), 0, 's1', 'comptoir', { required: 1 }), 0, 's1', 'comptoir', { required: 0 });
  assert.deepEqual(schedule[0], {});
});
