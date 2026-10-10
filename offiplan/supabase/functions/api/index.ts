// Fonction Edge unique : toutes les routes métier de Planiflow. Le navigateur ne lit ni n'écrit
// jamais les tables Postgres directement (RLS activée sans politique anon/authenticated, voir la
// migration) ; cette fonction utilise la clé de service (qui contourne la RLS) et revérifie
// elle-même l'identité et le rôle de la personne à chaque appel. Les règles de validation viennent
// de `src/domain/validation.js` ; le moteur de planning, de `src/domain/schedule.js` — le même
// module que celui utilisé par le frontend pour afficher et ajuster les plannings, sans rien dupliquer.

import { createClient } from '@supabase/supabase-js';
import { absencesForWeek, generateSchedule, repairSchedule, shiftsOf } from '../../../src/domain/schedule.js';
import { ACTIVITY_COLORS, DEFAULT_OPEN_DAYS, DEFAULT_SLOTS, MAX_ACTIVITIES, SETUP_STEPS, STARTER_ACTIVITIES } from '../../../src/domain/defaults.js';
import {
  ApiError, checkWeek, denseNeeds, fail, isManagerRole, makeId, randomPart, text, unique,
  validateMember, validateNeeds, validatePharmacy, validateRequest, validateSchedule, validateSettings,
} from '../../../src/domain/validation.js';
import { toISODate, weekDates } from '../../../src/lib/dates.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const INVITATION_DAYS = 14;
const STATUS_ORDER = ['pending', 'approved', 'refused', 'cancelled'];
const INVITATION_MESSAGES = {
  unknown: 'Ce lien d’invitation n’existe pas.',
  revoked: 'Ce lien d’invitation a été annulé. Demandez-en un nouveau au titulaire.',
  used: 'Ce lien d’invitation a déjà été utilisé.',
  expired: 'Ce lien d’invitation a expiré. Demandez-en un nouveau au titulaire.',
};

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } });
}

function dbFail(error) {
  if (error) fail(500, 'database_error', error.message);
}

// ——— Correspondance lignes Postgres ↔ objets utilisés par les règles métier partagées ———

const mapPharmacy = (row) => ({
  id: row.id,
  name: row.name,
  city: row.city,
  ownerUserId: row.owner_user_id,
  settings: { openDays: row.open_days, slots: row.slots },
  needs: row.needs,
  setup: { completed: row.setup_completed, done: row.setup_done },
});

const publicPharmacy = (row) => ({
  id: row.id, name: row.name, city: row.city, settings: { openDays: row.open_days, slots: row.slots },
  setup: { completed: row.setup_completed, done: row.setup_done },
});

const mapActivity = (row) => ({ id: row.id, name: row.name, color: row.color, order: row.sort_order, archived: row.archived });
const publicActivity = mapActivity;

const mapEmployee = (row) => ({
  id: row.id, pharmacyId: row.pharmacy_id, userId: row.user_id, name: row.name, roleTitle: row.role_title,
  weeklyHours: row.weekly_hours === null ? null : Number(row.weekly_hours), skills: row.skills || [],
  restDays: row.rest_days || [], schedulable: row.schedulable, archived: row.archived,
});

const publicMemberBase = (row) => ({
  id: row.id, name: row.name, roleTitle: row.role_title,
  weeklyHours: row.weekly_hours === null ? null : Number(row.weekly_hours), skills: row.skills || [],
  restDays: row.rest_days || [], schedulable: row.schedulable, archived: Boolean(row.archived),
});

const mapRequest = (row, employeeName) => ({
  id: row.id, employeeId: row.employee_id, type: row.type, startDate: row.start_date, endDate: row.end_date,
  period: row.period, note: row.note, status: row.status, createdAt: row.created_at,
  createdByName: row.profiles_created?.name || null, reviewedAt: row.reviewed_at,
  reviewedByName: row.profiles_reviewed?.name || null, reviewNote: row.review_note,
  employeeName: employeeName || 'Personne retirée',
});

function publicVersion(row, { withSchedule = true } = {}) {
  return {
    id: row.id, number: row.number, status: row.status, source: row.source, edited: Boolean(row.edited),
    restoredFrom: row.restored_from || null, createdAt: row.created_at, createdByName: row.profiles_created?.name || null,
    updatedAt: row.updated_at, publishedAt: row.published_at, publishedByName: row.profiles_published?.name || null,
    layout: row.layout, ...(withSchedule ? { schedule: row.schedule } : {}),
  };
}

// ——— Identité et accès ———

