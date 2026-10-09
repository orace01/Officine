import { timeToMinutes } from '../lib/dates.js';

// Un planning est un tableau de 7 jours (lundi → dimanche).
// Chaque jour associe l'identifiant d'un créneau à la liste des postes à tenir :
//   schedule[dayIndex][slotId] = [{ activityId, required, assignees: [employeeId] }]
// Les besoins suivent la même forme : needs[dayIndex][slotId][activityId] = nombre de personnes.

export const DAY_COUNT = 7;

const MIDDAY = 13 * 60;
const REFERENCE_WEEKLY_HOURS = 35;
// Favorise une personne déjà présente sur le créneau précédent, pour éviter les journées morcelées.
const CONTINUITY_BONUS = 0.06;

export function slotHours(slot) {
  return Math.max(0, timeToMinutes(slot.end) - timeToMinutes(slot.start)) / 60;
}

// « Matin » couvre les créneaux qui commencent avant 13 h, « après-midi » ceux qui finissent après 13 h.
export function periodCoversSlot(period, slot) {
  if (period === 'full') return true;
  if (period === 'morning') return timeToMinutes(slot.start) < MIDDAY;
  if (period === 'afternoon') return timeToMinutes(slot.end) > MIDDAY;
  return false;
}

export function absencesForWeek(requests, dates) {
  return requests
    .filter((request) => request.status === 'approved')
    .flatMap((request) => dates.flatMap((date, dayIndex) => (date >= request.startDate && date <= request.endDate
      ? [{ requestId: request.id, employeeId: request.employeeId, dayIndex, period: request.period, type: request.type }]
      : [])));
}

// Renvoie la raison pour laquelle une personne ne peut pas tenir ce créneau, ou null.
export function unavailability(person, dayIndex, slot, absences = []) {
  if (!person || person.archived) return 'removed';
  if (person.schedulable === false) return 'inactive';
  if (person.restDays?.includes(dayIndex)) return 'rest';
  const absent = absences.some((absence) => absence.employeeId === person.id
    && absence.dayIndex === dayIndex
    && periodCoversSlot(absence.period, slot));
  return absent ? 'absent' : null;
}

export function emptySchedule() {
  return Array.from({ length: DAY_COUNT }, () => ({}));
}

export function cloneSchedule(schedule) {
  return schedule.map((day) => Object.fromEntries(Object.entries(day).map(([slotId, tasks]) => [
    slotId,
    tasks.map((task) => ({ ...task, assignees: [...task.assignees] })),
  ])));
}

export function requiredCount(needs, dayIndex, slotId, activityId) {
  return Number(needs?.[dayIndex]?.[slotId]?.[activityId] || 0);
}

export function plannedHours(schedule, slots) {
  const durations = new Map(slots.map((slot) => [slot.id, slotHours(slot)]));
  const hours = {};
  schedule.forEach((day) => Object.entries(day).forEach(([slotId, tasks]) => tasks.forEach((task) => {
    task.assignees.forEach((id) => { hours[id] = (hours[id] || 0) + (durations.get(slotId) || 0); });
  })));
  return hours;
}

export function coverage(schedule) {
  let needed = 0;
  let covered = 0;
  schedule.forEach((day) => Object.values(day).forEach((tasks) => tasks.forEach((task) => {
    needed += task.required;
    covered += Math.min(task.required, task.assignees.length);
  })));
  return { needed, covered, missing: needed - covered, percent: needed ? Math.round((covered / needed) * 100) : null };
}

export function shiftsOf(schedule, layout, employeeId) {
  const shifts = [];
  schedule.forEach((day, dayIndex) => layout.slots.forEach((slot) => {
    (day[slot.id] || []).forEach((task) => {
      if (task.assignees.includes(employeeId)) shifts.push({ dayIndex, slot, activityId: task.activityId });
    });
  }));
  return shifts;
}

function fitsWeeklyHours(person, hours, duration) {
  if (person.weeklyHours == null) return true;
  return (hours[person.id] || 0) + duration <= person.weeklyHours + 1e-9;
}

function fillTask(task, candidates, { used, hours, duration, previous }) {
  const score = (person) => (hours[person.id] || 0) / (person.weeklyHours || REFERENCE_WEEKLY_HOURS)
    - (previous.has(person.id) ? CONTINUITY_BONUS : 0);
  const pool = candidates.filter((person) => !used.has(person.id) && fitsWeeklyHours(person, hours, duration));
  while (task.assignees.length < task.required && pool.length) {
    pool.sort((left, right) => score(left) - score(right)
      || left.name.localeCompare(right.name, 'fr')
      || left.id.localeCompare(right.id));
    const person = pool.shift();
    task.assignees.push(person.id);
    used.add(person.id);
    hours[person.id] = (hours[person.id] || 0) + duration;
  }
}

function canHold(person, activityId, dayIndex, slot, absences) {
  return person.skills.includes(activityId) && !unavailability(person, dayIndex, slot, absences);
}

