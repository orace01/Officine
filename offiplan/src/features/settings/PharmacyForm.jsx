import { useId, useState } from 'react';
import { api } from '../../services/api.js';
import { useUnsavedChanges } from '../../router.jsx';
import { useWorkspace } from '../../state/workspace.jsx';
import { Field, FormError } from '../../components/ui.jsx';

export default function PharmacyForm({ pharmacy, onSaved, renderActions }) {
  const workspace = useWorkspace();
  const [values, setValues] = useState({ name: pharmacy?.name || '', city: pharmacy?.city || '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const cityId = useId();
  const dirty = values.name !== (pharmacy?.name || '') || values.city !== (pharmacy?.city || '');
  useUnsavedChanges(dirty && !busy);

  const update = (field) => (event) => setValues((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (pharmacy) await api.updatePharmacy(values);
      else await api.createPharmacy(values);
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
      <div className="card form-card">
        <Field id={nameId} label="Nom de l’officine">
          <input id={nameId} value={values.name} onChange={update('name')} placeholder="Ex. Pharmacie du Marché" autoComplete="organization" required minLength={2} maxLength={120} autoFocus />
        </Field>
        <Field id={cityId} label="Ville" optional hint="Affichée sous le nom de l’officine et sur les plannings imprimés.">
          <input id={cityId} value={values.city} onChange={update('city')} placeholder="Ex. Rennes" autoComplete="address-level2" maxLength={80} />
        </Field>
        <FormError>{error}</FormError>
      </div>
      {renderActions({ busy, dirty, valid: values.name.trim().length >= 2 })}
    </form>
  );
}
