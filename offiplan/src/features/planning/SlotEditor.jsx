import { useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { unavailability, updateTask } from '../../domain/schedule.js';
import { WEEKDAYS, formatDate, formatHours, formatSlot } from '../../lib/dates.js';
import { MAX_NEED } from '../../domain/defaults.js';
import Modal from '../../components/Modal.jsx';
import { ActivityTag, Avatar, Badge, NumberInput } from '../../components/ui.jsx';
import { UNAVAILABILITY_LABELS } from './issues.js';

export default function SlotEditor({ target, version, dates, members, activities, activityById, absences, hours, busy, onSave, onClose }) {
  const { dayIndex, slotId } = target;
  const slot = version.layout.slots.find((item) => item.id === slotId);
  const tasks = version.schedule[dayIndex]?.[slotId] || [];
  const [activityId, setActivityId] = useState(target.activityId || null);
  const existing = tasks.find((task) => task.activityId === activityId);
  const [required, setRequired] = useState(existing?.required ?? 1);
  const [selected, setSelected] = useState(existing?.assignees ?? []);
  const place = `${WEEKDAYS[dayIndex]} ${formatDate(dates[dayIndex], { day: 'numeric', month: 'long' })} · ${formatSlot(slot)}`;

  if (!activityId) {
    const available = activities.filter((activity) => !tasks.some((task) => task.activityId === activity.id));
    return (
      <Modal title="Ajouter un poste" description={place} onClose={onClose}>
        {available.length ? (
          <>
            <p className="muted">Quel poste faut-il tenir sur ce créneau ?</p>
            <div className="choice-list">
              {available.map((activity) => (
                <button type="button" key={activity.id} className="choice-row" onClick={() => { setActivityId(activity.id); setRequired(1); setSelected([]); }}>
                  <ActivityTag activity={activity} />
                </button>
              ))}
            </div>
          </>
        ) : <p className="muted">Tous les postes sont déjà présents sur ce créneau.</p>}
      </Modal>
    );
  }

  const activity = activityById.get(activityId);
  const candidates = members
    .filter((member) => (!member.archived && member.skills.includes(activityId)) || selected.includes(member.id))
    .map((member) => {
      const reason = unavailability(member, dayIndex, slot, absences);
      const elsewhere = tasks.find((task) => task.activityId !== activityId && task.assignees.includes(member.id));
      const skilled = member.skills.includes(activityId);
      const blocked = Boolean(reason || elsewhere || !skilled);
      return { member, reason, elsewhere, skilled, blocked };
    })
    .sort((left, right) => Number(left.blocked) - Number(right.blocked)
      || (hours[left.member.id] || 0) - (hours[right.member.id] || 0)
      || left.member.name.localeCompare(right.member.name, 'fr'));
  const problems = candidates.filter((candidate) => candidate.blocked && selected.includes(candidate.member.id));

  function toggle(id) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function save(changes) {
    onSave(updateTask(version.schedule, dayIndex, slotId, activityId, changes));
  }

  return (
    <Modal
      title={activity?.name || 'Poste supprimé'}
      description={place}
      onClose={onClose}
      size="lg"
      footer={(
        <>
          {existing && (
            <button type="button" className="btn btn-ghost btn-danger-text footer-start" onClick={() => save({ required: 0, assignees: [] })} disabled={busy}>
              <Trash2 size={17} /> Retirer ce poste du créneau
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="btn btn-primary" onClick={() => save({ required, assignees: selected })} disabled={busy || required < 1}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      )}
    >
      <div className="editor-need">
        <div>
          <strong>Personnes nécessaires</strong>
          <p className="muted small">Modifie uniquement ce créneau de cette semaine.</p>
        </div>
        <NumberInput value={required} min={1} max={MAX_NEED} onChange={setRequired} label="Personnes nécessaires" />
      </div>

      <p className="editor-count">
        <strong>{selected.length} / {required}</strong> personne{required > 1 ? 's' : ''} affectée{selected.length > 1 ? 's' : ''}
      </p>

      {candidates.length ? (
        <ul className="choice-list">
          {candidates.map(({ member, reason, elsewhere, skilled, blocked }) => {
            const checked = selected.includes(member.id);
            const planned = hours[member.id] || 0;
            return (
              <li key={member.id}>
                <label className={`choice-row ${blocked ? 'is-blocked' : ''} ${checked ? 'is-checked' : ''}`}>
                  <input type="checkbox" checked={checked} disabled={blocked && !checked} onChange={() => toggle(member.id)} />
                  <Avatar name={member.name} size="sm" />
                  <span className="choice-text">
                    <strong>{member.name}</strong>
                    <small>{formatHours(planned)} planifiées{member.weeklyHours != null ? ` sur ${formatHours(member.weeklyHours)}` : ''}</small>
                  </span>
                  <span className="choice-badges">
                    {reason && <Badge tone="coral">{UNAVAILABILITY_LABELS[reason]}</Badge>}
                    {!reason && !skilled && <Badge tone="coral">Ne tient pas ce poste</Badge>}
                    {!reason && elsewhere && <Badge tone="amber">Déjà sur {activityById.get(elsewhere.activityId)?.name}</Badge>}
                    {!blocked && member.weeklyHours != null && planned >= member.weeklyHours && !checked && <Badge tone="amber">Volume atteint</Badge>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">Personne dans l’équipe ne tient le poste « {activity?.name} ». Ajoutez cette compétence à un profil depuis la page Équipe.</p>
      )}

      {problems.length > 0 && (
        <div className="callout callout-danger">
          <AlertTriangle size={20} className="callout-icon" aria-hidden="true" />
          <div className="callout-body">Décochez {problems.map((problem) => problem.member.name).join(', ')} : cette affectation n’est pas possible.</div>
        </div>
      )}
    </Modal>
  );
}