async function authenticate(req) {
  const header = req.headers.get('Authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profile } = await admin.from('profiles').select('name').eq('id', data.user.id).single();
  return { id: data.user.id, name: profile?.name || '' };
}

async function requireUser(req) {
  const user = await authenticate(req);
  if (!user) fail(401, 'authentication_required', 'Connectez-vous pour continuer.');
  return user;
}

async function requireMember(req) {
  const user = await requireUser(req);
  const { data: membership } = await admin.from('memberships').select('*').eq('user_id', user.id).maybeSingle();
  if (!membership) fail(403, 'pharmacy_required', 'Ce profil n’est rattaché à aucune officine.');
  const { data: pharmacyRow, error } = await admin.from('pharmacies').select('*').eq('id', membership.pharmacy_id).single();
  dbFail(error);
  return { user, membership, pharmacy: mapPharmacy(pharmacyRow), pharmacyRow };
}

async function requireManager(req) {
  const access = await requireMember(req);
  if (!isManagerRole(access.membership.role)) fail(403, 'manager_required', 'Cette action est réservée au titulaire et aux gestionnaires.');
  return access;
}

async function activitiesOf(pharmacyId) {
  const { data, error } = await admin.from('activities').select('*').eq('pharmacy_id', pharmacyId).order('sort_order');
  dbFail(error);
  return data;
}

async function activeActivityIds(pharmacyId) {
  const rows = await activitiesOf(pharmacyId);
  return new Set(rows.filter((row) => !row.archived).map((row) => row.id));
}

async function employeesOf(pharmacyId) {
  const { data, error } = await admin.from('employees').select('*').eq('pharmacy_id', pharmacyId);
  dbFail(error);
  return data;
}

async function findEmployeeRow(pharmacyId, id) {
  const { data } = await admin.from('employees').select('*').eq('pharmacy_id', pharmacyId).eq('id', id).maybeSingle();
  if (!data) fail(404, 'member_not_found', 'Cette personne ne fait pas partie de l’équipe.');
  return data;
}

async function requestsOf(pharmacyId) {
  const { data, error } = await admin.from('requests').select('*').eq('pharmacy_id', pharmacyId);
  dbFail(error);
  return data.map((row) => ({ id: row.id, employeeId: row.employee_id, status: row.status, startDate: row.start_date, endDate: row.end_date, period: row.period, type: row.type }));
}

function invitationUrl(req, token) {
  const origin = req.headers.get('origin') || Deno.env.get('SITE_URL') || SUPABASE_URL;
  return `${origin}/#/rejoindre/${token}`;
}

async function invitationState(invitation) {
  if (!invitation) return 'unknown';
  if (invitation.revoked_at) return 'revoked';
  if (invitation.accepted_at) return 'used';
  if (invitation.expires_at <= new Date().toISOString()) return 'expired';
  const { data: employee } = await admin.from('employees').select('archived').eq('id', invitation.employee_id).single();
  return !employee || employee.archived ? 'revoked' : 'valid';
}

async function accessOf(req, employee) {
  const { data: membership } = await admin.from('memberships').select('role').eq('employee_id', employee.id).maybeSingle();
  if (membership) return { status: membership.role === 'owner' ? 'owner' : 'linked', role: membership.role };
  const { data: invitation } = await admin.from('invitations').select('*')
    .eq('employee_id', employee.id).is('accepted_at', null).is('revoked_at', null)
    .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (invitation) return { status: 'invited', role: invitation.role, expiresAt: invitation.expires_at, url: invitationUrl(req, invitation.token) };
  return { status: 'none', role: null };
}

async function publicMember(req, row) {
  return { ...publicMemberBase(row), access: await accessOf(req, row) };
}

async function removeAccess(employeeId) {
  await admin.from('memberships').delete().eq('employee_id', employeeId);
  await admin.from('invitations').update({ revoked_at: new Date().toISOString() })
    .eq('employee_id', employeeId).is('accepted_at', null).is('revoked_at', null);
  await admin.from('employees').update({ user_id: null }).eq('id', employeeId);
}

// ——— Plannings ———

async function planRow(pharmacyId, weekStart) {
  const { data } = await admin.from('plans').select('*').eq('pharmacy_id', pharmacyId).eq('week_start', weekStart).maybeSingle();
  return data;
}

async function versionRow(id) {
  if (!id) return null;
  const { data } = await admin.from('plan_versions').select('*, profiles_created:created_by(name), profiles_published:published_by(name)').eq('id', id).maybeSingle();
  return data;
}

async function ensurePlanRow(pharmacyId, weekStart) {
  const existing = await planRow(pharmacyId, weekStart);
  if (existing) return existing;
  const { data, error } = await admin.from('plans').insert({ pharmacy_id: pharmacyId, week_start: weekStart }).select('*').single();
  dbFail(error);
  return data;
}

async function addDraft(plan, { schedule, layout, source, userId, restoredFrom = null }) {
  if (plan.draft_id) await admin.from('plan_versions').update({ status: 'archived', archived_at: new Date().toISOString() }).eq('id', plan.draft_id);
  const { count } = await admin.from('plan_versions').select('id', { count: 'exact', head: true }).eq('plan_id', plan.id);
  const { data: version, error } = await admin.from('plan_versions').insert({
    plan_id: plan.id, number: (count || 0) + 1, status: 'draft', source, edited: source === 'edited', restored_from: restoredFrom,
    schedule, layout, created_by: userId,
  }).select('*, profiles_created:created_by(name), profiles_published:published_by(name)').single();
  dbFail(error);
  await admin.from('plans').update({ draft_id: version.id }).eq('id', plan.id);
  return version;
}

async function planPayload(req, pharmacyRow, weekStart) {
  const pharmacy = mapPharmacy(pharmacyRow);
  const plan = await planRow(pharmacyRow.id, weekStart);
  const dates = weekDates(weekStart);
  const [draft, published, requests, activityIds] = await Promise.all([
    versionRow(plan?.draft_id), versionRow(plan?.published_id), requestsOf(pharmacyRow.id), activeActivityIds(pharmacyRow.id),
  ]);
  let history = [];
  if (plan) {
    const { data } = await admin.from('plan_versions').select('*, profiles_created:created_by(name), profiles_published:published_by(name)')
      .eq('plan_id', plan.id).order('number', { ascending: false });
    history = (data || []).map((row) => publicVersion(row, { withSchedule: false }));
  }
  return {
    weekStart,
    dates,
    layout: pharmacy.settings,
    needs: denseNeeds(pharmacy.needs, pharmacy.settings.slots, activityIds),
    draft: draft && publicVersion(draft),
    published: published && publicVersion(published),
    history,
    absences: absencesForWeek(requests, dates),
  };
}

// ——— Table des routes ———
// Même forme que l'ancienne API locale : `handler(ctx)` reçoit req/params/body et renvoie le
// corps de la réponse (ou lève une ApiError). L'authentification n'est pas vérifiée ici : chaque
// handler appelle lui-même `requireUser`/`requireMember`/`requireManager`, sauf la consultation
// d'une invitation par jeton, volontairement ouverte à qui connaît le lien.

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, segments: pattern.split('/').filter(Boolean), handler });

