// API de simulation : reproduit dans le navigateur les routes qu'exposerait un serveur.
// Les données sont partagées entre onglets (localStorage) ; le profil connecté est propre
// à chaque onglet (sessionStorage), ce qui permet de jouer titulaire et collaborateur en parallèle.

import { absencesForWeek, DAY_COUNT, generateSchedule, repairSchedule, shiftsOf } from '../domain/schedule.js';
import {
  ACTIVITY_COLORS, DEFAULT_OPEN_DAYS, DEFAULT_SLOTS, MAX_ACTIVITIES, MAX_NEED, MAX_SLOTS, MAX_WEEKLY_HOURS,
  SETUP_STEPS, STARTER_ACTIVITIES,
} from '../domain/defaults.js';
import { daysBetween, isISODate, isTime, isWeekStart, timeToMinutes, toISODate, weekDates } from '../lib/dates.js';

export const DATA_KEY = 'planiflow.data.v2';
const SESSION_KEY = 'planiflow.session.v2';
const LEGACY_KEYS = ['offiplan.data.v2', 'offiplan.simulation.v1', 'offiplan.simulation.user'];
const INVITATION_DAYS = 14;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MANAGER_ROLES = ['owner', 'manager'];
const REQUEST_TYPES = ['leave', 'unavailability', 'training'];
const PERIODS = ['full', 'morning', 'afternoon'];
const STATUS_ORDER = ['pending', 'approved', 'refused', 'cancelled'];
const INVITATION_MESSAGES = {
  unknown: 'Ce lien d’invitation n’existe pas.',
  revoked: 'Ce lien d’invitation a été annulé. Demandez-en un nouveau au titulaire.',
  used: 'Ce lien d’invitation a déjà été utilisé.',
  expired: 'Ce lien d’invitation a expiré. Demandez-en un nouveau au titulaire.',
};

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new ApiError(status, code, message);
}

function randomPart() {
  return globalThis.crypto?.randomUUID?.().replaceAll('-', '') || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

export function makeId(prefix) {
  return `${prefix}_${randomPart().slice(0, 16)}`;
}

export function emptyData() {
  return { version: 2, users: [], pharmacies: [], activities: [], employees: [], memberships: [], invitations: [], requests: [], plans: [] };
}

const text = (value, max) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const unique = (values) => [...new Set(values)];
const asList = (value) => (Array.isArray(value) ? value : []);
const isManagerRole = (role) => MANAGER_ROLES.includes(role);

// ——— Accès ———

function currentUser(ctx) {
  return ctx.data.users.find((user) => user.id === ctx.session.get()) || null;
}

function requireUser(ctx) {
  return currentUser(ctx) || fail(401, 'authentication_required', 'Choisissez un profil pour continuer.');
}

function membershipOf(data, userId) {
  return data.memberships.find((membership) => membership.userId === userId) || null;
}

function requireMember(ctx) {
  const user = requireUser(ctx);
  const membership = membershipOf(ctx.data, user.id) || fail(403, 'pharmacy_required', 'Ce profil n’est rattaché à aucune officine.');
  const pharmacy = ctx.data.pharmacies.find((item) => item.id === membership.pharmacyId);
  return { user, membership, pharmacy };
}

function requireManager(ctx) {
  const access = requireMember(ctx);
  if (!isManagerRole(access.membership.role)) fail(403, 'manager_required', 'Cette action est réservée au titulaire et aux gestionnaires.');
  return access;
}

// ——— Lectures ———

function activitiesOf(data, pharmacyId) {
  return data.activities.filter((activity) => activity.pharmacyId === pharmacyId).sort((left, right) => left.order - right.order);
}

function activeActivityIds(data, pharmacyId) {
  return new Set(activitiesOf(data, pharmacyId).filter((activity) => !activity.archived).map((activity) => activity.id));
}

function employeesOf(data, pharmacyId) {
  return data.employees.filter((employee) => employee.pharmacyId === pharmacyId);
}

function findEmployee(data, pharmacyId, id) {
  return data.employees.find((employee) => employee.id === id && employee.pharmacyId === pharmacyId)
    || fail(404, 'member_not_found', 'Cette personne ne fait pas partie de l’équipe.');
}

function requestsOf(data, pharmacyId) {
  return data.requests.filter((request) => request.pharmacyId === pharmacyId);
}

function layoutOf(pharmacy) {
  return { openDays: [...pharmacy.settings.openDays], slots: pharmacy.settings.slots.map((slot) => ({ ...slot })) };
}

function readNeeds(data, pharmacy) {
  const activityIds = [...activeActivityIds(data, pharmacy.id)];
  return Array.from({ length: DAY_COUNT }, (_, dayIndex) => Object.fromEntries(pharmacy.settings.slots.map((slot) => [
    slot.id,
    Object.fromEntries(activityIds.map((id) => [id, Number(pharmacy.needs[dayIndex]?.[slot.id]?.[id] || 0)])),
  ])));
}

function planOf(data, pharmacyId, weekStart) {
  return data.plans.find((plan) => plan.pharmacyId === pharmacyId && plan.weekStart === weekStart) || null;
}

function versionById(plan, id) {
  return (id && plan?.versions.find((version) => version.id === id)) || null;
}

function userName(data, id) {
  return data.users.find((user) => user.id === id)?.name || null;
}

// ——— Formats de réponse ———

const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email });

