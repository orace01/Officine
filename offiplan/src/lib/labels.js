// Libellés affichés dans l'interface et petites fonctions de présentation.

export const ROLE_LABELS = { owner: 'Titulaire', manager: 'Gestionnaire', employee: 'Collaborateur' };

export const REQUEST_TYPES = [
  { value: 'leave', label: 'Congé', description: 'Congés payés, RTT, récupération…' },
  { value: 'unavailability', label: 'Indisponibilité', description: 'Contrainte personnelle ponctuelle.' },
  { value: 'training', label: 'Formation', description: 'Formation continue, DPC, salon…' },
];
export const REQUEST_TYPE_LABELS = Object.fromEntries(REQUEST_TYPES.map((type) => [type.value, type.label]));

export const PERIODS = [
  { value: 'full', label: 'Journée entière' },
  { value: 'morning', label: 'Matin', hint: 'Créneaux qui commencent avant 13 h' },
  { value: 'afternoon', label: 'Après-midi', hint: 'Créneaux qui se terminent après 13 h' },
];
export const PERIOD_LABELS = Object.fromEntries(PERIODS.map((period) => [period.value, period.label]));

export const REQUEST_STATUS = {
  pending: { label: 'En attente', tone: 'amber' },
  approved: { label: 'Acceptée', tone: 'green' },
  refused: { label: 'Refusée', tone: 'coral' },
  cancelled: { label: 'Annulée', tone: 'neutral' },
};

export const VERSION_SOURCES = {
  generated: 'Proposition générée',
  edited: 'Modifiée à la main',
  repaired: 'Correction automatique',
  restored: 'Version restaurée',
};

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');
}

export function firstName(name = '') {
  return name.trim().split(/\s+/)[0] || '';
}

export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

// Prénoms courts pour le planning ; on ajoute l'initiale du nom quand deux prénoms se ressemblent.
export function shortNames(members) {
  const counts = new Map();
  members.forEach((member) => counts.set(firstName(member.name), (counts.get(firstName(member.name)) || 0) + 1));
  return new Map(members.map((member) => {
    const first = firstName(member.name);
    const last = member.name.trim().split(/\s+/)[1];
    return [member.id, counts.get(first) > 1 && last ? `${first} ${last[0]}.` : first];
  }));
}