// Proposition gloutonne : les postes les plus difficiles à pourvoir sont servis en premier,
// puis chaque place revient à la personne la moins chargée au regard de son volume horaire.
export function generateSchedule({ layout, needs, staff, activities, absences = [] }) {
  const schedule = emptySchedule();
  const hours = {};
  const activeActivities = activities.filter((activity) => !activity.archived);

  layout.openDays.forEach((open, dayIndex) => {
    if (!open) return;
    let previous = new Set();
    layout.slots.forEach((slot) => {
      const tasks = activeActivities
        .map((activity) => ({ activityId: activity.id, required: requiredCount(needs, dayIndex, slot.id, activity.id), assignees: [] }))
        .filter((task) => task.required > 0);
      if (!tasks.length) {
        previous = new Set();
        return;
      }
      const eligible = (task) => staff.filter((person) => canHold(person, task.activityId, dayIndex, slot, absences));
      const order = [...tasks].sort((left, right) => eligible(left).length - eligible(right).length || right.required - left.required);
      const used = new Set();
      order.forEach((task) => fillTask(task, eligible(task), { used, hours, duration: slotHours(slot), previous }));
      schedule[dayIndex][slot.id] = tasks;
      previous = used;
    });
  });
  return schedule;
}

// Retire les affectations devenues impossibles (absence, repos, compétence, doublon…)
// puis complète les postes incomplets avec les personnes disponibles.
export function repairSchedule(schedule, { layout, staff, absences = [] }) {
  const result = cloneSchedule(schedule);
  const people = new Map(staff.map((person) => [person.id, person]));
  let removed = 0;
  let added = 0;

  result.forEach((day, dayIndex) => layout.slots.forEach((slot) => {
    const seen = new Set();
    (day[slot.id] || []).forEach((task) => {
      task.assignees = task.assignees.filter((id) => {
        const person = people.get(id);
        const keep = person && !seen.has(id) && canHold(person, task.activityId, dayIndex, slot, absences);
        if (keep) seen.add(id);
        else removed += 1;
        return keep;
      });
    });
  }));

  const hours = plannedHours(result, layout.slots);
  result.forEach((day, dayIndex) => layout.slots.forEach((slot) => {
    const tasks = day[slot.id] || [];
    const used = new Set(tasks.flatMap((task) => task.assignees));
    tasks.forEach((task) => {
      if (task.assignees.length >= task.required) return;
      const before = task.assignees.length;
      const candidates = staff.filter((person) => canHold(person, task.activityId, dayIndex, slot, absences));
      fillTask(task, candidates, { used, hours, duration: slotHours(slot), previous: new Set() });
      added += task.assignees.length - before;
    });
  }));

  return { schedule: result, removed, added };
}

// Liste structurée des points à vérifier ; le texte affiché est construit par l'interface.
export function findIssues(schedule, { layout, staff, absences = [] }) {
  const people = new Map(staff.map((person) => [person.id, person]));
  const issues = [];

  schedule.forEach((day, dayIndex) => layout.slots.forEach((slot) => {
    const seen = new Set();
    (day[slot.id] || []).forEach((task) => {
      const base = { dayIndex, slotId: slot.id, activityId: task.activityId };
      const missing = task.required - task.assignees.length;
      if (missing > 0) issues.push({ ...base, type: 'gap', severity: 'warning', missing });
      task.assignees.forEach((employeeId) => {
        const person = people.get(employeeId);
        const reason = unavailability(person, dayIndex, slot, absences);
        if (reason) issues.push({ ...base, type: reason, severity: 'error', employeeId });
        else if (!person.skills.includes(task.activityId)) issues.push({ ...base, type: 'skill', severity: 'error', employeeId });
        if (seen.has(employeeId)) issues.push({ ...base, type: 'double', severity: 'error', employeeId });
        seen.add(employeeId);
      });
    });
  }));

  const hours = plannedHours(schedule, layout.slots);
  staff.forEach((person) => {
    if (person.archived || person.weeklyHours == null) return;
    const planned = hours[person.id] || 0;
    if (planned > person.weeklyHours + 1e-9) {
      issues.push({ type: 'hours', severity: 'warning', employeeId: person.id, planned, limit: person.weeklyHours });
    }
  });

  return issues;
}

export function updateTask(schedule, dayIndex, slotId, activityId, changes) {
  const result = cloneSchedule(schedule);
  const tasks = result[dayIndex][slotId] ? result[dayIndex][slotId] : [];
  let task = tasks.find((item) => item.activityId === activityId);
  if (!task) {
    task = { activityId, required: 0, assignees: [] };
    tasks.push(task);
  }
  Object.assign(task, changes);
  const kept = tasks.filter((item) => item.required > 0 || item.assignees.length > 0);
  if (kept.length) result[dayIndex][slotId] = kept;
  else delete result[dayIndex][slotId];
  return result;
}

export function totalNeededHours(needs, layout) {
  let total = 0;
  layout.openDays.forEach((open, dayIndex) => {
    if (!open) return;
    layout.slots.forEach((slot) => {
      const counts = Object.values(needs?.[dayIndex]?.[slot.id] || {});
      total += counts.reduce((sum, count) => sum + Number(count || 0), 0) * slotHours(slot);
    });
  });
  return total;
}