const publicActivity = (activity) => ({
  id: activity.id, name: activity.name, color: activity.color, order: activity.order, archived: Boolean(activity.archived),
});

function publicPharmacy(pharmacy) {
  return {
    id: pharmacy.id,
    name: pharmacy.name,
    city: pharmacy.city,
    settings: layoutOf(pharmacy),
    setup: { completed: [...pharmacy.setup.completed], done: pharmacy.setup.done },
  };
}

function invitationUrl(ctx, token) {
  return `${ctx.baseUrl}#/rejoindre/${token}`;
}

function accessOf(ctx, employee) {
  const membership = ctx.data.memberships.find((item) => item.employeeId === employee.id);
  if (membership) return { status: membership.role === 'owner' ? 'owner' : 'linked', role: membership.role };
  const invitation = ctx.data.invitations.find((item) => item.employeeId === employee.id
    && !item.acceptedAt && !item.revokedAt && item.expiresAt > ctx.now);
  if (invitation) return { status: 'invited', role: invitation.role, expiresAt: invitation.expiresAt, url: invitationUrl(ctx, invitation.token) };
  return { status: 'none', role: null };
}

function publicMember(ctx, employee) {
  return {
    id: employee.id,
    name: employee.name,
    roleTitle: employee.roleTitle,
    weeklyHours: employee.weeklyHours,
    skills: [...employee.skills],
    restDays: [...employee.restDays],
    schedulable: employee.schedulable,
    archived: Boolean(employee.archived),
    access: accessOf(ctx, employee),
  };
}

function publicRequest(data, request) {
  return {
    ...request,
    employeeName: data.employees.find((employee) => employee.id === request.employeeId)?.name || 'Personne retirée',
    createdByName: userName(data, request.createdBy),
    reviewedByName: userName(data, request.reviewedBy),
  };
}

function publicVersion(data, version, { withSchedule = true } = {}) {
  return {
    id: version.id,
    number: version.number,
    status: version.status,
    source: version.source,
    edited: Boolean(version.edited),
    restoredFrom: version.restoredFrom || null,
    createdAt: version.createdAt,
    createdByName: userName(data, version.createdBy),
    updatedAt: version.updatedAt,
    publishedAt: version.publishedAt,
    publishedByName: userName(data, version.publishedBy),
    layout: structuredClone(version.layout),
    ...(withSchedule ? { schedule: structuredClone(version.schedule) } : {}),
  };
}

function planPayload(ctx, pharmacy, weekStart) {
  const plan = planOf(ctx.data, pharmacy.id, weekStart);
  const dates = weekDates(weekStart);
  const draft = versionById(plan, plan?.draftId);
  const published = versionById(plan, plan?.publishedId);
  return {
    weekStart,
    dates,
    layout: layoutOf(pharmacy),
    needs: readNeeds(ctx.data, pharmacy),
    draft: draft && publicVersion(ctx.data, draft),
    published: published && publicVersion(ctx.data, published),
    history: plan ? [...plan.versions].reverse().map((version) => publicVersion(ctx.data, version, { withSchedule: false })) : [],
    absences: absencesForWeek(requestsOf(ctx.data, pharmacy.id), dates),
  };
}

// ——— Validations ———

function checkWeek(value) {
  if (!isWeekStart(value)) fail(400, 'week_invalid', 'La semaine doit commencer un lundi (format AAAA-MM-JJ).');
  return value;
}

function validatePharmacy(body) {
  const name = text(body.name, 120);
  const city = text(body.city, 80);
  if (name.length < 2) fail(400, 'pharmacy_name_invalid', 'Indiquez le nom de l’officine (deux caractères minimum).');
  return { name, city };
}

