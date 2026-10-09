-- OffiPlan — schéma initial.
--
-- Principe de sécurité : l'accès aux données ne passe jamais par des requêtes directes du
-- navigateur aux tables. La RLS est activée partout et ne reçoit aucune politique pour les
-- rôles « anon » et « authenticated » : par défaut, Postgres refuse tout. Seule la fonction Edge
-- `api` (clé de service, qui contourne la RLS) lit et écrit ces tables ; elle revérifie elle-même
-- l'identité et le rôle de la personne à chaque appel, exactement comme le faisait l'ancienne
-- API locale (`src/services/localApi.js`). Deux exceptions volontaires et limitées existent plus
-- bas (lecture d'une invitation par jeton, lecture de son propre profil) — chacune est commentée.
--
-- L'authentification (mots de passe, jetons de session) est entièrement gérée par Supabase Auth
-- (schéma `auth`, hors de ce fichier) ; `public.profiles` ne garde qu'un nom affichable. Les
-- colonnes « qui a fait quoi » référencent profiles plutôt que auth.users : PostgREST peut alors
-- joindre directement le nom (ex. `plan_versions.select('*, profiles!created_by(name)')`) sans
-- requête séparée pour chaque ligne.

create extension if not exists pgcrypto;

create type public.membership_role as enum ('owner', 'manager', 'employee');
create type public.request_type as enum ('leave', 'unavailability', 'training');
create type public.request_period as enum ('full', 'morning', 'afternoon');
create type public.request_status as enum ('pending', 'approved', 'refused', 'cancelled');
create type public.plan_version_status as enum ('draft', 'published', 'archived');
create type public.plan_version_source as enum ('generated', 'edited', 'repaired', 'restored');

-- ——— Profils ———
-- Un profil par compte Supabase Auth ; créé automatiquement à l'inscription (voir le
-- déclencheur plus bas). Sert à afficher un nom (« créé par… », « publié par… ») sans exposer
-- l'adresse courriel des autres personnes, qui reste dans le schéma `auth`.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

-- ——— Officines ———

create table public.pharmacies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  owner_user_id uuid not null references public.profiles (id),
  open_days boolean[] not null default array[true, true, true, true, true, true, false],
  slots jsonb not null default '[]'::jsonb,
  needs jsonb not null default '[{}, {}, {}, {}, {}, {}, {}]'::jsonb,
  setup_completed text[] not null default '{}',
  setup_done boolean not null default false,
  created_at timestamptz not null default now(),
  constraint open_days_has_seven_days check (array_length(open_days, 1) = 7),
  constraint needs_has_seven_days check (jsonb_array_length(needs) = 7)
);

-- ——— Postes (« activités ») ———

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies (id) on delete cascade,
  name text not null,
  color text not null,
  sort_order int not null default 0,
  archived boolean not null default false
);

-- Un nom de poste ne peut être réutilisé dans la même officine, quelle que soit la casse —
-- l'API réactive un poste archivé du même nom plutôt que d'en recréer un.
create unique index activities_pharmacy_name_key on public.activities (pharmacy_id, lower(name));

-- ——— Équipe ———

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies (id) on delete cascade,
  user_id uuid references public.profiles (id),
  name text not null,
  role_title text not null,
  weekly_hours numeric(5, 1) check (weekly_hours is null or (weekly_hours >= 0 and weekly_hours <= 60)),
  skills uuid[] not null default '{}',
  rest_days smallint[] not null default '{}',
  schedulable boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create index employees_pharmacy_id_idx on public.employees (pharmacy_id);

-- ——— Accès à OffiPlan ———
-- Chaque compte n'appartient qu'à une seule officine à la fois (contrainte unique sur
-- user_id) ; chaque fiche d'équipe n'est reliée qu'à un seul compte (contrainte sur employee_id).

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  role public.membership_role not null,
  created_at timestamptz not null default now(),
  unique (user_id),
  unique (employee_id)
);

create index memberships_pharmacy_id_idx on public.memberships (pharmacy_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  token text not null unique,
  role public.membership_role not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id),
  revoked_at timestamptz
);

create index invitations_pharmacy_id_idx on public.invitations (pharmacy_id);
create index invitations_employee_id_idx on public.invitations (employee_id);

-- ——— Demandes d'absence ———

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  type public.request_type not null,
  start_date date not null,
  end_date date not null,
  period public.request_period not null,
  note text,
  status public.request_status not null default 'pending',
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id),
  review_note text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  constraint request_dates_order check (end_date >= start_date)
);

create index requests_pharmacy_id_idx on public.requests (pharmacy_id);
create index requests_employee_id_idx on public.requests (employee_id);

-- ——— Plannings ———
-- Un plan par officine et par semaine ; chaque modification crée une nouvelle version
-- (brouillon), jamais de modification en place. `draft_id`/`published_id` pointent vers la
-- version courante de chaque statut ; l'historique complet reste dans plan_versions.

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies (id) on delete cascade,
  week_start date not null,
  draft_id uuid,
  published_id uuid,
  unique (pharmacy_id, week_start)
);

create table public.plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  number int not null,
  status public.plan_version_status not null,
  source public.plan_version_source not null,
  edited boolean not null default false,
  restored_from int,
  schedule jsonb not null,
  layout jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid references public.profiles (id),
  archived_at timestamptz,
  unique (plan_id, number)
);

create index plan_versions_plan_id_idx on public.plan_versions (plan_id);

-- Ajoutées après coup : plans et plan_versions se référencent mutuellement.
alter table public.plans
  add constraint plans_draft_id_fkey foreign key (draft_id) references public.plan_versions (id),
  add constraint plans_published_id_fkey foreign key (published_id) references public.plan_versions (id);

-- ——— Création automatique du profil à l'inscription ———

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ——— Row Level Security ———
-- Activée sur chaque table, sans aucune politique pour anon/authenticated : tout accès direct
-- depuis le navigateur est refusé. La fonction Edge `api` utilise la clé de service, qui
-- contourne la RLS, et applique elle-même les règles d'autorisation.

alter table public.profiles enable row level security;
alter table public.pharmacies enable row level security;
alter table public.activities enable row level security;
alter table public.employees enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.requests enable row level security;
alter table public.plans enable row level security;
alter table public.plan_versions enable row level security;

-- Exception volontaire : chacun peut lire son propre profil (nécessaire pour que le client
-- Supabase Auth affiche un nom sans passer par la fonction Edge).
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());
