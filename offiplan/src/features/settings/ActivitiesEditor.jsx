import { useId, useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '../../services/api.js';
import { useWorkspace } from '../../state/workspace.jsx';
import { useAction } from '../../state/toasts.jsx';
import { ACTIVITY_SUGGESTIONS, MAX_ACTIVITIES } from '../../domain/defaults.js';
import { ConfirmDialog } from '../../components/Modal.jsx';
import { FormError } from '../../components/ui.jsx';

// Les modifications de postes sont enregistrées immédiatement, ligne par ligne.
export default function ActivitiesEditor() {
  const workspace = useWorkspace();
  const activities = workspace.activeActivities;
  const [run, busy] = useAction();
  const [name, setName] = useState('');
  const [addError, setAddError] = useState('');
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const inputId = useId();
  const names = new Set(activities.map((activity) => activity.name.toLocaleLowerCase('fr')));
  const suggestions = ACTIVITY_SUGGESTIONS.filter((suggestion) => !names.has(suggestion.toLocaleLowerCase('fr')));
  const full = activities.length >= MAX_ACTIVITIES;

  async function add(value) {
    setAddError('');
    try {
      await api.addActivity(value);
      setName('');
      await workspace.refresh();
    } catch (failure) {
      setAddError(failure.message);
    }
  }

  async function rename(event) {
    event.preventDefault();
    const result = await run(() => api.renameActivity(editing.id, editing.name), { errorTitle: 'Renommage impossible' });
    if (result.ok) {
      setEditing(null);
      await workspace.refresh();
    }
  }

  async function confirmRemove() {
    const result = await run(() => api.removeActivity(removing.id), { success: `« ${removing.name} » a été retiré`, errorTitle: 'Suppression impossible' });
    setRemoving(null);
    if (result.ok) await workspace.refresh();
  }

  return (
    <div className="form-stack">
      <section className="card form-card">
        <ul className="activity-list">
          {activities.map((activity) => (
            <li key={activity.id} className="activity-row" data-color={activity.color}>
              <span className="swatch swatch-lg" aria-hidden="true" />
              {editing?.id === activity.id ? (
                <form className="activity-rename" onSubmit={rename}>
                  <input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} aria-label={`Nouveau nom pour ${activity.name}`} maxLength={60} autoFocus />
                  <button type="submit" className="icon-btn" aria-label="Enregistrer le nom" disabled={busy || editing.name.trim().length < 2}><Check size={18} /></button>
                  <button type="button" className="icon-btn" aria-label="Annuler" onClick={() => setEditing(null)}><X size={18} /></button>
                </form>
              ) : (
                <>
                  <span className="activity-name">{activity.name}</span>
                  <button type="button" className="icon-btn" aria-label={`Renommer ${activity.name}`} onClick={() => setEditing({ id: activity.id, name: activity.name })}><Pencil size={17} /></button>
                  <button type="button" className="icon-btn" aria-label={`Retirer ${activity.name}`} disabled={activities.length <= 1} onClick={() => setRemoving(activity)}><Trash2 size={17} /></button>
                </>
              )}
            </li>
          ))}
        </ul>

        <form className="inline-add" onSubmit={(event) => { event.preventDefault(); add(name); }}>
          <label htmlFor={inputId} className="sr-only">Nom du nouveau poste</label>
          <input id={inputId} value={name} onChange={(event) => setName(event.target.value)} placeholder="Nom d’un nouveau poste" maxLength={60} disabled={full} />
          <button type="submit" className="btn btn-secondary" disabled={full || name.trim().length < 2}><Plus size={18} /> Ajouter</button>
        </form>
        <FormError>{addError}</FormError>

        {suggestions.length > 0 && !full && (
          <div className="suggestions">
            <span>Suggestions :</span>
            {suggestions.map((suggestion) => (
              <button type="button" className="chip chip-sm" key={suggestion} onClick={() => add(suggestion)}><Plus size={14} aria-hidden="true" /> {suggestion}</button>
            ))}
          </div>
        )}
      </section>

      {removing && (
        <ConfirmDialog title={`Retirer « ${removing.name} » ?`} confirmLabel="Retirer le poste" tone="danger" busy={busy} onConfirm={confirmRemove} onCancel={() => setRemoving(null)}>
          <p>Ce poste ne sera plus proposé dans les besoins ni dans les compétences. Les plannings déjà créés le conservent.</p>
          <p className="muted">Si vous l’ajoutez à nouveau plus tard sous le même nom, ses anciens besoins seront retrouvés.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
