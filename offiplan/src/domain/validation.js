// Règles de validation utilisées par la fonction Edge Supabase (`supabase/functions/api/`) :
// aucune dépendance au navigateur ni à Postgres, uniquement des transformations sur des objets
// JavaScript simples.

import { DAY_COUNT } from './schedule.js';
import { MAX_NEED, MAX_SLOTS, MAX_WEEKLY_HOURS } from './defaults.js';
import { daysBetween, isISODate, isTime, isWeekStart, timeToMinutes } from '../lib/dates.js';

export const MANAGER_ROLES = ['owner', 'manager'];
export const REQUEST_TYPES = ['leave', 'unavailability', 'training'];
export const PERIODS = ['full', 'morning', 'afternoon'];

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function fail(status, code, message) {
  throw new ApiError(status, code, message);
}

export function randomPart() {
  return globalThis.crypto?.randomUUID?.().replaceAll('-', '') || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

export function makeId(prefix) {
  return `${prefix}_${randomPart().slice(0, 16)}`;
}

export const text = (value, max) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
export const unique = (values) => [...new Set(values)];
export const asList = (value) => (Array.isArray(value) ? value : []);
export const isManagerRole = (role) => MANAGER_ROLES.includes(role);

export function checkWeek(value) {
  if (!isWeekStart(value)) fail(400, 'week_invalid', 'La semaine doit commencer un lundi (format AAAA-MM-JJ).');
  return value;
}

export function validatePharmacy(body) {
  const name = text(body.name, 120);
  const city = text(body.city, 80);
  if (name.length < 2) fail(400, 'pharmacy_name_invalid', 'Indiquez le nom de l’officine (deux caractères minimum).');
  return { name, city };
}

export function validateSettings(body, current) {
  const { openDays, slots } = body;
  if (!Array.isArray(openDays) || openDays.length !== DAY_COUNT || openDays.some((value) => typeof value !== 'boolean')) {
    fail(400, 'open_days_invalid', 'Indiquez les jours d’ouverture.');
  }
  if (!openDays.some(Boolean)) fail(400, 'open_days_empty', 'Choisissez au moins un jour d’ouverture.');
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > MAX_SLOTS) fail(400, 'slots_count_invalid', `Prévoyez entre 1 et ${MAX_SLOTS} créneaux.`);
  const knownIds = new Set(current.slots.map((slot) => slot.id));
  const usedIds = new Set();
  const cleaned = slots.map((slot) => {
    if (!isTime(slot?.start) || !isTime(slot?.end) || timeToMinutes(slot.end) <= timeToMinutes(slot.start)) {
      fail(400, 'slot_invalid', 'Chaque créneau doit se terminer après son début.');
    }
    const id = knownIds.has(slot.id) && !usedIds.has(slot.id) ? slot.id : makeId('slot');
    usedIds.add(id);
    return { id, start: slot.start, end: slot.end };
  }).sort((left, right) => timeToMinutes(left.start) - timeToMinutes(right.start));
  cleaned.forEach((slot, index) => {
    if (index && timeToMinutes(slot.start) < timeToMinutes(cleaned[index - 1].end)) fail(400, 'slots_overlap', 'Deux créneaux se chevauchent.');
  });
  return { openDays: [...openDays], slots: cleaned };
}

// `activityIds` : identifiants des postes actifs de l'officine (Set).
export function validateMember(body, activityIds) {
  const name = text(body.name, 120);
  const roleTitle = text(body.roleTitle, 80);
  if (name.length < 2) fail(400, 'member_name_invalid', 'Indiquez le nom de la personne.');
  if (!roleTitle) fail(400, 'member_role_invalid', 'Indiquez sa fonction.');
  const skills = unique(asList(body.skills).map(String)).filter((id) => activityIds.has(id));
  const restDays = unique(asList(body.restDays).map(Number)).filter((day) => Number.isInteger(day) && day >= 0 && day < DAY_COUNT).sort();
  const rawHours = body.weeklyHours;
  const weeklyHours = rawHours === '' || rawHours === null || rawHours === undefined ? null : Number(rawHours);
  if (weeklyHours !== null && (!Number.isFinite(weeklyHours) || weeklyHours < 0 || weeklyHours > MAX_WEEKLY_HOURS)) {
    fail(400, 'weekly_hours_invalid', `Le volume horaire doit être compris entre 0 et ${MAX_WEEKLY_HOURS} heures.`);
  }
  const schedulable = body.schedulable !== false;
  if (schedulable && !skills.length) fail(400, 'skills_required', 'Choisissez au moins un poste que cette personne peut tenir.');
  return { name, roleTitle, weeklyHours, skills, restDays, schedulable };
}