function matchRoute(method, path) {
  const segments = path.split('/').filter(Boolean);
  for (const candidate of routes) {
    if (candidate.method !== method || candidate.segments.length !== segments.length) continue;
    const params = {};
    const matched = candidate.segments.every((segment, index) => {
      if (segment.startsWith(':')) { params[segment.slice(1)] = decodeURIComponent(segments[index]); return true; }
      return segment === segments[index];
    });
    if (matched) return { ...candidate, params };
  }
  return null;
}

route('GET', '/workspace', async (ctx) => {
  const user = await requireUser(ctx.req);
  const { data: membership } = await admin.from('memberships').select('*').eq('user_id', user.id).maybeSingle();
  if (!membership) return { user, pharmacy: null, membership: null, activities: [], counts: { pendingRequests: 0 } };
  const [{ data: pharmacyRow }, { data: employeeRow }, activities] = await Promise.all([
    admin.from('pharmacies').select('*').eq('id', membership.pharmacy_id).single(),
    admin.from('employees').select('name').eq('id', membership.employee_id).single(),
    activitiesOf(membership.pharmacy_id),
  ]);
  let pendingRequests = 0;
  if (isManagerRole(membership.role)) {
    const { count } = await admin.from('requests').select('id', { count: 'exact', head: true }).eq('pharmacy_id', membership.pharmacy_id).eq('status', 'pending');
    pendingRequests = count || 0;
  }
  return {
    user,
    pharmacy: publicPharmacy(pharmacyRow),
    membership: { role: membership.role, employeeId: membership.employee_id, employeeName: employeeRow?.name || user.name },
    activities: activities.map(publicActivity),
    counts: { pendingRequests },
  };
});

route('POST', '/pharmacy', async (ctx) => {
  const user = await requireUser(ctx.req);
  const { data: existing } = await admin.from('memberships').select('id').eq('user_id', user.id).maybeSingle();
  if (existing) fail(409, 'membership_exists', 'Ce profil est déjà rattaché à une officine.');
  const values = validatePharmacy(ctx.body);
  const slots = DEFAULT_SLOTS.map((slot) => ({ id: makeId('slot'), ...slot }));
  const { data: pharmacyRow, error } = await admin.from('pharmacies').insert({
    name: values.name, city: values.city, owner_user_id: user.id, open_days: DEFAULT_OPEN_DAYS, slots, setup_completed: ['officine'],
  }).select('*').single();
  dbFail(error);
  const { data: activityRows, error: activitiesError } = await admin.from('activities').insert(
    STARTER_ACTIVITIES.map((name, index) => ({ pharmacy_id: pharmacyRow.id, name, color: ACTIVITY_COLORS[index % ACTIVITY_COLORS.length], sort_order: index })),
  ).select('*');
  dbFail(activitiesError);
  const { data: employeeRow, error: employeeError } = await admin.from('employees').insert({
    pharmacy_id: pharmacyRow.id, user_id: user.id, name: user.name, role_title: 'Pharmacien·ne titulaire',
    skills: activityRows.map((row) => row.id),
  }).select('*').single();
  dbFail(employeeError);
  const { error: membershipError } = await admin.from('memberships').insert({ pharmacy_id: pharmacyRow.id, user_id: user.id, employee_id: employeeRow.id, role: 'owner' });
  dbFail(membershipError);
  return { pharmacy: publicPharmacy(pharmacyRow) };
});

