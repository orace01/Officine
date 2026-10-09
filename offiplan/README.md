# Planiflow — planification de l’équipe officinale

Application web en français qui aide une officine à préparer le planning de la semaine : le titulaire décrit son officine et son équipe, Planiflow propose une répartition, signale ce qui coince, puis le planning est publié pour que chaque collaborateur consulte ses créneaux et dépose ses demandes d’absence.

Cette version est un **frontend complet sans serveur** : une API locale (`src/services/localApi.js`) reproduit dans le navigateur les routes qu’exposerait un backend et enregistre les données dans le `localStorage` de ce navigateur. Il n’y a pas d’identification : un profil générique est créé automatiquement à la première visite dans chaque onglet, sans mot de passe ni information confidentielle.

## Démarrer

Prérequis : Node 20.19 ou plus récent, et pnpm (ou npm).

```sh
pnpm install --frozen-lockfile
pnpm dev        # http://localhost:3000
pnpm test       # tests du moteur de planning et de l’API locale
pnpm build      # version de production dans dist/
```

À l’ouverture, un profil est créé automatiquement et sa première officine est à configurer tout de suite : aucune identification n’est demandée. Son nom (« Profil » par défaut) se change ensuite depuis sa fiche dans l’équipe. Le premier profil créé devient titulaire et doit terminer la configuration guidée avant d’accéder à quoi que ce soit d’autre : impossible d’atteindre le tableau de bord, le planning ou l’équipe avec une officine à moitié configurée.

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
- **Paramètres** : les mêmes écrans que la configuration guidée, et la réinitialisation des données de ce navigateur.

### Collaborateur

Il rejoint l’équipe par le lien d’invitation que le titulaire lui transmet, consulte son planning publié semaine par semaine et dépose ses demandes (congé, indisponibilité, formation).

Pour tester les deux côtés depuis un seul poste, ouvrez le lien d’invitation dans un nouvel onglet : les données sont partagées entre onglets, mais chaque onglet garde sa propre connexion.

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
├── domain/                  règles métier, sans dépendance à l’interface
│   ├── schedule.js          génération, vérifications, correction, calcul des heures
│   └── defaults.js          valeurs de départ (créneaux, postes, étapes)
├── services/
│   ├── api.js               client utilisé par l’interface
│   └── localApi.js          API locale (routes, validations, stockage), à remplacer par un vrai serveur
├── state/                   profil connecté, notifications, requêtes média
├── lib/                     dates et libellés
├── components/              éléments partagés (fenêtres, champs, mise en page…)
├── features/                une page ou un parcours par dossier
└── styles/                  base.css, components.css, layout.css, app.css
```

Pour brancher un vrai serveur, il suffit de remplacer la fonction `request` de `src/services/api.js` par des appels HTTP vers les mêmes routes (`GET /plans/:semaine`, `POST /plans/:semaine/generate`, `PUT /team/:id`…), décrites et validées dans `localApi.js`.

## Hypothèses et limites

- une semaine va du lundi au dimanche ; les jours fermés ne sont pas planifiés ;
- un profil appartient à une seule officine ;
- pas de notifications externes, de pointage, de paie ni d’intégration RH ;
- l’export PDF passe par l’impression du navigateur (format paysage) ;
- il n’y a pas encore d’authentification : chaque onglet a son propre profil générique, sans mot de passe. N’y saisissez pas d’informations confidentielles tant qu’une authentification réelle n’est pas en place.