function validateSettings(body, current) {
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

function validateMember(body, data, pharmacyId) {
  const name = text(body.name, 120);
  const roleTitle = text(body.roleTitle, 80);
  if (name.length < 2) fail(400, 'member_name_invalid', 'Indiquez le nom de la personne.');
  if (!roleTitle) fail(400, 'member_role_invalid', 'Indiquez sa fonction.');
  const activityIds = activeActivityIds(data, pharmacyId);
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

function validateRequest(body, { allowPast, today }) {
  const { type, startDate, endDate, period } = body;
  if (!REQUEST_TYPES.includes(type)) fail(400, 'request_type_invalid', 'Choisissez le type d’absence.');
  if (!isISODate(startDate) || !isISODate(endDate)) fail(400, 'request_dates_invalid', 'Indiquez des dates valides.');
  if (endDate < startDate) fail(400, 'request_dates_order', 'La date de fin doit suivre la date de début.');
  if (daysBetween(startDate, endDate) > 365) fail(400, 'request_too_long', 'Une demande ne peut pas dépasser un an.');
  if (!allowPast && startDate < today) fail(400, 'request_past', 'La date de début est déjà passée.');
  if (!PERIODS.includes(period)) fail(400, 'request_period_invalid', 'Choisissez la période concernée.');
  return { type, startDate, endDate, period, note: text(body.note, 500) || null };
}

function validateSchedule(schedule, layout, activityIds, employeeIds) {
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

// ——— Écritures partagées ———

function removeAccess(ctx, employee) {
  ctx.data.memberships = ctx.data.memberships.filter((membership) => membership.employeeId !== employee.id);
  ctx.data.invitations.forEach((invitation) => {
    if (invitation.employeeId === employee.id && !invitation.acceptedAt && !invitation.revokedAt) invitation.revokedAt = ctx.now;
  });
  employee.userId = null;
}

function addDraft(ctx, plan, { schedule, layout, source, user, restoredFrom = null }) {
  const current = versionById(plan, plan.draftId);
  if (current) {
    current.status = 'archived';
    current.archivedAt = ctx.now;
  }
  const version = {
    id: makeId('ver'),
    number: plan.versions.length + 1,
    status: 'draft',
    source,
    edited: source === 'edited',
    restoredFrom,
    schedule,
    layout,
    createdAt: ctx.now,
    createdBy: user.id,
    updatedAt: ctx.now,
    publishedAt: null,
    publishedBy: null,
    archivedAt: null,
  };
  plan.versions.push(version);
  plan.draftId = version.id;
  return version;
}

function ensurePlan(data, pharmacyId, weekStart) {
  let plan = planOf(data, pharmacyId, weekStart);
  if (!plan) {
    plan = { id: makeId('pln'), pharmacyId, weekStart, versions: [], draftId: null, publishedId: null };
    data.plans.push(plan);
  }
  return plan;
}

function invitationState(ctx, invitation) {
  if (!invitation) return 'unknown';
  if (invitation.revokedAt) return 'revoked';
  if (invitation.acceptedAt) return 'used';
  if (invitation.expiresAt <= ctx.now) return 'expired';
  const employee = ctx.data.employees.find((item) => item.id === invitation.employeeId);
  return !employee || employee.archived ? 'revoked' : 'valid';
}

// ——— Routes ———

const routes = [];

function route(method, pattern, handler) {
  routes.push({ method, segments: pattern.split('/').filter(Boolean), handler });
}

function matchRoute(method, path) {
  const segments = path.split('/').filter(Boolean);
  for (const candidate of routes) {
    if (candidate.method !== method || candidate.segments.length !== segments.length) continue;
    const params = {};
    const matched = candidate.segments.every((segment, index) => {
      if (segment.startsWith(':')) {
        params[segment.slice(1)] = decodeURIComponent(segments[index]);
        return true;
      }
      return segment === segments[index];
    });
    if (matched) return { handler: candidate.handler, params };
  }
  return null;
}

route('GET', '/auth/session', (ctx) => {
  const user = currentUser(ctx);
  return { user: user ? publicUser(user) : null };
});

route('POST', '/auth/login', (ctx) => {
  const name = text(ctx.body.name, 120);
  const email = text(ctx.body.email, 200).toLowerCase();
  if (name.length < 2) fail(400, 'name_invalid', 'Indiquez votre nom (deux caractères minimum).');
  if (!EMAIL_PATTERN.test(email)) fail(400, 'email_invalid', 'Indiquez une adresse courriel valide, même fictive.');
  let user = ctx.data.users.find((item) => item.email === email);
  const existing = Boolean(user);
  if (!user) {
    user = { id: makeId('usr'), name, email, createdAt: ctx.now };
    ctx.data.users.push(user);
    ctx.save();
  }
  ctx.session.set(user.id);
  return { user: publicUser(user), existing };
});

route('POST', '/auth/logout', (ctx) => {
  ctx.session.clear();
  return { ok: true };
});

route('POST', '/account/reset', (ctx) => {
  ctx.reset();
  return { ok: true };
});

route('GET', '/workspace', (ctx) => {
  const user = requireUser(ctx);
  const membership = membershipOf(ctx.data, user.id);
  if (!membership) return { user: publicUser(user), pharmacy: null, membership: null, activities: [], counts: { pendingRequests: 0 } };
  const pharmacy = ctx.data.pharmacies.find((item) => item.id === membership.pharmacyId);
  const employee = ctx.data.employees.find((item) => item.id === membership.employeeId);
  const pendingRequests = isManagerRole(membership.role)
    ? requestsOf(ctx.data, pharmacy.id).filter((request) => request.status === 'pending').length
    : 0;
  return {
    user: publicUser(user),
    pharmacy: publicPharmacy(pharmacy),
    membership: { role: membership.role, employeeId: membership.employeeId, employeeName: employee?.name || user.name },
    activities: activitiesOf(ctx.data, pharmacy.id).map(publicActivity),
    counts: { pendingRequests },
  };
});

route('POST', '/pharmacy', (ctx) => {
  const user = requireUser(ctx);
  if (membershipOf(ctx.data, user.id)) fail(409, 'membership_exists', 'Ce profil est déjà rattaché à une officine.');
  const values = validatePharmacy(ctx.body);
  const pharmacyId = makeId('pha');
  const activities = STARTER_ACTIVITIES.map((name, index) => ({
    id: makeId('act'), pharmacyId, name, color: ACTIVITY_COLORS[index % ACTIVITY_COLORS.length], order: index, archived: false,
  }));
  const pharmacy = {
    id: pharmacyId,
    ...values,
    ownerUserId: user.id,
    createdAt: ctx.now,
    settings: { openDays: [...DEFAULT_OPEN_DAYS], slots: DEFAULT_SLOTS.map((slot) => ({ id: makeId('slot'), ...slot })) },
    needs: Array.from({ length: DAY_COUNT }, () => ({})),
    setup: { completed: ['officine'], done: false },
  };
  const employeeId = makeId('emp');
  ctx.data.pharmacies.push(pharmacy);
  ctx.data.activities.push(...activities);
  ctx.data.employees.push({
    id: employeeId, pharmacyId, userId: user.id, name: user.name, roleTitle: 'Pharmacien·ne titulaire', weeklyHours: null,
    skills: activities.map((activity) => activity.id), restDays: [], schedulable: true, archived: false, createdAt: ctx.now,
  });
  ctx.data.memberships.push({ id: makeId('mbr'), pharmacyId, userId: user.id, employeeId, role: 'owner' });
  ctx.save();
  return { pharmacy: publicPharmacy(pharmacy) };
});

route('PUT', '/pharmacy', (ctx) => {
  const { pharmacy } = requireManager(ctx);
  Object.assign(pharmacy, validatePharmacy(ctx.body));
  ctx.save();
  return { pharmacy: publicPharmacy(pharmacy) };
});

route('PUT', '/pharmacy/settings', (ctx) => {
  const { pharmacy } = requireManager(ctx);
  pharmacy.settings = validateSettings(ctx.body, pharmacy.settings);
  ctx.save();
  return { pharmacy: publicPharmacy(pharmacy) };
});

route('POST', '/pharmacy/setup', (ctx) => {
  const { pharmacy } = requireManager(ctx);
  const { step, done } = ctx.body;
  if (step !== undefined) {
    if (!SETUP_STEPS.some((item) => item.id === step)) fail(400, 'setup_step_invalid', 'Étape de configuration inconnue.');
    if (!pharmacy.setup.completed.includes(step)) pharmacy.setup.completed.push(step);
  }
  if (done === true) {
    pharmacy.setup.done = true;
    pharmacy.setup.completed = SETUP_STEPS.map((item) => item.id);
  }
  ctx.save();
  return { pharmacy: publicPharmacy(pharmacy) };
});

route('GET', '/needs', (ctx) => {
  const { pharmacy } = requireManager(ctx);
  return { needs: readNeeds(ctx.data, pharmacy) };
});

route('PUT', '/needs', (ctx) => {
  const { pharmacy } = requireManager(ctx);
  const { needs } = ctx.body;
  if (!Array.isArray(needs) || needs.length !== DAY_COUNT) fail(400, 'needs_invalid', 'Les besoins doivent couvrir les sept jours de la semaine.');
  const slotIds = new Set(pharmacy.settings.slots.map((slot) => slot.id));
  const activityIds = activeActivityIds(ctx.data, pharmacy.id);
  pharmacy.needs = needs.map((day) => {
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
  ctx.save();
  return { needs: readNeeds(ctx.data, pharmacy) };
});

route('POST', '/activities', (ctx) => {
  const { pharmacy } = requireManager(ctx);
  const name = text(ctx.body.name, 60);
  if (name.length < 2) fail(400, 'activity_name_invalid', 'Le nom du poste doit contenir au moins deux caractères.');
  const all = activitiesOf(ctx.data, pharmacy.id);
  const active = all.filter((activity) => !activity.archived);
  const sameName = all.find((activity) => activity.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'));
  if (sameName && !sameName.archived) fail(409, 'activity_exists', 'Un poste porte déjà ce nom.');
  if (active.length >= MAX_ACTIVITIES) fail(409, 'activity_limit', `Vous pouvez définir jusqu’à ${MAX_ACTIVITIES} postes.`);
  const order = all.reduce((max, activity) => Math.max(max, activity.order), -1) + 1;
  let activity = sameName;
  if (activity) {
    Object.assign(activity, { name, archived: false, order });
  } else {
    const usage = (color) => active.filter((item) => item.color === color).length;
    const color = [...ACTIVITY_COLORS].sort((left, right) => usage(left) - usage(right))[0];
    activity = { id: makeId('act'), pharmacyId: pharmacy.id, name, color, order, archived: false };
    ctx.data.activities.push(activity);
  }
  ctx.save();
  return { activity: publicActivity(activity) };
});

route('PUT', '/activities/:id', (ctx) => {
  const { pharmacy } = requireManager(ctx);
  const all = activitiesOf(ctx.data, pharmacy.id);
  const activity = all.find((item) => item.id === ctx.params.id) || fail(404, 'activity_not_found', 'Ce poste n’existe pas.');
  const name = text(ctx.body.name, 60);
  if (name.length < 2) fail(400, 'activity_name_invalid', 'Le nom du poste doit contenir au moins deux caractères.');
  if (all.some((item) => item.id !== activity.id && item.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'))) {
    fail(409, 'activity_exists', 'Un poste porte déjà ce nom.');
  }
  activity.name = name;
  ctx.save();
  return { activity: publicActivity(activity) };
});

route('DELETE', '/activities/:id', (ctx) => {
  const { pharmacy } = requireManager(ctx);
  const active = activitiesOf(ctx.data, pharmacy.id).filter((item) => !item.archived);
  const activity = active.find((item) => item.id === ctx.params.id) || fail(404, 'activity_not_found', 'Ce poste n’existe pas.');
  if (active.length <= 1) fail(409, 'activity_last', 'Gardez au moins un poste.');
  activity.archived = true;
  ctx.save();
  return { ok: true };
});

route('GET', '/team', (ctx) => {
  const { pharmacy } = requireManager(ctx);
  const members = employeesOf(ctx.data, pharmacy.id)
    .sort((left, right) => Number(Boolean(left.archived)) - Number(Boolean(right.archived)) || left.name.localeCompare(right.name, 'fr'))
    .map((employee) => publicMember(ctx, employee));
  return { members };
});

route('POST', '/team', (ctx) => {
  const { pharmacy } = requireManager(ctx);
  const employee = {
    id: makeId('emp'), pharmacyId: pharmacy.id, userId: null, ...validateMember(ctx.body, ctx.data, pharmacy.id), archived: false, createdAt: ctx.now,
  };
  ctx.data.employees.push(employee);
  ctx.save();
  return { member: publicMember(ctx, employee) };
});

route('PUT', '/team/:id', (ctx) => {
  const { pharmacy, membership } = requireManager(ctx);
  const employee = findEmployee(ctx.data, pharmacy.id, ctx.params.id);
  if (employee.archived) fail(409, 'member_archived', 'Cette personne a été retirée de l’équipe.');
  const target = ctx.data.memberships.find((item) => item.employeeId === employee.id);
  if (target?.role === 'owner' && membership.role !== 'owner') fail(403, 'owner_protected', 'Seul le titulaire peut modifier son propre profil.');
  Object.assign(employee, validateMember(ctx.body, ctx.data, pharmacy.id));
  ctx.save();
  return { member: publicMember(ctx, employee) };
});

route('DELETE', '/team/:id', (ctx) => {
  const { pharmacy, membership, user } = requireManager(ctx);
  const employee = findEmployee(ctx.data, pharmacy.id, ctx.params.id);
  const target = ctx.data.memberships.find((item) => item.employeeId === employee.id);
  if (target?.role === 'owner') fail(409, 'owner_protected', 'Le profil du titulaire ne peut pas être retiré de l’équipe.');
  if (target?.userId === user.id) fail(409, 'self_protected', 'Vous ne pouvez pas vous retirer vous-même de l’équipe.');
  if (target?.role === 'manager' && membership.role !== 'owner') fail(403, 'owner_required', 'Seul le titulaire peut retirer un gestionnaire.');
  removeAccess(ctx, employee);
  Object.assign(employee, { archived: true, schedulable: false });
  ctx.save();
  return { ok: true };
});

route('POST', '/team/:id/invitation', (ctx) => {
  const { pharmacy, membership, user } = requireManager(ctx);
  const employee = findEmployee(ctx.data, pharmacy.id, ctx.params.id);
  if (employee.archived) fail(409, 'member_archived', 'Cette personne a été retirée de l’équipe.');
  if (ctx.data.memberships.some((item) => item.employeeId === employee.id)) fail(409, 'member_linked', 'Cette personne a déjà accès à Planiflow.');
  const role = ctx.body.role === 'manager' ? 'manager' : 'employee';
  if (role === 'manager' && membership.role !== 'owner') fail(403, 'owner_required', 'Seul le titulaire peut inviter un gestionnaire.');
  removeAccess(ctx, employee);
  ctx.data.invitations.push({
    id: makeId('inv'),
    token: `${randomPart()}${randomPart()}`.slice(0, 40),
    pharmacyId: pharmacy.id,
    employeeId: employee.id,
    role,
    createdAt: ctx.now,
    createdBy: user.id,
    expiresAt: new Date(Date.parse(ctx.now) + INVITATION_DAYS * 86400000).toISOString(),
    acceptedAt: null,
    revokedAt: null,
  });
  ctx.save();
  return { member: publicMember(ctx, employee) };
});

route('DELETE', '/team/:id/access', (ctx) => {
  const { pharmacy, membership, user } = requireManager(ctx);
  const employee = findEmployee(ctx.data, pharmacy.id, ctx.params.id);
  const target = ctx.data.memberships.find((item) => item.employeeId === employee.id);
  if (target?.role === 'owner') fail(409, 'owner_protected', 'L’accès du titulaire ne peut pas être retiré.');
  if (target?.userId === user.id) fail(409, 'self_protected', 'Vous ne pouvez pas retirer votre propre accès.');
  if (target?.role === 'manager' && membership.role !== 'owner') fail(403, 'owner_required', 'Seul le titulaire peut retirer l’accès d’un gestionnaire.');
  removeAccess(ctx, employee);
  ctx.save();
  return { member: publicMember(ctx, employee) };
});

route('GET', '/invitations/:token', (ctx) => {
  const invitation = ctx.data.invitations.find((item) => item.token === ctx.params.token);
  const state = invitationState(ctx, invitation);
  if (state === 'unknown') return { state, message: INVITATION_MESSAGES.unknown };
  return {
    state,
    message: INVITATION_MESSAGES[state] || null,
    pharmacyName: ctx.data.pharmacies.find((item) => item.id === invitation.pharmacyId)?.name,
    employeeName: ctx.data.employees.find((item) => item.id === invitation.employeeId)?.name,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
  };
});

route('POST', '/invitations/:token/accept', (ctx) => {
  const user = requireUser(ctx);
  const invitation = ctx.data.invitations.find((item) => item.token === ctx.params.token);
  const state = invitationState(ctx, invitation);
  if (state !== 'valid') fail(410, 'invitation_unavailable', INVITATION_MESSAGES[state]);
  const current = membershipOf(ctx.data, user.id);
  if (current) {
    fail(409, 'account_linked', current.pharmacyId === invitation.pharmacyId
      ? 'Ce profil fait déjà partie de cette équipe.'
      : 'Ce profil est déjà rattaché à une autre officine. Utilisez un autre profil pour accepter l’invitation.');
  }
  const employee = ctx.data.employees.find((item) => item.id === invitation.employeeId);
  employee.userId = user.id;
  ctx.data.memberships.push({ id: makeId('mbr'), pharmacyId: invitation.pharmacyId, userId: user.id, employeeId: employee.id, role: invitation.role });
  Object.assign(invitation, { acceptedAt: ctx.now, acceptedBy: user.id });
  ctx.save();
  return { role: invitation.role, pharmacyName: ctx.data.pharmacies.find((item) => item.id === invitation.pharmacyId)?.name };
});

route('GET', '/requests', (ctx) => {
  const { pharmacy, membership } = requireMember(ctx);
  const manager = isManagerRole(membership.role);
  const requests = requestsOf(ctx.data, pharmacy.id)
    .filter((request) => manager || request.employeeId === membership.employeeId)
    .sort((left, right) => STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status)
      || left.startDate.localeCompare(right.startDate)
      || right.createdAt.localeCompare(left.createdAt));
  return { requests: requests.map((request) => publicRequest(ctx.data, request)) };
});

route('POST', '/requests', (ctx) => {
  const { pharmacy, membership, user } = requireMember(ctx);
  const manager = isManagerRole(membership.role);
  const employeeId = manager && ctx.body.employeeId ? ctx.body.employeeId : membership.employeeId;
  const employee = findEmployee(ctx.data, pharmacy.id, employeeId);
  if (employee.archived) fail(409, 'member_archived', 'Cette personne a été retirée de l’équipe.');
  const values = validateRequest(ctx.body, { allowPast: manager, today: ctx.today });
  const overlapping = ctx.data.requests.some((request) => request.employeeId === employee.id
    && ['pending', 'approved'].includes(request.status)
    && request.startDate <= values.endDate && values.startDate <= request.endDate
    && (request.period === 'full' || values.period === 'full' || request.period === values.period));
  if (overlapping) fail(409, 'request_overlap', 'Une demande en attente ou acceptée couvre déjà une partie de ces dates.');
  // Une absence saisie par le titulaire ou un gestionnaire est validée directement.
  const request = {
    id: makeId('req'),
    pharmacyId: pharmacy.id,
    employeeId: employee.id,
    ...values,
    status: manager ? 'approved' : 'pending',
    createdAt: ctx.now,
    createdBy: user.id,
    reviewedAt: manager ? ctx.now : null,
    reviewedBy: manager ? user.id : null,
    reviewNote: null,
  };
  ctx.data.requests.push(request);
  ctx.save();
  return { request: publicRequest(ctx.data, request) };
});

route('PATCH', '/requests/:id', (ctx) => {
  const { pharmacy, user } = requireManager(ctx);
  const request = requestsOf(ctx.data, pharmacy.id).find((item) => item.id === ctx.params.id) || fail(404, 'request_not_found', 'Cette demande n’existe pas.');
  if (request.status !== 'pending') fail(409, 'request_reviewed', 'Cette demande a déjà été traitée.');
  if (!['approved', 'refused'].includes(ctx.body.status)) fail(400, 'request_status_invalid', 'Choisissez d’accepter ou de refuser la demande.');
  Object.assign(request, { status: ctx.body.status, reviewNote: text(ctx.body.reviewNote, 500) || null, reviewedAt: ctx.now, reviewedBy: user.id });
  ctx.save();
  return { request: publicRequest(ctx.data, request) };
});

route('DELETE', '/requests/:id', (ctx) => {
  const { pharmacy, membership, user } = requireMember(ctx);
  const manager = isManagerRole(membership.role);
  const request = requestsOf(ctx.data, pharmacy.id)
    .find((item) => item.id === ctx.params.id && (manager || item.employeeId === membership.employeeId))
    || fail(404, 'request_not_found', 'Cette demande n’existe pas.');
  if (!['pending', 'approved'].includes(request.status)) fail(409, 'request_closed', 'Cette demande est déjà close.');
  if (!manager && request.status !== 'pending') fail(409, 'request_locked', 'Une demande acceptée ne peut être annulée que par le titulaire.');
  Object.assign(request, { status: 'cancelled', cancelledAt: ctx.now, cancelledBy: user.id });
  ctx.save();
  return { request: publicRequest(ctx.data, request) };
});

route('GET', '/plans/:week', (ctx) => {
  const { pharmacy } = requireManager(ctx);
  return planPayload(ctx, pharmacy, checkWeek(ctx.params.week));
});

route('POST', '/plans/:week/generate', (ctx) => {
  const { pharmacy, user } = requireManager(ctx);
  const weekStart = checkWeek(ctx.params.week);
  const layout = layoutOf(pharmacy);
  const schedule = generateSchedule({
    layout,
    needs: readNeeds(ctx.data, pharmacy),
    staff: employeesOf(ctx.data, pharmacy.id),
    activities: activitiesOf(ctx.data, pharmacy.id),
    absences: absencesForWeek(requestsOf(ctx.data, pharmacy.id), weekDates(weekStart)),
  });
  if (schedule.every((day) => !Object.keys(day).length)) {
    fail(409, 'needs_missing', 'Aucun besoin n’est défini sur les jours ouverts. Indiquez d’abord combien de personnes il faut sur chaque poste.');
  }
  addDraft(ctx, ensurePlan(ctx.data, pharmacy.id, weekStart), { schedule, layout, source: 'generated', user });
  ctx.save();
  return planPayload(ctx, pharmacy, weekStart);
});

route('PUT', '/plans/:week/draft', (ctx) => {
  const { pharmacy, user } = requireManager(ctx);
  const weekStart = checkWeek(ctx.params.week);
  const plan = planOf(ctx.data, pharmacy.id, weekStart);
  const draft = versionById(plan, plan?.draftId);
  const base = draft || versionById(plan, plan?.publishedId) || fail(409, 'plan_missing', 'Générez d’abord une proposition pour cette semaine.');
  const schedule = validateSchedule(
    ctx.body.schedule,
    base.layout,
    new Set(activitiesOf(ctx.data, pharmacy.id).map((activity) => activity.id)),
    new Set(employeesOf(ctx.data, pharmacy.id).map((employee) => employee.id)),
  );
  if (draft) Object.assign(draft, { schedule, updatedAt: ctx.now, edited: true });
  else addDraft(ctx, plan, { schedule, layout: structuredClone(base.layout), source: 'edited', user });
  ctx.save();
  return planPayload(ctx, pharmacy, weekStart);
});

route('DELETE', '/plans/:week/draft', (ctx) => {
  const { pharmacy } = requireManager(ctx);
  const weekStart = checkWeek(ctx.params.week);
  const plan = planOf(ctx.data, pharmacy.id, weekStart);
  const draft = versionById(plan, plan?.draftId) || fail(409, 'draft_missing', 'Il n’y a pas de brouillon en cours pour cette semaine.');
  Object.assign(draft, { status: 'archived', archivedAt: ctx.now });
  plan.draftId = null;
  ctx.save();
  return planPayload(ctx, pharmacy, weekStart);
});

route('POST', '/plans/:week/publish', (ctx) => {
  const { pharmacy, user } = requireManager(ctx);
  const weekStart = checkWeek(ctx.params.week);
  const plan = planOf(ctx.data, pharmacy.id, weekStart);
  const draft = versionById(plan, plan?.draftId);
  if (!draft || (ctx.body.versionId && ctx.body.versionId !== draft.id)) {
    fail(409, 'draft_changed', 'Le brouillon a changé entre-temps. Rechargez le planning avant de publier.');
  }
  const previous = versionById(plan, plan.publishedId);
  if (previous) Object.assign(previous, { status: 'archived', archivedAt: ctx.now });
  Object.assign(draft, { status: 'published', publishedAt: ctx.now, publishedBy: user.id });
  plan.publishedId = draft.id;
  plan.draftId = null;
  ctx.save();
  return planPayload(ctx, pharmacy, weekStart);
});

route('POST', '/plans/:week/repair', (ctx) => {
  const { pharmacy, user } = requireManager(ctx);
  const weekStart = checkWeek(ctx.params.week);
  const plan = planOf(ctx.data, pharmacy.id, weekStart);
  const draft = versionById(plan, plan?.draftId);
  const base = draft || versionById(plan, plan?.publishedId) || fail(409, 'plan_missing', 'Générez d’abord une proposition pour cette semaine.');
  const { schedule, removed, added } = repairSchedule(base.schedule, {
    layout: base.layout,
    staff: employeesOf(ctx.data, pharmacy.id),
    absences: absencesForWeek(requestsOf(ctx.data, pharmacy.id), weekDates(weekStart)),
  });
  if (removed || added) {
    if (draft) Object.assign(draft, { schedule, updatedAt: ctx.now, edited: true });
    else addDraft(ctx, plan, { schedule, layout: structuredClone(base.layout), source: 'repaired', user });
    ctx.save();
  }
  return { ...planPayload(ctx, pharmacy, weekStart), removed, added };
});

route('POST', '/plans/:week/restore', (ctx) => {
  const { pharmacy, user } = requireManager(ctx);
  const weekStart = checkWeek(ctx.params.week);
  const plan = planOf(ctx.data, pharmacy.id, weekStart);
  const version = versionById(plan, ctx.body.versionId) || fail(404, 'version_not_found', 'Cette version n’existe pas.');
  if (version.status !== 'archived') fail(409, 'version_current', 'Cette version est déjà la version en cours.');
  addDraft(ctx, plan, {
    schedule: structuredClone(version.schedule), layout: structuredClone(version.layout), source: 'restored', user, restoredFrom: version.number,
  });
  ctx.save();
  return planPayload(ctx, pharmacy, weekStart);
});

route('GET', '/my/schedule/:week', (ctx) => {
  const { pharmacy, membership } = requireMember(ctx);
  const weekStart = checkWeek(ctx.params.week);
  const dates = weekDates(weekStart);
  const plan = planOf(ctx.data, pharmacy.id, weekStart);
  const published = versionById(plan, plan?.publishedId);
  const absences = absencesForWeek(requestsOf(ctx.data, pharmacy.id).filter((request) => request.employeeId === membership.employeeId), dates);
  if (!published) return { weekStart, dates, published: null, layout: null, shifts: [], absences };
  const shifts = shiftsOf(published.schedule, published.layout, membership.employeeId).map(({ dayIndex, slot, activityId }) => ({
    dayIndex, slotId: slot.id, start: slot.start, end: slot.end, activityId,
  }));
  return {
    weekStart,
    dates,
    published: { number: published.number, publishedAt: published.publishedAt },
    layout: structuredClone(published.layout),
    shifts,
    absences,
  };
});

// ——— Point d'entrée ———

export function createLocalApi({
  dataStorage = globalThis.localStorage,
  sessionStorage = globalThis.sessionStorage,
  baseUrl = globalThis.location ? `${globalThis.location.origin}${globalThis.location.pathname}` : 'http://localhost/',
  now = () => new Date(),
} = {}) {
  function read() {
    try {
      const parsed = JSON.parse(dataStorage?.getItem(DATA_KEY) || 'null');
      if (parsed?.version === 2) return { ...emptyData(), ...parsed };
    } catch {
      // Données illisibles : la simulation repart d'un état vide.
    }
    return emptyData();
  }

  return async function request(method, path, body = {}) {
    const [pathname, search = ''] = path.split('?');
    const found = matchRoute(method.toUpperCase(), pathname.replace(/^\/api(?=\/)/, ''));
    if (!found) fail(404, 'not_found', `Action inconnue : ${method} ${pathname}`);
    const data = read();
    const date = now();
    let dirty = false;
    let wiped = false;
    const ctx = {
      data,
      body: body || {},
      params: found.params,
      query: new URLSearchParams(search),
      now: date.toISOString(),
      today: toISODate(date),
      baseUrl,
      save: () => { dirty = true; },
      reset: () => {
        wiped = true;
        [DATA_KEY, ...LEGACY_KEYS].forEach((key) => dataStorage?.removeItem(key));
        sessionStorage?.removeItem(SESSION_KEY);
      },
      session: {
        get: () => sessionStorage?.getItem(SESSION_KEY) || null,
        set: (id) => sessionStorage?.setItem(SESSION_KEY, id),
        clear: () => sessionStorage?.removeItem(SESSION_KEY),
      },
    };
    const result = found.handler(ctx);
    if (dirty && !wiped) dataStorage?.setItem(DATA_KEY, JSON.stringify(data));
    return structuredClone(result);
  };
}
