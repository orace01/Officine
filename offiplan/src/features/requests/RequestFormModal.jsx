import { useId, useState } from 'react';
import { Info } from 'lucide-react';
import { addDays, daysBetween, formatDateRange, todayISO } from '../../lib/dates.js';
import { PERIODS, PERIOD_LABELS, REQUEST_TYPES, plural } from '../../lib/labels.js';
import Modal from '../../components/Modal.jsx';
import { Field, FormError } from '../../components/ui.jsx';

// Formulaire d'absence. Pour le titulaire ou un gestionnaire (`managerEntry`), l'absence est validée directement.
export default function RequestFormModal({ title = 'Nouvelle demande d’absence', members = null, managerEntry = false, onSubmit, onClose }) {
  const today = todayISO();
  const formId = useId();
  const ids = { member: useId(), start: useId(), end: useId(), note: useId() };
  const [values, setValues] = useState({
    employeeId: members?.[0]?.id || '',
    type: 'leave',
    startDate: addDays(today, managerEntry ? 0 : 1),
    endDate: addDays(today, managerEntry ? 0 : 1),
    period: 'full',
    note: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (field, value) => setValues((current) => {
    const next = { ...current, [field]: value };
    if (field === 'startDate' && next.endDate < value) next.endDate = value;
    return next;
  });
  const valid = values.startDate && values.endDate && values.endDate >= values.startDate && (!members || values.employeeId);
  const dayCount = valid ? daysBetween(values.startDate, values.endDate) + 1 : 0;

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { employeeId, ...rest } = values;
      await onSubmit(members ? { ...rest, employeeId } : rest);
      onClose();
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      description={managerEntry ? 'Une absence saisie par le titulaire ou un gestionnaire est acceptée directement.' : 'Votre demande sera transmise au titulaire, qui l’acceptera ou la refusera.'}
      onClose={onClose}
      size="lg"
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={busy || !valid}>
            {busy ? 'Envoi…' : managerEntry ? 'Enregistrer l’absence' : 'Envoyer la demande'}
          </button>
        </>
      )}
    >
      <form id={formId} onSubmit={submit} className="request-form">
        {members && (
          <Field id={ids.member} label="Personne concernée">
            <select id={ids.member} value={values.employeeId} onChange={(event) => set('employeeId', event.target.value)} required>
              {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
          </Field>
        )}

        <fieldset className="fieldset">
          <legend>Type d’absence</legend>
          <div className="radio-cards">
            {REQUEST_TYPES.map((type) => (
              <label key={type.value} className={`radio-card ${values.type === type.value ? 'is-selected' : ''}`}>
                <input type="radio" name={`${formId}-type`} value={type.value} checked={values.type === type.value} onChange={() => set('type', type.value)} />
                <span><strong>{type.label}</strong><small>{type.description}</small></span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="form-grid">
          <Field id={ids.start} label="Du">
            <input id={ids.start} type="date" value={values.startDate} min={managerEntry ? undefined : today} onChange={(event) => set('startDate', event.target.value)} required />
          </Field>
          <Field id={ids.end} label="Au (inclus)">
            <input id={ids.end} type="date" value={values.endDate} min={values.startDate} onChange={(event) => set('endDate', event.target.value)} required />
          </Field>
        </div>

        <fieldset className="fieldset">
          <legend>Période</legend>
          <div className="segmented segmented-wide">
            {PERIODS.map((period) => (
              <label key={period.value} className={values.period === period.value ? 'is-active' : ''}>
                <input type="radio" name={`${formId}-period`} value={period.value} checked={values.period === period.value} onChange={() => set('period', period.value)} />
                {period.label}
              </label>
            ))}
          </div>
          <p className="field-hint">{PERIODS.find((period) => period.value === values.period).hint || 'Tous les créneaux de la journée.'} Sur plusieurs jours, la période s’applique à chacun.</p>
        </fieldset>

        <Field id={ids.note} label="Commentaire" optional>
          <textarea id={ids.note} rows={3} maxLength={500} value={values.note} onChange={(event) => set('note', event.target.value)} placeholder="Une précision utile pour l’organisation" />
        </Field>

        {valid && (
          <p className="form-summary">
            <Info size={16} aria-hidden="true" />
            {values.startDate === values.endDate ? 'Absence le ' : 'Absence '}{formatDateRange(values.startDate, values.endDate)} · {PERIOD_LABELS[values.period].toLowerCase()}{dayCount > 1 ? ` · ${plural(dayCount, 'jour')}` : ''}
          </p>
        )}
        <FormError>{error}</FormError>
      </form>
    </Modal>
  );
}
