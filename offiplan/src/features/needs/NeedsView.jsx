import { useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Eraser, Users } from 'lucide-react';
import { api } from '../../services/api.js';
import { useUnsavedChanges } from '../../router.jsx';
import { useResource, useWorkspace } from '../../state/workspace.jsx';
import { COMPACT_SCREEN, useMediaQuery } from '../../state/media.js';
import { MAX_NEED } from '../../domain/defaults.js';
import { totalNeededHours } from '../../domain/schedule.js';
import { WEEKDAYS, WEEKDAYS_SHORT, formatHours, formatSlot } from '../../lib/dates.js';
import { ActivityTag, Callout, FormError, Loader, NumberInput } from '../../components/ui.jsx';

function dayTotal(day) {
  return Object.values(day || {}).reduce((sum, counts) => sum + Object.values(counts).reduce((inner, count) => inner + Number(count || 0), 0), 0);
}

// Charge les besoins enregistrés puis affiche l'éditeur ; il est recréé si les créneaux ou les postes changent.
export default function NeedsView(props) {
  const workspace = useWorkspace();
  const { data, error } = useResource(() => api.needs(), [workspace.revision]);
  const layout = workspace.pharmacy.settings;
  const activities = workspace.activeActivities;
  if (error) return <FormError>{error.message}</FormError>;
  if (!data) return <Loader />;
  const key = [...layout.slots.map((slot) => slot.id), ...activities.map((activity) => activity.id)].join('|');
  return <NeedsEditor key={key} initial={data.needs} layout={layout} activities={activities} {...props} />;
}