export function validateRequest(body, { allowPast, today }) {
  const { type, startDate, endDate, period } = body;
  if (!REQUEST_TYPES.includes(type)) fail(400, 'request_type_invalid', 'Choisissez le type d’absence.');
  if (!isISODate(startDate) || !isISODate(endDate)) fail(400, 'request_dates_invalid', 'Indiquez des dates valides.');
  if (endDate < startDate) fail(400, 'request_dates_order', 'La date de fin doit suivre la date de début.');
  if (daysBetween(startDate, endDate) > 365) fail(400, 'request_too_long', 'Une demande ne peut pas dépasser un an.');
  if (!allowPast && startDate < today) fail(400, 'request_past', 'La date de début est déjà passée.');
  if (!PERIODS.includes(period)) fail(400, 'request_period_invalid', 'Choisissez la période concernée.');
  return { type, startDate, endDate, period, note: text(body.note, 500) || null };
}

export function validateSchedule(schedule, layout, activityIds, employeeIds) {
  if (!Array.isArray(schedule) || schedule.length !== DAY_COUNT) fail(400, 'schedule_invalid', 'Le planning doit couvrir les sept jours de la semaine.');
  const slotIds = new Set(layout.slots.map((slot) => slot.id));
  return schedule.map((day) => {
    if (!day || typeof day !== 'object' || Array.isArray(day)) fail(400, 'schedule_invalid', 'Une journée du planning est invalide.');
    const cleanDay = {};
    Object.entries(day).forEach(([slotId, tasks]) => {
      if (!slotIds.has(slotId) || !Array.isArray(tasks)) fail(400, 'schedule_slot_invalid', 'Le planning contient un créneau inconnu.');
      const seen = new Set();
      const cleanTasks = tasks.map((task) => {
        if (!activityIds.has(task?.activityId) || seen.has(task.activityId)) fail(400, 'schedule_activity_invalid', 'Le planning contient un poste inconnu ou en double.');
        seen.add(task.activityId);
        const required = Number(task.required);
        if (!Number.isInteger(required) || required < 0 || required > MAX_NEED || !Array.isArray(task.assignees)) {
          fail(400, 'schedule_task_invalid', 'Un poste du planning est invalide.');
        }
        const assignees = unique(task.assignees.map(String));
        if (assignees.some((id) => !employeeIds.has(id))) fail(400, 'schedule_member_invalid', 'Le planning contient une personne inconnue.');
        return { activityId: task.activityId, required, assignees };
      }).filter((task) => task.required > 0 || task.assignees.length > 0);
      if (cleanTasks.length) cleanDay[slotId] = cleanTasks;
    });
    return cleanDay;
  });
}

// Grille dense (chaque créneau × chaque poste actif, zéro par défaut) à partir du stockage
// creux (seuls les besoins non nuls sont conservés).
export function denseNeeds(needs, slots, activityIds) {
  const ids = [...activityIds];
  return Array.from({ length: DAY_COUNT }, (_, dayIndex) => Object.fromEntries(slots.map((slot) => [
    slot.id,
    Object.fromEntries(ids.map((id) => [id, Number(needs[dayIndex]?.[slot.id]?.[id] || 0)])),
  ])));
}

export function validateNeeds(body, slotIds, activityIds) {
  const { needs } = body;
  if (!Array.isArray(needs) || needs.length !== DAY_COUNT) fail(400, 'needs_invalid', 'Les besoins doivent couvrir les sept jours de la semaine.');
  return needs.map((day) => {
    const cleanDay = {};
    Object.entries(day || {}).forEach(([slotId, counts]) => {
      if (!slotIds.has(slotId)) return;
      const cleanCounts = {};
      Object.entries(counts || {}).forEach(([activityId, raw]) => {
        if (!activityIds.has(activityId)) return;
        const count = Number(raw);
        if (!Number.isInteger(count) || count < 0 || count > MAX_NEED) fail(400, 'need_invalid', `Chaque besoin doit être un nombre entier entre 0 et ${MAX_NEED}.`);
        if (count > 0) cleanCounts[activityId] = count;
      });
      if (Object.keys(cleanCounts).length) cleanDay[slotId] = cleanCounts;
    });
    return cleanDay;
  });
}