route('PUT', '/pharmacy', async (ctx) => {
  const { pharmacyRow } = await requireManager(ctx.req);
  const values = validatePharmacy(ctx.body);
  const { data, error } = await admin.from('pharmacies').update(values).eq('id', pharmacyRow.id).select('*').single();
  dbFail(error);
  return { pharmacy: publicPharmacy(data) };
});

route('PUT', '/pharmacy/settings', async (ctx) => {
  const { pharmacy, pharmacyRow } = await requireManager(ctx.req);
  const settings = validateSettings(ctx.body, pharmacy.settings);
  const { data, error } = await admin.from('pharmacies').update({ open_days: settings.openDays, slots: settings.slots }).eq('id', pharmacyRow.id).select('*').single();
  dbFail(error);
  return { pharmacy: publicPharmacy(data) };
});

route('POST', '/pharmacy/setup', async (ctx) => {
  const { pharmacy, pharmacyRow } = await requireManager(ctx.req);
  const { step, done } = ctx.body;
  const patch = {};
  if (step !== undefined) {
    if (!SETUP_STEPS.some((item) => item.id === step)) fail(400, 'setup_step_invalid', 'Étape de configuration inconnue.');
    patch.setup_completed = pharmacy.setup.completed.includes(step) ? pharmacy.setup.completed : [...pharmacy.setup.completed, step];
  }
  if (done === true) {
    patch.setup_done = true;
    patch.setup_completed = SETUP_STEPS.map((item) => item.id);
  }
  const { data, error } = await admin.from('pharmacies').update(patch).eq('id', pharmacyRow.id).select('*').single();
  dbFail(error);
  return { pharmacy: publicPharmacy(data) };
});

route('GET', '/needs', async (ctx) => {
  const { pharmacy } = await requireManager(ctx.req);
  return { needs: denseNeeds(pharmacy.needs, pharmacy.settings.slots, await activeActivityIds(pharmacy.id)) };
});

route('PUT', '/needs', async (ctx) => {
  const { pharmacy, pharmacyRow } = await requireManager(ctx.req);
  const slotIds = new Set(pharmacy.settings.slots.map((slot) => slot.id));
  const activityIds = await activeActivityIds(pharmacy.id);
  const needs = validateNeeds(ctx.body, slotIds, activityIds);
  const { error } = await admin.from('pharmacies').update({ needs }).eq('id', pharmacyRow.id);
  dbFail(error);
  return { needs: denseNeeds(needs, pharmacy.settings.slots, activityIds) };
});

