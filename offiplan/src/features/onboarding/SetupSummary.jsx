import { useState } from 'react';
import { CheckCircle2, CircleAlert, Pencil, Sparkles } from 'lucide-react';
import { api } from '../../services/api.js';
import { navigate } from '../../router.jsx';
import { useResource, useWorkspace } from '../../state/workspace.jsx';
import { useAction } from '../../state/toasts.jsx';
import { totalNeededHours } from '../../domain/schedule.js';
import { WEEKDAYS_SHORT, addDays, formatHours, formatWeekRange, weekStartOf } from '../../lib/dates.js';
import { plural } from '../../lib/labels.js';
import { WizardFooter, WizardStep } from '../../components/WizardLayout.jsx';
import { ActivityTag, Loader, SlotList } from '../../components/ui.jsx';

function SummaryCard({ title, step, goTo, children }) {
  return (
    <section className="card summary-card">
      <header>
        <h2>{title}</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => goTo(step)}><Pencil size={15} /> Modifier</button>
      </header>
      <div className="summary-card-body">{children}</div>
    </section>
  );
}

export default function SetupSummary({ onBack, goTo, eyebrow }) {
  const workspace = useWorkspace();
  const needs = useResource(() => api.needs(), [workspace.revision]);
  const team = useResource(() => api.team(), [workspace.revision]);
  const [run, busy] = useAction();
  const thisWeek = weekStartOf();
  const nextWeek = addDays(thisWeek, 7);
  const [week, setWeek] = useState(nextWeek);

  if (!needs.data || !team.data) return <Loader />;

  const { pharmacy, activeActivities } = workspace;
  const layout = pharmacy.settings;
  const members = team.data.members.filter((member) => !member.archived);
  const planned = members.filter((member) => member.schedulable);
  const neededHours = totalNeededHours(needs.data.needs, layout);
  const unlimited = planned.some((member) => member.weeklyHours == null);
  const capacity = planned.reduce((sum, member) => sum + (member.weeklyHours || 0), 0);
  const requested = activeActivities.filter((activity) => layout.openDays.some((open, dayIndex) => open
    && layout.slots.some((slot) => Number(needs.data.needs[dayIndex]?.[slot.id]?.[activity.id] || 0) > 0)));
  const uncovered = requested.filter((activity) => !planned.some((member) => member.skills.includes(activity.id)));

  const checks = [
    { ok: neededHours > 0, text: neededHours > 0 ? `${formatHours(neededHours)} de présence à couvrir chaque semaine.` : 'Aucun besoin n’est renseigné.', step: 'besoins' },
    {
      ok: !uncovered.length,
      text: uncovered.length ? `Personne ne sait tenir : ${uncovered.map((activity) => activity.name).join(', ')}.` : 'Chaque poste demandé peut être tenu par au moins une personne.',
      step: 'equipe',
    },
    {
      ok: unlimited || capacity >= neededHours,
      text: unlimited || capacity >= neededHours
        ? 'Le volume horaire de l’équipe suffit à couvrir les besoins.'
        : `L’équipe totalise ${formatHours(capacity)} pour ${formatHours(neededHours)} de besoins : certains créneaux resteront à pourvoir.`,
      step: 'equipe',
    },
  ];

  async function finish({ generate }) {
    const result = await run(async () => {
      if (generate) await api.generatePlan(week);
      await api.finishSetup();
      await workspace.refresh();
    }, generate ? { success: { title: 'Votre premier planning est prêt', message: 'Vérifiez-le, ajustez-le si besoin, puis publiez-le pour l’équipe.' } } : { success: 'Configuration terminée' });
    if (result.ok) navigate(generate ? `/planning/${week}` : '/accueil', { force: true });
  }

  return (
    <WizardStep eyebrow={eyebrow} title="Tout est prêt, vérifions ensemble" description="Relisez votre configuration. Tout reste modifiable plus tard depuis les Paramètres.">
      <div className="summary-grid">
        <SummaryCard title="Officine" step="officine" goTo={goTo}>
          <p className="summary-strong">{pharmacy.name}</p>
          {pharmacy.city && <p className="muted">{pharmacy.city}</p>}
        </SummaryCard>
        <SummaryCard title="Jours" step="jours" goTo={goTo}>
          <p className="summary-strong">{layout.openDays.flatMap((open, index) => (open ? [WEEKDAYS_SHORT[index]] : [])).join(' ')}</p>
        </SummaryCard>
        <SummaryCard title="Créneaux" step="creneaux" goTo={goTo}>
          <p className="muted"><SlotList slots={layout.slots} /></p>
        </SummaryCard>
        <SummaryCard title="Postes" step="postes" goTo={goTo}>
          <div className="tag-list">{activeActivities.map((activity) => <ActivityTag key={activity.id} activity={activity} />)}</div>
        </SummaryCard>
        <SummaryCard title="Besoins" step="besoins" goTo={goTo}>
          <p className="summary-strong">{formatHours(neededHours)} par semaine</p>
          <p className="muted">{plural(requested.length, 'poste demandé', 'postes demandés')}</p>
        </SummaryCard>
        <SummaryCard title="Équipe" step="equipe" goTo={goTo}>
          <p className="summary-strong">{plural(members.length, 'personne')}</p>
          <p className="muted">{plural(planned.length, 'incluse', 'incluses')} dans les plannings</p>
        </SummaryCard>
      </div>

      <section className="card">
        <h2 className="card-title">Vérifications</h2>
        <ul className="check-list">
          {checks.map((check) => (
            <li key={check.text} className={check.ok ? 'is-ok' : 'is-warning'}>
              {check.ok ? <CheckCircle2 size={20} aria-hidden="true" /> : <CircleAlert size={20} aria-hidden="true" />}
              <span>{check.text}</span>
              {!check.ok && <button type="button" className="btn btn-ghost btn-sm" onClick={() => goTo(check.step)}>Corriger</button>}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2 className="card-title">Pour quelle semaine préparer le premier planning ?</h2>
        <div className="radio-cards">
          {[{ value: thisWeek, label: 'Cette semaine' }, { value: nextWeek, label: 'La semaine prochaine' }].map((option) => (
            <label key={option.value} className={`radio-card ${week === option.value ? 'is-selected' : ''}`}>
              <input type="radio" name="first-week" value={option.value} checked={week === option.value} onChange={() => setWeek(option.value)} />
              <span><strong>{option.label}</strong><small>{formatWeekRange(option.value)}</small></span>
            </label>
          ))}
        </div>
      </section>

      <WizardFooter onBack={onBack} busy={busy} disabled={neededHours === 0} onNext={() => finish({ generate: true })} nextLabel="Générer mon premier planning" />
      <p className="center muted small">
        <Sparkles size={14} aria-hidden="true" /> Le planning reste un brouillon tant que vous ne l’avez pas publié.{' '}
        <button type="button" className="link-btn" onClick={() => finish({ generate: false })} disabled={busy}>Terminer sans générer</button>
      </p>
    </WizardStep>
  );
}
