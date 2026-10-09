// Dates manipulées sous forme de chaînes ISO locales (AAAA-MM-JJ) pour éviter les décalages de fuseau.

export const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
export const WEEKDAYS_SHORT = ['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.', 'Dim.'];

export function parseISODate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

export function toISODate(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function isISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return toISODate(parseISODate(value)) === value;
}

export function todayISO() {
  return toISODate(new Date());
}

export function addDays(value, amount) {
  const date = parseISODate(value);
  date.setDate(date.getDate() + amount);
  return toISODate(date);
}

export function daysBetween(start, end) {
  return Math.round((parseISODate(end) - parseISODate(start)) / 86400000);
}

export function weekStartOf(value = todayISO()) {
  const date = parseISODate(value);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return toISODate(date);
}

export function isWeekStart(value) {
  return isISODate(value) && parseISODate(value).getDay() === 1;
}

export function weekDates(weekStart) {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

export function formatDate(value, options = { day: 'numeric', month: 'long' }) {
  return parseISODate(value).toLocaleDateString('fr-FR', options);
}

export function formatDayLong(value) {
  return formatDate(value, { weekday: 'long', day: 'numeric', month: 'long' });
}

export function formatWeekRange(weekStart) {
  const start = parseISODate(weekStart);
  const end = parseISODate(addDays(weekStart, 6));
  const sameMonth = start.getMonth() === end.getMonth();
  const startLabel = start.toLocaleDateString('fr-FR', sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
  const endLabel = end.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${startLabel} – ${endLabel}`;
}

export function formatDateRange(start, end) {
  if (start === end) return formatDayLong(start);
  return `du ${formatDate(start, { day: 'numeric', month: 'short' })} au ${formatDate(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export function relativeWeekLabel(weekStart, reference = weekStartOf()) {
  const weeks = Math.round(daysBetween(reference, weekStart) / 7);
  if (weeks === 0) return 'Cette semaine';
  if (weeks === 1) return 'Semaine prochaine';
  if (weeks === -1) return 'Semaine dernière';
  return weeks > 0 ? `Dans ${weeks} semaines` : `Il y a ${-weeks} semaines`;
}

export function formatTimestamp(value) {
  return new Date(value).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function isTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function timeToMinutes(value) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(total) {
  const bounded = Math.max(0, Math.min(23 * 60 + 59, total));
  return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(2, '0')}`;
}

export function formatTime(value) {
  const [hours, minutes] = value.split(':');
  return minutes === '00' ? `${Number(hours)} h` : `${Number(hours)} h ${minutes}`;
}

export function formatSlot(slot) {
  return `${formatTime(slot.start)} – ${formatTime(slot.end)}`;
}

export function formatHours(value) {
  const rounded = Math.round(value * 10) / 10;
  return `${String(rounded).replace('.', ',')} h`;
}
