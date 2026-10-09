// Valeurs de départ proposées à la création d'une officine. Toutes sont modifiables ensuite.

export const DEFAULT_OPEN_DAYS = [true, true, true, true, true, true, false];

export const DEFAULT_SLOTS = [
  { start: '09:00', end: '11:00' },
  { start: '11:00', end: '13:00' },
  { start: '14:00', end: '16:00' },
  { start: '16:00', end: '18:00' },
];

export const SLOT_PRESETS = [
  { id: 'four', label: '4 créneaux de 2 h', slots: DEFAULT_SLOTS },
  { id: 'halves', label: 'Matin et après-midi', slots: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '19:00' }] },
  {
    id: 'long',
    label: 'Grande amplitude (8 h 30 – 19 h 30)',
    slots: [
      { start: '08:30', end: '10:30' },
      { start: '10:30', end: '12:30' },
      { start: '14:00', end: '16:00' },
      { start: '16:00', end: '17:45' },
      { start: '17:45', end: '19:30' },
    ],
  },
];

export const STARTER_ACTIVITIES = ['Comptoir', 'Réception des commandes', 'Préparation des piluliers', 'Back-office'];

export const ACTIVITY_SUGGESTIONS = ['Vaccination', 'Orthopédie', 'Parapharmacie', 'Tiers payant', 'Livraisons', 'Entretiens pharmaceutiques'];

export const ACTIVITY_COLORS = ['sage', 'blue', 'lilac', 'amber', 'coral', 'teal', 'rose', 'olive'];

export const ROLE_TITLE_SUGGESTIONS = [
  'Pharmacien·ne titulaire',
  'Pharmacien·ne adjoint·e',
  'Préparateur·rice',
  'Apprenti·e préparateur·rice',
  'Rayonniste',
  'Étudiant·e en pharmacie',
];

// Une étape = une question. Les étapes plus riches (besoins, équipe) restent groupées
// par jour ou par personne à l'intérieur de la page, pour ne pas multiplier les pages.
export const SETUP_STEPS = [
  { id: 'officine', label: 'Officine' },
  { id: 'jours', label: 'Jours' },
  { id: 'creneaux', label: 'Créneaux' },
  { id: 'postes', label: 'Postes' },
  { id: 'besoins', label: 'Besoins' },
  { id: 'equipe', label: 'Équipe' },
  { id: 'recapitulatif', label: 'Récapitulatif' },
];

export const MAX_SLOTS = 8;
export const MAX_ACTIVITIES = 20;
export const MAX_NEED = 20;
export const MAX_WEEKLY_HOURS = 60;
