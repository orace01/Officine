import { WEEKDAYS_SHORT, formatHours, formatSlot } from '../../lib/dates.js';

const REASONS = {
  absent: (who, what) => `${who} est absent·e mais reste affecté·e à ${what}.`,
  rest: (who) => `${who} est en repos ce jour-là.`,
  inactive: (who) => `${who} n’est plus incluse dans les plannings.`,
  removed: (who) => `${who} ne fait plus partie de l’équipe.`,
  skill: (who, what) => `${who} ne tient pas le poste ${what}.`,
  double: (who) => `${who} est prévu·e sur deux postes en même temps.`,
};

export function describeIssue(issue, { people, activityById, layout }) {
  const who = people.get(issue.employeeId)?.name || 'Une personne';
  const what = activityById.get(issue.activityId)?.name || 'un poste supprimé';
  const slot = layout.slots.find((item) => item.id === issue.slotId);
  const where = slot ? `${WEEKDAYS_SHORT[issue.dayIndex]} ${formatSlot(slot)}` : null;
  if (issue.type === 'gap') {
    return { where, text: `${issue.missing} personne${issue.missing > 1 ? 's' : ''} manquante${issue.missing > 1 ? 's' : ''} sur ${what}.` };
  }
  if (issue.type === 'hours') {
    return { where: null, text: `${who} : ${formatHours(issue.planned)} planifiées pour ${formatHours(issue.limit)} prévues.` };
  }
  return { where, text: REASONS[issue.type](who, what) };
}

export const UNAVAILABILITY_LABELS = {
  absent: 'Absent·e',
  rest: 'Jour de repos',
  inactive: 'Hors planning',
  removed: 'Retiré·e de l’équipe',
};
