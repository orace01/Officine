# Planiflow — planification de l’équipe officinale

Application web en français qui aide une officine à préparer le planning de la semaine : le titulaire décrit son officine et son équipe, Planiflow propose une répartition, signale ce qui coince, puis le planning est publié pour que chaque collaborateur consulte ses créneaux et dépose ses demandes d’absence.

Le backend est [Supabase](https://supabase.com) : Postgres pour les données, Supabase Auth pour l’authentification (e-mail + mot de passe), et une fonction Edge (`supabase/functions/api/`) qui expose les routes métier. La RLS est activée sur toutes les tables sans aucune politique pour `anon`/`authenticated` : le navigateur ne lit ni n’écrit jamais Postgres directement, tout passe par la fonction Edge, qui revérifie elle-même l’identité et le rôle de la personne à chaque appel.

## Démarrer

Prérequis : Node 20.19 ou plus récent, pnpm (ou npm), Docker (pour la stack Supabase locale) et la [CLI Supabase](https://supabase.com/docs/guides/local-development/cli/getting-started).

```sh
pnpm install --frozen-lockfile
pnpm supabase:start      # démarre Postgres et Auth en local (Docker), applique les migrations
pnpm supabase:functions  # sert la fonction Edge en local, avec rechargement à chaud — à garder ouvert
cp .env.example .env.local   # les valeurs par défaut fonctionnent avec la stack locale telle quelle
pnpm dev                 # http://localhost:3000, dans un autre terminal
pnpm test                # tests du moteur de planning
pnpm build               # version de production dans dist/
```

`pnpm supabase:start` affiche l’URL et les clés de la stack locale ; `pnpm supabase:stop` l’arrête. Avec un projet Supabase hébergé, les mêmes variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) se trouvent dans Project Settings → API, et la fonction Edge se déploie avec `supabase functions deploy api` (plus besoin de `supabase:functions`, qui ne sert qu’en local).

Pour cette première version, la création de compte est désactivée (`enable_signup = false`) : une seule personne doit pouvoir se connecter. Son compte se crée une fois avec :

```sh
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/create-admin.mjs titulaire@officine.fr "Camille Martin"
```

(`SUPABASE_SERVICE_ROLE_KEY` est affichée par `pnpm supabase:start` ; pour un projet hébergé, elle vient de Project Settings → API — ne jamais la mettre dans le frontend ni la commiter.) Le mot de passe généré n’est affiché qu’une fois : à noter immédiatement. Ce profil devient titulaire et doit terminer la configuration guidée avant d’accéder à quoi que ce soit d’autre : impossible d’atteindre le tableau de bord, le planning ou l’équipe avec une officine à moitié configurée.

## Parcours

### Titulaire : configuration guidée, obligatoire, une question par page

1. **Officine** : nom et ville.
2. **Jours** : les jours d’ouverture.
3. **Créneaux** : le découpage de la journée (modèles proposés : 4 × 2 h, matin / après-midi, grande amplitude).
4. **Postes** : les activités à tenir (comptoir, réception des commandes, piluliers…), modifiables.
5. **Besoins** : nombre de personnes par poste, par jour et par créneau — un jour à la fois, avec une flèche pour passer au suivant ; un jour type peut aussi être copié sur les autres.
6. **Équipe** : chaque personne avec sa fonction, son volume horaire maximal, les postes qu’elle peut tenir et ses jours de repos fixes.
7. **Récapitulatif** : vérifications (postes sans personne compétente, capacité horaire insuffisante…) puis génération du premier planning.

Chaque étape est enregistrée avant de passer à la suivante ; aucune ne peut être sautée. Ce n’est qu’une fois le récapitulatif validé que le tableau de bord devient accessible.

### Titulaire ou gestionnaire : au quotidien

- **Accueil** : état de la semaine en cours et de la suivante, demandes à traiter, accès de l’équipe.
- **Planning** : avancement en trois étapes (Proposer → Vérifier → Publier). Vue par poste ou par personne, modification d’un créneau en un clic, points à vérifier, heures planifiées, absences de la semaine, historique des versions. Les modifications sont enregistrées automatiquement dans un brouillon ; la version publiée reste visible par l’équipe jusqu’à la publication suivante. « Corriger automatiquement » retire les affectations devenues impossibles (absence, repos, compétence, doublon) et cherche des remplaçants.
- **Équipe** : fiches, invitations (lien personnel à usage unique, rôle collaborateur ou gestionnaire, à transmettre vous-même puisque Planiflow ne l’envoie pas), retrait d’accès, absences saisies directement.
- **Demandes** : acceptation ou refus (avec motif) des demandes d’absence, puis accès direct au planning concerné.
- **Paramètres** : les mêmes écrans que la configuration guidée.

### Collaborateur

*Pas encore utilisable dans cette première version (voir plus haut : un seul compte existe) ; décrit ici pour la suite.* Il rejoint l’équipe par le lien d’invitation que le titulaire lui transmet (connexion avec un compte créé pour lui via `scripts/create-admin.mjs`, puis rattachement automatique), consulte son planning publié semaine par semaine et dépose ses demandes (congé, indisponibilité, formation).

## Règles du générateur

- les postes les plus difficiles à pourvoir (le moins de personnes compétentes) sont servis en premier ;
- une personne n’est jamais placée sur un poste qu’elle ne tient pas, un jour de repos, pendant une absence acceptée ni sur deux postes au même moment ;
- le volume horaire indiqué sur la fiche n’est pas dépassé ; la charge est répartie au prorata de ce volume ;
- à charge égale, une personne déjà présente sur le créneau précédent est privilégiée, pour éviter les journées morcelées ;
- une absence « matin » couvre les créneaux qui commencent avant 13 h, « après-midi » ceux qui se terminent après 13 h.

La proposition reste un brouillon : elle se relit et s’ajuste avant publication. Ces règles ne remplacent pas les obligations légales ou conventionnelles (durées maximales, repos, pointage, paie), qui ne sont pas gérées.

## Organisation du code

```text
src/
├── App.jsx                  routage selon le rôle et l’avancement de la configuration
├── router.jsx               routeur par fragment d’URL (#/planning/2026-10-12)
├── domain/                  règles métier, sans dépendance à l’interface ni à Postgres
│   ├── schedule.js          génération, vérifications, correction, calcul des heures
│   ├── validation.js        règles de validation, partagées avec la fonction Edge
│   └── defaults.js          valeurs de départ (créneaux, postes, étapes)
├── services/
│   ├── api.js               client utilisé par l’interface (Supabase Auth + fonction Edge)
│   └── supabaseClient.js    client Supabase unique (authentification)
├── state/                   profil connecté, notifications, requêtes média
├── lib/                     dates et libellés
├── components/              éléments partagés (fenêtres, champs, mise en page…)
├── features/                une page ou un parcours par dossier
└── styles/                  base.css, components.css, layout.css, app.css

supabase/
├── migrations/              schéma Postgres (tables, types, RLS)
└── functions/api/           fonction Edge : toutes les routes métier
```

`src/domain/schedule.js` et `src/domain/validation.js` sont importés tels quels par la fonction Edge (`supabase/functions/api/index.ts`) : le moteur de planning et les règles de validation ne sont écrits qu’une fois, côté frontend comme côté serveur.

## Hypothèses et limites

- **première version : un seul compte** — la création de compte est désactivée (`enable_signup = false` dans `supabase/config.toml`) ; inviter un collaborateur crée bien le lien, mais personne ne peut encore s’y connecter tant que son compte n’est pas créé à la main avec `scripts/create-admin.mjs` ;
- une semaine va du lundi au dimanche ; les jours fermés ne sont pas planifiés ;
- un profil appartient à une seule officine ;
- pas de notifications externes, de pointage, de paie ni d’intégration RH ;
- l’export PDF passe par l’impression du navigateur (format paysage).
