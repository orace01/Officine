import { useRef, useState } from 'react';
import { Clock3, Plus, Trash2 } from 'lucide-react';
import { api } from '../../services/api.js';
import { useUnsavedChanges } from '../../router.jsx';
import { useWorkspace } from '../../state/workspace.jsx';
import { MAX_SLOTS, SLOT_PRESETS } from '../../domain/defaults.js';
import { slotHours } from '../../domain/schedule.js';
import { WEEKDAYS, formatHours, formatTime, isTime, minutesToTime, timeToMinutes } from '../../lib/dates.js';
import { Callout, ChoiceChips, FormError } from '../../components/ui.jsx';

function slotProblem(slot, previous) {
  if (!isTime(slot.start) || !isTime(slot.end)) return 'Indiquez une heure de début et de fin.';
  if (timeToMinutes(slot.end) <= timeToMinutes(slot.start)) return 'La fin doit suivre le début.';
  if (previous && isTime(previous.end) && timeToMinutes(slot.start) < timeToMinutes(previous.end)) return 'Ce créneau chevauche le précédent.';
  return null;
}

function periodLabel(slot) {
  if (!isTime(slot.start) || !isTime(slot.end)) return '';
  if (timeToMinutes(slot.end) <= 13 * 60) return 'Matin';
  if (timeToMinutes(slot.start) >= 13 * 60) return 'Après-midi';
  return 'Mi-journée';
}

// `fields` choisit ce qui est affiché : 'days' (jours seuls), 'slots' (créneaux seuls)
// ou 'both' (les deux, utilisé dans Paramètres). L'état des deux parties est toujours
// suivi, pour que la partie masquée soit enregistrée inchangée avec l'autre.
export default function OpeningForm({ settings, onSaved, renderActions, warnAboutNeeds = false, fields = 'both' }) {
  const workspace = useWorkspace();
  const keyCounter = useRef(0);
  const withKey = (slot) => {
    keyCounter.current += 1;
    return { ...slot, key: slot.id || `nouveau-${keyCounter.current}` };
  };
  const [openDays, setOpenDays] = useState(settings.openDays);
  const [slots, setSlots] = useState(() => settings.slots.map(withKey));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const serialized = (days, list) => JSON.stringify([days, list.map(({ id, start, end }) => [id || null, start, end])]);
  const dirty = serialized(openDays, slots) !== serialized(settings.openDays, settings.slots);
  useUnsavedChanges(dirty && !busy);

  const sorted = [...slots].sort((left, right) => (left.start || '').localeCompare(right.start || ''));
  const problems = new Map(sorted.map((slot, index) => [slot.key, slotProblem(slot, sorted[index - 1])]));
  const valid = openDays.some(Boolean) && slots.length > 0 && [...problems.values()].every((problem) => !problem);
  const dailyHours = valid ? slots.reduce((sum, slot) => sum + slotHours(slot), 0) : 0;
  const openCount = openDays.filter(Boolean).length;
  const showDays = fields !== 'slots';
  const showSlots = fields !== 'days';

  function updateSlot(key, field, value) {
    setSlots((current) => current.map((slot) => (slot.key === key ? { ...slot, [field]: value } : slot)));
  }

  function addSlot() {
    const last = sorted[sorted.length - 1];
    const start = last && isTime(last.end) ? last.end : '09:00';
    const end = minutesToTime(Math.min(timeToMinutes(start) + 120, 23 * 60 + 59));
    setSlots((current) => [...current, withKey({ start, end })]);
  }

  function applyPreset(preset) {
    setSlots(preset.slots.map((slot) => withKey({ ...slot })));
  }

  async function submit(event) {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError('');
    try {
      await api.saveSettings({ openDays, slots: sorted.map(({ id, start, end }) => ({ id, start, end })) });
      await workspace.refresh();
      await onSaved();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="form-stack">
      {showDays && (
        <section className="card form-card">
          {fields === 'both' && (
            <header className="form-section-header">
              <h2>Jours d’ouverture</h2>
              <p>Le planning ne propose des postes que les jours où l’officine est ouverte.</p>
            </header>
          )}
          <ChoiceChips
            label="Jours d’ouverture"
            options={WEEKDAYS.map((day, index) => ({ value: index, label: day }))}
            value={openDays.flatMap((open, index) => (open ? [index] : []))}
            onChange={(selected) => setOpenDays(WEEKDAYS.map((_, index) => selected.includes(index)))}
          />
          {!openDays.some(Boolean) && <p className="field-error">Choisissez au moins un jour.</p>}
          {fields === 'days' && openCount > 0 && (
            <p className="form-summary">
              <Clock3 size={16} aria-hidden="true" />
              {openCount} jour{openCount > 1 ? 's' : ''} d’ouverture sur 7.
            </p>
          )}
        </section>
      )}

      {showSlots && (
        <section className="card form-card">
          {fields === 'both' && (
            <header className="form-section-header">
              <h2>Créneaux de la journée</h2>
              <p>Le planning est découpé en créneaux. Pour chacun, vous indiquerez ensuite combien de personnes il faut sur chaque poste.</p>
            </header>
          )}
          <div className="preset-row">
            <span>Modèles :</span>
            {SLOT_PRESETS.map((preset) => (
              <button type="button" className="btn btn-secondary btn-sm" key={preset.id} onClick={() => applyPreset(preset)}>{preset.label}</button>
            ))}
          </div>
          <ol className="slot-list">
            {sorted.map((slot, index) => {
              const problem = problems.get(slot.key);
              return (
                <li key={slot.key} className={`slot-row ${problem ? 'has-error' : ''}`}>
                  <span className="slot-number">{index + 1}</span>
                  <label className="slot-time">
                    <span>De</span>
                    <input type="time" value={slot.start} onChange={(event) => updateSlot(slot.key, 'start', event.target.value)} aria-label={`Début du créneau ${index + 1}`} required />
                  </label>
                  <label className="slot-time">
                    <span>à</span>
                    <input type="time" value={slot.end} onChange={(event) => updateSlot(slot.key, 'end', event.target.value)} aria-label={`Fin du créneau ${index + 1}`} required />
                  </label>
                  <span className="slot-meta">
                    {problem ? <span className="field-error">{problem}</span> : <>{formatHours(slotHours(slot))} · {periodLabel(slot)}</>}
                  </span>
                  <button type="button" className="icon-btn" aria-label={`Supprimer le créneau ${index + 1}`} disabled={slots.length <= 1} onClick={() => setSlots((current) => current.filter((item) => item.key !== slot.key))}>
                    <Trash2 size={18} />
                  </button>
                </li>
              );
            })}
          </ol>
          <button type="button" className="btn btn-secondary" onClick={addSlot} disabled={slots.length >= MAX_SLOTS}><Plus size={18} /> Ajouter un créneau</button>
          {valid && (
            <p className="form-summary">
              <Clock3 size={16} aria-hidden="true" />
              {openCount} jour{openCount > 1 ? 's' : ''} d’ouverture · de {formatTime(sorted[0].start)} à {formatTime(sorted[sorted.length - 1].end)} · {formatHours(dailyHours)} planifiées par jour
            </p>
          )}
          {warnAboutNeeds && dirty && (
            <Callout tone="warning" title="Les besoins suivent les créneaux">
              Chaque créneau existant garde ses besoins, même si vous changez ses horaires. Un nouveau créneau (ou un modèle appliqué) démarre à zéro ; un créneau supprimé perd ses besoins.
            </Callout>
          )}
        </section>
      )}
      <FormError>{error}</FormError>
      {renderActions({ busy, dirty, valid })}
    </form>
  );
}