function NeedsEditor({ initial, layout, activities, onSaved, renderActions }) {
  const workspace = useWorkspace();
  const openDays = layout.openDays.flatMap((open, index) => (open ? [index] : []));
  const closedDays = layout.openDays.flatMap((open, index) => (open ? [] : [WEEKDAYS[index]]));
  const [saved, setSaved] = useState(initial);
  const [needs, setNeeds] = useState(initial);
  const [day, setDay] = useState(openDays[0] ?? 0);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const compact = useMediaQuery(COMPACT_SCREEN);
  const dirty = JSON.stringify(needs) !== JSON.stringify(saved);
  useUnsavedChanges(dirty && !busy);

  const weeklyHours = totalNeededHours(needs, layout);
  const hasNeeds = weeklyHours > 0;
  const dayPosition = openDays.indexOf(day);
  const previousDay = dayPosition > 0 ? openDays[dayPosition - 1] : null;
  const nextDay = dayPosition >= 0 && dayPosition < openDays.length - 1 ? openDays[dayPosition + 1] : null;

  function setCount(slotId, activityId, value) {
    setNotice('');
    setNeeds((current) => current.map((counts, index) => (index === day
      ? { ...counts, [slotId]: { ...counts[slotId], [activityId]: value } }
      : counts)));
  }

  function copyToOpenDays() {
    setNeeds((current) => current.map((counts, index) => (layout.openDays[index] && index !== day ? structuredClone(current[day]) : counts)));
    setNotice(`Les besoins du ${WEEKDAYS[day].toLowerCase()} ont été copiés sur les autres jours ouverts. Ajustez les jours qui diffèrent puis enregistrez.`);
  }

  function clearDay() {
    setNeeds((current) => current.map((counts, index) => (index === day
      ? Object.fromEntries(Object.entries(counts).map(([slotId, values]) => [slotId, Object.fromEntries(Object.keys(values).map((id) => [id, 0]))]))
      : counts)));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api.saveNeeds(needs);
      setSaved(result.needs);
      setNeeds(result.needs);
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
      <section className="card form-card">
        <div className="day-tabs-row">
          <button type="button" className="icon-btn" aria-label="Jour précédent" disabled={previousDay === null} onClick={() => setDay(previousDay)}><ChevronLeft size={18} /></button>
          <div className="day-tabs" role="tablist" aria-label="Jour à configurer">
            {openDays.map((index) => {
              const total = dayTotal(needs[index]);
              return (
                <button type="button" role="tab" key={index} aria-selected={day === index} className={`day-tab ${day === index ? 'is-active' : ''}`} onClick={() => setDay(index)}>
                  <span className="day-tab-name"><span className="only-wide">{WEEKDAYS[index]}</span><span className="only-narrow">{WEEKDAYS_SHORT[index]}</span></span>
                  <span className={`day-tab-count ${total ? '' : 'is-empty'}`}>{total ? `${total} pers.` : 'à remplir'}</span>
                </button>
              );
            })}
          </div>
          <button type="button" className="icon-btn" aria-label="Jour suivant" disabled={nextDay === null} onClick={() => setDay(nextDay)}><ChevronRight size={18} /></button>
        </div>
        {closedDays.length > 0 && <p className="muted small">Fermé : {closedDays.join(', ')}. Modifiez les jours d’ouverture pour les planifier.</p>}

        {compact ? (
          <ol className="needs-slots">
            {layout.slots.map((slot) => {
              const total = Object.values(needs[day]?.[slot.id] || {}).reduce((sum, count) => sum + Number(count || 0), 0);
              return (
                <li key={slot.id} className="needs-slot">
                  <header><strong>{formatSlot(slot)}</strong><span className="muted small">{total ? `${total} pers.` : 'Aucun besoin'}</span></header>
                  {activities.map((activity) => (
                    <div key={activity.id} className="needs-slot-row">
                      <ActivityTag activity={activity} />
                      <NumberInput
                        value={Number(needs[day]?.[slot.id]?.[activity.id] || 0)}
                        max={MAX_NEED}
                        label={`${activity.name}, ${WEEKDAYS[day].toLowerCase()} ${formatSlot(slot)}`}
                        onChange={(value) => setCount(slot.id, activity.id, value)}
                      />
                    </div>
                  ))}
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="table-scroll">
            <table className="needs-table">
              <caption className="sr-only">Personnes nécessaires le {WEEKDAYS[day].toLowerCase()}, par poste et par créneau</caption>
              <thead>
                <tr>
                  <th scope="col">Poste</th>
                  {layout.slots.map((slot) => <th scope="col" key={slot.id}>{formatSlot(slot)}</th>)}
                </tr>
              </thead>
              <tbody>
                {activities.map((activity) => (
                  <tr key={activity.id}>
                    <th scope="row"><ActivityTag activity={activity} /></th>
                    {layout.slots.map((slot) => (
                      <td key={slot.id}>
                        <NumberInput
                          value={Number(needs[day]?.[slot.id]?.[activity.id] || 0)}
                          max={MAX_NEED}
                          label={`${activity.name}, ${WEEKDAYS[day].toLowerCase()} ${formatSlot(slot)}`}
                          onChange={(value) => setCount(slot.id, activity.id, value)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  {layout.slots.map((slot) => {
                    const total = Object.values(needs[day]?.[slot.id] || {}).reduce((sum, count) => sum + Number(count || 0), 0);
                    return <td key={slot.id}>{total ? `${total} pers.` : '—'}</td>;
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="needs-actions">
          {openDays.length > 1 && <button type="button" className="btn btn-secondary" onClick={copyToOpenDays}><Copy size={17} /> Copier ce jour sur les autres jours ouverts</button>}
          <button type="button" className="btn btn-ghost" onClick={clearDay}><Eraser size={17} /> Remettre ce jour à zéro</button>
          {nextDay !== null && (
            <button type="button" className="btn btn-ghost needs-next-day" onClick={() => setDay(nextDay)}>
              {WEEKDAYS[nextDay]} <ChevronRight size={17} />
            </button>
          )}
        </div>
        {notice && <Callout tone="success">{notice}</Callout>}
        <p className="form-summary">
          <Users size={16} aria-hidden="true" />
          {hasNeeds ? `Besoin total : ${formatHours(weeklyHours)} de présence par semaine, tous postes confondus.` : 'Aucun besoin pour l’instant : indiquez au moins un poste à tenir.'}
        </p>
        <FormError>{error}</FormError>
      </section>
      {renderActions({ busy, dirty, valid: hasNeeds })}
    </form>
  );
}