route('POST', '/activities', async (ctx) => {
  const { pharmacy } = await requireManager(ctx.req);
  const name = text(ctx.body.name, 60);
  if (name.length < 2) fail(400, 'activity_name_invalid', 'Le nom du poste doit contenir au moins deux caractères.');
  const all = await activitiesOf(pharmacy.id);
  const active = all.filter((row) => !row.archived);
  const sameName = all.find((row) => row.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'));
  if (sameName && !sameName.archived) fail(409, 'activity_exists', 'Un poste porte déjà ce nom.');
  if (active.length >= MAX_ACTIVITIES) fail(409, 'activity_limit', `Vous pouvez définir jusqu’à ${MAX_ACTIVITIES} postes.`);
  const order = all.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1;
  let row;
  if (sameName) {
    const { data, error } = await admin.from('activities').update({ name, archived: false, sort_order: order }).eq('id', sameName.id).select('*').single();
    dbFail(error);
    row = data;
  } else {
    const usage = (color) => active.filter((item) => item.color === color).length;
    const color = [...ACTIVITY_COLORS].sort((left, right) => usage(left) - usage(right))[0];
    const { data, error } = await admin.from('activities').insert({ pharmacy_id: pharmacy.id, name, color, sort_order: order }).select('*').single();
    dbFail(error);
    row = data;
  }
  return { activity: publicActivity(row) };
});

route('PUT', '/activities/:id', async (ctx) => {
  const { pharmacy } = await requireManager(ctx.req);
  const all = await activitiesOf(pharmacy.id);
  const activity = all.find((row) => row.id === ctx.params.id) || fail(404, 'activity_not_found', 'Ce poste n’existe pas.');
  const name = text(ctx.body.name, 60);
  if (name.length < 2) fail(400, 'activity_name_invalid', 'Le nom du poste doit contenir au moins deux caractères.');
  if (all.some((row) => row.id !== activity.id && row.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'))) {
    fail(409, 'activity_exists', 'Un poste porte déjà ce nom.');
  }
  const { data, error } = await admin.from('activities').update({ name }).eq('id', activity.id).select('*').single();
  dbFail(error);
  return { activity: publicActivity(data) };
});

route('DELETE', '/activities/:id', async (ctx) => {
  const { pharmacy } = await requireManager(ctx.req);
  const active = (await activitiesOf(pharmacy.id)).filter((row) => !row.archived);
  const activity = active.find((row) => row.id === ctx.params.id) || fail(404, 'activity_not_found', 'Ce poste n’existe pas.');
  if (active.length <= 1) fail(409, 'activity_last', 'Gardez au moins un poste.');
  const { error } = await admin.from('activities').update({ archived: true }).eq('id', activity.id);
  dbFail(error);
  return { ok: true };
});

route('GET', '/team', async (ctx) => {
  const { pharmacy } = await requireManager(ctx.req);
  const rows = (await employeesOf(pharmacy.id))
    .sort((left, right) => Number(Boolean(left.archived)) - Number(Boolean(right.archived)) || left.name.localeCompare(right.name, 'fr'));
  const members = await Promise.all(rows.map((row) => publicMember(ctx.req, row)));
  return { members };
});

route('POST', '/team', async (ctx) => {
  const { pharmacy } = await requireManager(ctx.req);
  const values = validateMember(ctx.body, await activeActivityIds(pharmacy.id));
  const { data, error } = await admin.from('employees').insert({
    pharmacy_id: pharmacy.id, name: values.name, role_title: values.roleTitle, weekly_hours: values.weeklyHours,
    skills: values.skills, rest_days: values.restDays, schedulable: values.schedulable,
  }).select('*').single();
  dbFail(error);
  return { member: await publicMember(ctx.req, data) };
});

route('PUT', '/team/:id', async (ctx) => {
  const { pharmacy, membership } = await requireManager(ctx.req);
  const employee = await findEmployeeRow(pharmacy.id, ctx.params.id);
  if (employee.archived) fail(409, 'member_archived', 'Cette personne a été retirée de l’équipe.');
  const { data: target } = await admin.from('memberships').select('role').eq('employee_id', employee.id).maybeSingle();
  if (target?.role === 'owner' && membership.role !== 'owner') fail(403, 'owner_protected', 'Seul le titulaire peut modifier son propre profil.');
  const values = validateMember(ctx.body, await activeActivityIds(pharmacy.id));
  const { data, error } = await admin.from('employees').update({
    name: values.name, role_title: values.roleTitle, weekly_hours: values.weeklyHours,
    skills: values.skills, rest_days: values.restDays, schedulable: values.schedulable,
  }).eq('id', employee.id).select('*').single();
  dbFail(error);
  return { member: await publicMember(ctx.req, data) };
});

route('DELETE', '/team/:id', async (ctx) => {
  const { pharmacy, membership, user } = await requireManager(ctx.req);
  const employee = await findEmployeeRow(pharmacy.id, ctx.params.id);
  const { data: target } = await admin.from('memberships').select('role, user_id').eq('employee_id', employee.id).maybeSingle();
  if (target?.role === 'owner') fail(409, 'owner_protected', 'Le profil du titulaire ne peut pas être retiré de l’équipe.');
  if (target?.user_id === user.id) fail(409, 'self_protected', 'Vous ne pouvez pas vous retirer vous-même de l’équipe.');
  if (target?.role === 'manager' && membership.role !== 'owner') fail(403, 'owner_required', 'Seul le titulaire peut retirer un gestionnaire.');
  await removeAccess(employee.id);
  const { error } = await admin.from('employees').update({ archived: true, schedulable: false }).eq('id', employee.id);
  dbFail(error);
  return { ok: true };
});

route('POST', '/team/:id/invitation', async (ctx) => {
  const { pharmacy, membership, user } = await requireManager(ctx.req);
  const employee = await findEmployeeRow(pharmacy.id, ctx.params.id);
  if (employee.archived) fail(409, 'member_archived', 'Cette personne a été retirée de l’équipe.');
  const { data: existingMembership } = await admin.from('memberships').select('id').eq('employee_id', employee.id).maybeSingle();
  if (existingMembership) fail(409, 'member_linked', 'Cette personne a déjà accès à Planiflow.');
  const role = ctx.body.role === 'manager' ? 'manager' : 'employee';
  if (role === 'manager' && membership.role !== 'owner') fail(403, 'owner_required', 'Seul le titulaire peut inviter un gestionnaire.');
  await removeAccess(employee.id);
  const { error } = await admin.from('invitations').insert({
    pharmacy_id: pharmacy.id, employee_id: employee.id, token: `${randomPart()}${randomPart()}`.slice(0, 40), role,
    created_by: user.id, expires_at: new Date(Date.now() + INVITATION_DAYS * 86400000).toISOString(),
  });
  dbFail(error);
  const { data: updated } = await admin.from('employees').select('*').eq('id', employee.id).single();
  return { member: await publicMember(ctx.req, updated) };
});

route('DELETE', '/team/:id/access', async (ctx) => {
  const { pharmacy, membership, user } = await requireManager(ctx.req);
  const employee = await findEmployeeRow(pharmacy.id, ctx.params.id);
  const { data: target } = await admin.from('memberships').select('role, user_id').eq('employee_id', employee.id).maybeSingle();
  if (target?.role === 'owner') fail(409, 'owner_protected', 'L’accès du titulaire ne peut pas être retiré.');
  if (target?.user_id === user.id) fail(409, 'self_protected', 'Vous ne pouvez pas retirer votre propre accès.');
  if (target?.role === 'manager' && membership.role !== 'owner') fail(403, 'owner_required', 'Seul le titulaire peut retirer l’accès d’un gestionnaire.');
  await removeAccess(employee.id);
  const { data: updated } = await admin.from('employees').select('*').eq('id', employee.id).single();
  return { member: await publicMember(ctx.req, updated) };
});

route('GET', '/invitations/:token', async (ctx) => {
  const { data: invitation } = await admin.from('invitations').select('*').eq('token', ctx.params.token).maybeSingle();
  const state = await invitationState(invitation);
  if (state === 'unknown') return { state, message: INVITATION_MESSAGES.unknown };
  const [{ data: pharmacyRow }, { data: employeeRow }] = await Promise.all([
    admin.from('pharmacies').select('name').eq('id', invitation.pharmacy_id).single(),
    admin.from('employees').select('name').eq('id', invitation.employee_id).single(),
  ]);
  return {
    state, message: INVITATION_MESSAGES[state] || null, pharmacyName: pharmacyRow?.name,
    employeeName: employeeRow?.name, role: invitation.role, expiresAt: invitation.expires_at,
  };
});

route('POST', '/invitations/:token/accept', async (ctx) => {
  const user = await requireUser(ctx.req);
  const { data: invitation } = await admin.from('invitations').select('*').eq('token', ctx.params.token).maybeSingle();
  const state = await invitationState(invitation);
  if (state !== 'valid') fail(410, 'invitation_unavailable', INVITATION_MESSAGES[state]);
  const { data: current } = await admin.from('memberships').select('pharmacy_id').eq('user_id', user.id).maybeSingle();
  if (current) {
    fail(409, 'account_linked', current.pharmacy_id === invitation.pharmacy_id
      ? 'Ce profil fait déjà partie de cette équipe.'
      : 'Ce profil est déjà rattaché à une autre officine. Utilisez un autre profil pour accepter l’invitation.');
  }
  const { error: employeeError } = await admin.from('employees').update({ user_id: user.id }).eq('id', invitation.employee_id);
  dbFail(employeeError);
  const { error: membershipError } = await admin.from('memberships').insert({
    pharmacy_id: invitation.pharmacy_id, user_id: user.id, employee_id: invitation.employee_id, role: invitation.role,
  });
  dbFail(membershipError);
  await admin.from('invitations').update({ accepted_at: new Date().toISOString(), accepted_by: user.id }).eq('id', invitation.id);
  const { data: pharmacyRow } = await admin.from('pharmacies').select('name').eq('id', invitation.pharmacy_id).single();
  return { role: invitation.role, pharmacyName: pharmacyRow?.name };
});

route('GET', '/requests', async (ctx) => {
  const { pharmacy, membership } = await requireMember(ctx.req);
  const manager = isManagerRole(membership.role);
  let query = admin.from('requests').select('*, profiles_created:created_by(name), profiles_reviewed:reviewed_by(name)').eq('pharmacy_id', pharmacy.id);
  if (!manager) query = query.eq('employee_id', membership.employee_id);
  const { data, error } = await query;
  dbFail(error);
  const employeeIds = unique(data.map((row) => row.employee_id));
  const { data: employeeRows } = employeeIds.length
    ? await admin.from('employees').select('id, name').in('id', employeeIds)
    : { data: [] };
  const names = new Map((employeeRows || []).map((row) => [row.id, row.name]));
  const sorted = [...data].sort((left, right) => STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status)
    || left.start_date.localeCompare(right.start_date) || right.created_at.localeCompare(left.created_at));
  return { requests: sorted.map((row) => mapRequest(row, names.get(row.employee_id))) };
});

route('POST', '/requests', async (ctx) => {
  const { pharmacy, membership, user } = await requireMember(ctx.req);
  const manager = isManagerRole(membership.role);
  const employeeId = manager && ctx.body.employeeId ? ctx.body.employeeId : membership.employee_id;
  const employee = await findEmployeeRow(pharmacy.id, employeeId);
  if (employee.archived) fail(409, 'member_archived', 'Cette personne a été retirée de l’équipe.');
  const today = toISODate(new Date());
  const values = validateRequest(ctx.body, { allowPast: manager, today });
  const { data: existing } = await admin.from('requests').select('*').eq('employee_id', employee.id).in('status', ['pending', 'approved']);
  const overlapping = (existing || []).some((row) => row.start_date <= values.endDate && values.startDate <= row.end_date
    && (row.period === 'full' || values.period === 'full' || row.period === values.period));
  if (overlapping) fail(409, 'request_overlap', 'Une demande en attente ou acceptée couvre déjà une partie de ces dates.');
  const { data, error } = await admin.from('requests').insert({
    pharmacy_id: pharmacy.id, employee_id: employee.id, type: values.type, start_date: values.startDate, end_date: values.endDate,
    period: values.period, note: values.note, status: manager ? 'approved' : 'pending', created_by: user.id,
    reviewed_at: manager ? new Date().toISOString() : null, reviewed_by: manager ? user.id : null,
  }).select('*, profiles_created:created_by(name), profiles_reviewed:reviewed_by(name)').single();
  dbFail(error);
  return { request: mapRequest(data, employee.name) };
});

route('PATCH', '/requests/:id', async (ctx) => {
  const { pharmacy, user } = await requireManager(ctx.req);
  const { data: request } = await admin.from('requests').select('*').eq('pharmacy_id', pharmacy.id).eq('id', ctx.params.id).maybeSingle();
  if (!request) fail(404, 'request_not_found', 'Cette demande n’existe pas.');
  if (request.status !== 'pending') fail(409, 'request_reviewed', 'Cette demande a déjà été traitée.');
  if (!['approved', 'refused'].includes(ctx.body.status)) fail(400, 'request_status_invalid', 'Choisissez d’accepter ou de refuser la demande.');
  const { data, error } = await admin.from('requests').update({
    status: ctx.body.status, review_note: text(ctx.body.reviewNote, 500) || null, reviewed_at: new Date().toISOString(), reviewed_by: user.id,
  }).eq('id', request.id).select('*, profiles_created:created_by(name), profiles_reviewed:reviewed_by(name)').single();
  dbFail(error);
  const { data: employee } = await admin.from('employees').select('name').eq('id', data.employee_id).maybeSingle();
  return { request: mapRequest(data, employee?.name) };
});

route('DELETE', '/requests/:id', async (ctx) => {
  const { pharmacy, membership, user } = await requireMember(ctx.req);
  const manager = isManagerRole(membership.role);
  let query = admin.from('requests').select('*').eq('pharmacy_id', pharmacy.id).eq('id', ctx.params.id);
  if (!manager) query = query.eq('employee_id', membership.employee_id);
  const { data: request } = await query.maybeSingle();
  if (!request) fail(404, 'request_not_found', 'Cette demande n’existe pas.');
  if (!['pending', 'approved'].includes(request.status)) fail(409, 'request_closed', 'Cette demande est déjà close.');
  if (!manager && request.status !== 'pending') fail(409, 'request_locked', 'Une demande acceptée ne peut être annulée que par le titulaire.');
  const { data, error } = await admin.from('requests').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: user.id })
    .eq('id', request.id).select('*, profiles_created:created_by(name), profiles_reviewed:reviewed_by(name)').single();
  dbFail(error);
  const { data: employee } = await admin.from('employees').select('name').eq('id', data.employee_id).maybeSingle();
  return { request: mapRequest(data, employee?.name) };
});

