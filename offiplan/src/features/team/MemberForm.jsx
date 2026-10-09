import { useId, useState } from 'react';
import { useUnsavedChanges } from '../../router.jsx';
import { MAX_WEEKLY_HOURS, ROLE_TITLE_SUGGESTIONS } from '../../domain/defaults.js';
import { WEEKDAYS } from '../../lib/dates.js';
import { ChoiceChips, Field, FormError, Switch } from '../../components/ui.jsx';

function initialValues(member) {
  return {
    name: member?.name || '',
    roleTitle: member?.roleTitle || '',
    weeklyHours: member?.weeklyHours ?? '',
    skills: member?.skills || [],
    restDays: member?.restDays || [],
    schedulable: member?.schedulable ?? true,
  };
}

export default function MemberForm({ member, activities, onSubmit, onCancel, submitLabel = 'Enregistrer' }) {
  const [values, setValues] = useState(() => initialValues(member));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ids = { name: useId(), role: useId(), hours: useId(), roles: useId() };
  const dirty = JSON.stringify(values) !== JSON.stringify(initialValues(member));
  useUnsavedChanges(dirty && !busy);

  const set = (field, value) => setValues((current) => ({ ...current, [field]: value }));
  const knownSkills = new Set(activities.map((activity) => activity.id));
  const skills = values.skills.filter((id) => knownSkills.has(id));
  const valid = values.name.trim().length >= 2 && values.roleTitle.trim() && (!values.schedulable || skills.length > 0);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit({ ...values, skills, weeklyHours: values.weeklyHours === '' ? null : Number(values.weeklyHours) });
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="member-form">
      <div className="form-grid">
        <Field id={ids.name} label="Nom complet">
          <input id={ids.name} value={values.name} onChange={(event) => set('name', event.target.value)} autoComplete="off" required minLength={2} maxLength={120} autoFocus={!member} />
        </Field>
        <Field id={ids.role} label="Fonction">
          <input id={ids.role} list={ids.roles} value={values.roleTitle} onChange={(event) => set('roleTitle', event.target.value)} placeholder="Ex. Préparateur·rice" required maxLength={80} />
          <datalist id={ids.roles}>{ROLE_TITLE_SUGGESTIONS.map((title) => <option key={title} value={title} />)}</datalist>
        </Field>
      </div>

      <Field id={ids.hours} label="Volume horaire par semaine" optional hint="Le planning proposé ne dépassera pas ce volume. Laissez vide pour ne fixer aucune limite.">
        <div className="input-suffix">
          <input id={ids.hours} type="number" inputMode="decimal" min="0" max={MAX_WEEKLY_HOURS} step="0.5" value={values.weeklyHours} onChange={(event) => set('weeklyHours', event.target.value)} placeholder="35" />
          <span>h / semaine</span>
        </div>
      </Field>

      <fieldset className="fieldset">
        <legend>Postes que cette personne peut tenir</legend>
        <ChoiceChips label="Postes" options={activities.map((activity) => ({ value: activity.id, label: activity.name, color: activity.color }))} value={skills} onChange={(next) => set('skills', next)} />
        {values.schedulable && !skills.length && <p className="field-hint">Choisissez au moins un poste.</p>}
      </fieldset>

      <fieldset className="fieldset">
        <legend>Jours de repos fixes</legend>
        <ChoiceChips label="Jours de repos" options={WEEKDAYS.map((day, index) => ({ value: index, label: day }))} value={values.restDays} onChange={(next) => set('restDays', next)} />
        <p className="field-hint">Les congés ponctuels se déclarent dans les demandes d’absence.</p>
      </fieldset>

      <Switch
        checked={values.schedulable}
        onChange={(checked) => set('schedulable', checked)}
        label="Inclure dans les plannings"
        description="Désactivez pour une personne qui ne tient aucun poste. Son accès à OffiPlan n’est pas modifié."
      />

      <FormError>{error}</FormError>
      <div className="form-actions">
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Annuler</button>}
        <button type="submit" className="btn btn-primary" disabled={busy || !valid || (member && !dirty)}>{busy ? 'Enregistrement…' : submitLabel}</button>
      </div>
    </form>
  );
}