route('GET', '/plans/:week', async (ctx) => {
  const { pharmacyRow } = await requireManager(ctx.req);
  return planPayload(ctx.req, pharmacyRow, checkWeek(ctx.params.week));
});

route('POST', '/plans/:week/generate', async (ctx) => {
  const { pharmacy, pharmacyRow, user } = await requireManager(ctx.req);
  const weekStart = checkWeek(ctx.params.week);
  const layout = pharmacy.settings;
  const [activities, staff, requests, activityIds] = await Promise.all([
    activitiesOf(pharmacy.id), employeesOf(pharmacy.id), requestsOf(pharmacy.id), activeActivityIds(pharmacy.id),
  ]);
  const schedule = generateSchedule({
    layout, needs: denseNeeds(pharmacy.needs, layout.slots, activityIds), staff: staff.map(mapEmployee),
    activities: activities.map(mapActivity), absences: absencesForWeek(requests, weekDates(weekStart)),
  });
  if (schedule.every((day) => !Object.keys(day).length)) {
    fail(409, 'needs_missing', 'Aucun besoin n’est défini sur les jours ouverts. Indiquez d’abord combien de personnes il faut sur chaque poste.');
  }
  const plan = await ensurePlanRow(pharmacy.id, weekStart);
  await addDraft(plan, { schedule, layout, source: 'generated', userId: user.id });
  return planPayload(ctx.req, pharmacyRow, weekStart);
});

route('PUT', '/plans/:week/draft', async (ctx) => {
  const { pharmacy, pharmacyRow, user } = await requireManager(ctx.req);
  const weekStart = checkWeek(ctx.params.week);
  const plan = await planRow(pharmacy.id, weekStart);
  const draft = await versionRow(plan?.draft_id);
  const base = draft || await versionRow(plan?.published_id) || fail(409, 'plan_missing', 'Générez d’abord une proposition pour cette semaine.');
  const [activities, staff] = await Promise.all([activitiesOf(pharmacy.id), employeesOf(pharmacy.id)]);
  const schedule = validateSchedule(ctx.body.schedule, base.layout, new Set(activities.map((row) => row.id)), new Set(staff.map((row) => row.id)));
  if (draft) {
    await admin.from('plan_versions').update({ schedule, updated_at: new Date().toISOString(), edited: true }).eq('id', draft.id);
  } else {
    await addDraft(plan, { schedule, layout: base.layout, source: 'edited', userId: user.id });
  }
  return planPayload(ctx.req, pharmacyRow, weekStart);
});

route('DELETE', '/plans/:week/draft', async (ctx) => {
  const { pharmacy, pharmacyRow } = await requireManager(ctx.req);
  const weekStart = checkWeek(ctx.params.week);
  const plan = await planRow(pharmacy.id, weekStart);
  const draft = await versionRow(plan?.draft_id) || fail(409, 'draft_missing', 'Il n’y a pas de brouillon en cours pour cette semaine.');
  await admin.from('plan_versions').update({ status: 'archived', archived_at: new Date().toISOString() }).eq('id', draft.id);
  await admin.from('plans').update({ draft_id: null }).eq('id', plan.id);
  return planPayload(ctx.req, pharmacyRow, weekStart);
});

route('POST', '/plans/:week/publish', async (ctx) => {
  const { pharmacy, pharmacyRow, user } = await requireManager(ctx.req);
  const weekStart = checkWeek(ctx.params.week);
  const plan = await planRow(pharmacy.id, weekStart);
  const draft = await versionRow(plan?.draft_id);
  if (!draft || (ctx.body.versionId && ctx.body.versionId !== draft.id)) {
    fail(409, 'draft_changed', 'Le brouillon a changé entre-temps. Rechargez le planning avant de publier.');
  }
  if (plan.published_id) await admin.from('plan_versions').update({ status: 'archived', archived_at: new Date().toISOString() }).eq('id', plan.published_id);
  await admin.from('plan_versions').update({ status: 'published', published_at: new Date().toISOString(), published_by: user.id }).eq('id', draft.id);
  await admin.from('plans').update({ published_id: draft.id, draft_id: null }).eq('id', plan.id);
  return planPayload(ctx.req, pharmacyRow, weekStart);
});

route('POST', '/plans/:week/repair', async (ctx) => {
  const { pharmacy, pharmacyRow, user } = await requireManager(ctx.req);
  const weekStart = checkWeek(ctx.params.week);
  const plan = await planRow(pharmacy.id, weekStart);
  const draft = await versionRow(plan?.draft_id);
  const base = draft || await versionRow(plan?.published_id) || fail(409, 'plan_missing', 'Générez d’abord une proposition pour cette semaine.');
  const [staff, requests] = await Promise.all([employeesOf(pharmacy.id), requestsOf(pharmacy.id)]);
  const { schedule, removed, added } = repairSchedule(base.schedule, {
    layout: base.layout, staff: staff.map(mapEmployee), absences: absencesForWeek(requests, weekDates(weekStart)),
  });
  if (removed || added) {
    if (draft) await admin.from('plan_versions').update({ schedule, updated_at: new Date().toISOString(), edited: true }).eq('id', draft.id);
    else await addDraft(plan, { schedule, layout: base.layout, source: 'repaired', userId: user.id });
  }
  return { ...(await planPayload(ctx.req, pharmacyRow, weekStart)), removed, added };
});

route('POST', '/plans/:week/restore', async (ctx) => {
  const { pharmacy, pharmacyRow, user } = await requireManager(ctx.req);
  const weekStart = checkWeek(ctx.params.week);
  const plan = await planRow(pharmacy.id, weekStart);
  const version = await versionRow(ctx.body.versionId);
  if (!version || version.plan_id !== plan?.id) fail(404, 'version_not_found', 'Cette version n’existe pas.');
  if (version.status !== 'archived') fail(409, 'version_current', 'Cette version est déjà la version en cours.');
  await addDraft(plan, { schedule: version.schedule, layout: version.layout, source: 'restored', userId: user.id, restoredFrom: version.number });
  return planPayload(ctx.req, pharmacyRow, weekStart);
});

route('GET', '/my/schedule/:week', async (ctx) => {
  const { pharmacy, pharmacyRow, membership } = await requireMember(ctx.req);
  const weekStart = checkWeek(ctx.params.week);
  const dates = weekDates(weekStart);
  const plan = await planRow(pharmacy.id, weekStart);
  const published = await versionRow(plan?.published_id);
  const requests = (await requestsOf(pharmacy.id)).filter((row) => row.employeeId === membership.employee_id);
  const absences = absencesForWeek(requests, dates);
  if (!published) return { weekStart, dates, published: null, layout: null, shifts: [], absences };
  const shifts = shiftsOf(published.schedule, published.layout, membership.employee_id).map(({ dayIndex, slot, activityId }) => ({
    dayIndex, slotId: slot.id, start: slot.start, end: slot.end, activityId,
  }));
  return { weekStart, dates, published: { number: published.number, publishedAt: published.published_at }, layout: published.layout, shifts, absences };
});

// ——— Point d'entrée ———

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin) });
  const url = new URL(req.url);
  const pathname = url.pathname.replace(/^\/(functions\/v1\/)?api(?=\/|$)/, '') || '/';
  const found = matchRoute(req.method, pathname);
  if (!found) return json({ code: 'not_found', message: `Action inconnue : ${req.method} ${pathname}` }, 404, origin);
  try {
    const body = ['GET', 'DELETE'].includes(req.method) ? {} : await req.json().catch(() => ({}));
    const result = await found.handler({ req, params: found.params, body: body || {} });
    return json(result, 200, origin);
  } catch (error) {
    if (error instanceof ApiError) return json({ code: error.code, message: error.message }, error.status, origin);
    console.error(error);
    return json({ code: 'internal_error', message: 'Une erreur inattendue est survenue.' }, 500, origin);
  }
});
