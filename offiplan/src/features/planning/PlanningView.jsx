import { useState } from 'react';
import {
  CalendarDays, Check, CheckCircle2, CircleAlert, History, Printer, RefreshCw, Send, Sparkles, Undo2, Wrench,
} from 'lucide-react';
import { api } from '../../services/api.js';
import { Link, navigate } from '../../router.jsx';
import { useResource, useWorkspace } from '../../state/workspace.jsx';
import { useAction, useToast } from '../../state/toasts.jsx';
import { coverage, findIssues, plannedHours, totalNeededHours } from '../../domain/schedule.js';
import { formatHours, formatTimestamp, formatWeekRange } from '../../lib/dates.js';
import { REQUEST_TYPE_LABELS, VERSION_SOURCES, plural, shortNames } from '../../lib/labels.js';
import { ConfirmDialog } from '../../components/Modal.jsx';
import { Avatar, Badge, Callout, Card, EmptyState, Loader, PageHeader, WeekSwitcher } from '../../components/ui.jsx';
import { PeopleGrid, ScheduleGrid } from './ScheduleGrid.jsx';
import SlotEditor from './SlotEditor.jsx';
import { describeIssue } from './issues.js';

export default function PlanningView({ weekStart }) {
  const workspace = useWorkspace();
  const notify = useToast();
  const [run, busy] = useAction();
  const plan = useResource(() => api.plan(weekStart), [weekStart, workspace.revision]);
  const team = useResource(() => api.team(), [workspace.revision]);
  const [view, setView] = useState('posts');
  const [editor, setEditor] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [showAllIssues, setShowAllIssues] = useState(false);

  const header = (
    <PageHeader
      eyebrow="Planning de l’équipe"
      title={`Semaine du ${formatWeekRange(weekStart)}`}
      actions={<WeekSwitcher weekStart={weekStart} onChange={(next) => navigate(`/planning/${next}`)} />}
    />
  );
  if (plan.error) return <>{header}<Callout tone="danger" title="Planning indisponible">{plan.error.message}</Callout></>;
  if (!plan.data || !team.data) return <>{header}<Loader /></>;

  const data = plan.data;
  const members = team.data.members;
  const version = data.draft || data.published;
  const isDraft = Boolean(data.draft);
  const people = new Map(members.map((member) => [member.id, member]));
  const issues = version ? findIssues(version.schedule, { layout: version.layout, staff: members, absences: data.absences }) : [];
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const stats = version ? coverage(version.schedule) : null;
  const hours = version ? plannedHours(version.schedule, version.layout.slots) : {};
  const layoutChanged = version && JSON.stringify(version.layout.slots) !== JSON.stringify(data.layout.slots);
  const context = { people, activityById: workspace.activityById, layout: version?.layout || data.layout };

  async function act(action, options) {
    const result = await run(action, options);
    if (result.ok) await workspace.refresh();
    return result;
  }

  async function saveSchedule(schedule) {
    const result = await act(() => api.saveDraft(weekStart, schedule), { errorTitle: 'Modification non enregistrée' });
    if (!result.ok) return;
    setEditor(null);
    if (!isDraft) notify({ title: `Brouillon v${result.value.draft.number} créé`, message: 'La version publiée reste visible par l’équipe jusqu’à la prochaine publication.' });
  }

  async function generate() {
    setDialog(null);
    await act(() => api.generatePlan(weekStart), { success: { title: 'Proposition prête', message: 'Vérifiez les points signalés, ajustez si besoin, puis publiez.' } });
  }

  async function publish() {
    const result = await act(() => api.publishPlan(weekStart, data.draft.id));
    setDialog(null);
    if (result.ok) notify({ title: `Planning publié (v${data.draft.number})`, message: 'Chaque collaborateur le voit maintenant dans son espace.' });
  }

  async function repair() {
    const result = await act(() => api.repairPlan(weekStart), { errorTitle: 'Correction impossible' });
    if (!result.ok) return;
    const { removed, added } = result.value;
    notify(removed || added
      ? { title: 'Planning corrigé', message: `${plural(removed, 'affectation retirée', 'affectations retirées')}, ${plural(added, 'remplacement trouvé', 'remplacements trouvés')}.` }
      : { title: 'Rien à corriger automatiquement', message: 'Les manques restants n’ont pas de remplaçant disponible.' });
  }

  async function discard() {
    const result = await act(() => api.discardDraft(weekStart));
    setDialog(null);
    if (result.ok) notify({ title: 'Brouillon abandonné', message: 'Il reste disponible dans l’historique des versions.' });
  }

  async function restore(versionToRestore) {
    await act(() => api.restoreVersion(weekStart, versionToRestore.id), { success: { title: `Version v${versionToRestore.number} restaurée en brouillon` } });
  }

  function openIssue(issue) {
    if (issue.slotId) setEditor({ dayIndex: issue.dayIndex, slotId: issue.slotId, activityId: issue.activityId });
    else setView('people');
  }

  return (
    <>
      {header}
      <p className="print-only print-title">{workspace.pharmacy.name} · Planning de la semaine du {formatWeekRange(weekStart)}{version ? ` · version ${version.number}` : ''}</p>
      <WeekSteps data={data} errors={errors.length} warnings={warnings.length} />

      {!version ? (
        <EmptyPlanning data={data} members={members} busy={busy} onGenerate={generate} />
      ) : (
        <>
          <div className="plan-toolbar">
            <div className="plan-status">
              {isDraft ? <Badge tone="amber">Brouillon v{data.draft.number}</Badge> : <Badge tone="green">Publié v{data.published.number}</Badge>}
              <span className="muted">
                {isDraft
                  ? data.published ? `Non visible par l’équipe : elle voit encore la v${data.published.number}.` : 'Non visible par l’équipe tant qu’il n’est pas publié.'
                  : `Visible par l’équipe depuis le ${formatTimestamp(data.published.publishedAt)}.`}
              </span>
            </div>
            <div className="plan-actions">
              <button type="button" className="btn btn-ghost" onClick={() => window.print()}><Printer size={17} /> Imprimer</button>
              {isDraft && data.published && <button type="button" className="btn btn-ghost" onClick={() => setDialog('discard')} disabled={busy}><Undo2 size={17} /> Abandonner</button>}
              <button type="button" className="btn btn-secondary" onClick={() => setDialog('regenerate')} disabled={busy}><RefreshCw size={17} /> Regénérer</button>
              {isDraft && <button type="button" className="btn btn-primary" onClick={() => setDialog('publish')} disabled={busy}><Send size={17} /> Publier</button>}
            </div>
          </div>

          {layoutChanged && (
            <Callout tone="info" title="Les créneaux ont changé depuis cette version" action={<button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog('regenerate')}>Regénérer</button>}>
              Cette version garde les créneaux d’origine. Regénérez la proposition pour utiliser les nouveaux.
            </Callout>
          )}
          {errors.length > 0 && (
            <Callout
              tone="danger"
              icon={CircleAlert}
              title={`${plural(errors.length, 'affectation impossible', 'affectations impossibles')}`}
              action={<button type="button" className="btn btn-primary btn-sm" onClick={repair} disabled={busy}><Wrench size={16} /> Corriger automatiquement</button>}
            >
              Absence, repos, compétence ou double poste : OffiPlan peut retirer ces affectations et chercher un remplaçant disponible.
            </Callout>
          )}

          <div className="planning-layout">
            <section className="card planning-board" aria-label="Planning de la semaine">
              <div className="board-header">
                <div className="segmented" role="tablist" aria-label="Affichage">
                  <button type="button" role="tab" aria-selected={view === 'posts'} className={view === 'posts' ? 'is-active' : ''} onClick={() => setView('posts')}>Par poste</button>
                  <button type="button" role="tab" aria-selected={view === 'people'} className={view === 'people' ? 'is-active' : ''} onClick={() => setView('people')}>Par personne</button>
                </div>
                <p className="muted small">{view === 'posts' ? 'Cliquez sur un poste pour choisir les personnes.' : 'Cliquez sur un créneau pour le modifier.'}</p>
              </div>
              {view === 'posts' ? (
                <ScheduleGrid version={version} dates={data.dates} activityById={workspace.activityById} names={shortNames(members)} issues={issues} onOpenTask={setEditor} onAddTask={setEditor} />
              ) : (
                <PeopleGrid version={version} dates={data.dates} members={members} activityById={workspace.activityById} hours={hours} absences={data.absences} onOpenTask={setEditor} />
              )}
            </section>

            <aside className="planning-aside">
              <Card title="Couverture des besoins">
                <p className="big-number">{stats.percent ?? 100}<small>%</small></p>
                <div className="progress" role="progressbar" aria-valuenow={stats.percent ?? 100} aria-valuemin={0} aria-valuemax={100} aria-label="Couverture des besoins">
                  <span style={{ width: `${stats.percent ?? 100}%` }} />
                </div>
                <p className="muted small">{stats.covered} places pourvues sur {stats.needed}{stats.missing ? ` · ${stats.missing} à pourvoir` : ''}</p>
              </Card>

              <Card title="Points à vérifier" actions={<Badge tone={errors.length ? 'coral' : warnings.length ? 'amber' : 'green'}>{issues.length}</Badge>}>
                {issues.length ? (
                  <>
                    <ul className="issue-list">
                      {[...errors, ...warnings].slice(0, showAllIssues ? undefined : 6).map((issue, index) => {
                        const { where, text } = describeIssue(issue, context);
                        return (
                          <li key={`${issue.type}-${index}`}>
                            <button type="button" className={`issue ${issue.severity === 'error' ? 'is-error' : ''}`} onClick={() => openIssue(issue)}>
                              <CircleAlert size={17} aria-hidden="true" />
                              <span>{where && <strong>{where}</strong>}{text}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {issues.length > 6 && (
                      <button type="button" className="link-btn" onClick={() => setShowAllIssues((value) => !value)}>
                        {showAllIssues ? 'Afficher moins' : `Afficher les ${issues.length} points`}
                      </button>
                    )}
                  </>
                ) : <p className="ok-line"><CheckCircle2 size={18} aria-hidden="true" /> Aucun point à vérifier.</p>}
              </Card>

              {data.absences.length > 0 && (
                <Card title="Absences de la semaine">
                  <ul className="plain-list">
                    {groupAbsences(data.absences).map((absence) => (
                      <li key={absence.requestId}>
                        <strong>{people.get(absence.employeeId)?.name || 'Personne retirée'}</strong>
                        <span className="muted small">{REQUEST_TYPE_LABELS[absence.type]} · {absence.days}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              <Card title="Heures planifiées">
                <ul className="hours-list">
                  {members.filter((member) => !member.archived && member.schedulable).map((member) => {
                    const planned = hours[member.id] || 0;
                    const ratio = member.weeklyHours ? Math.min(100, (planned / member.weeklyHours) * 100) : null;
                    return (
                      <li key={member.id}>
                        <Avatar name={member.name} size="xs" />
                        <span className="hours-name">{member.name}</span>
                        <span className={`hours-value ${member.weeklyHours != null && planned > member.weeklyHours ? 'is-over' : ''}`}>
                          {formatHours(planned)}{member.weeklyHours != null && <small> / {formatHours(member.weeklyHours)}</small>}
                        </span>
                        {ratio !== null && <span className="hours-bar"><span style={{ width: `${ratio}%` }} /></span>}
                      </li>
                    );
                  })}
                </ul>
              </Card>

              <Card title="Historique" actions={<History size={18} className="muted" aria-hidden="true" />}>
                <ul className="history-list">
                  {data.history.map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>v{item.number}</strong>
                        {item.status === 'draft' && <Badge tone="amber">Brouillon</Badge>}
                        {item.status === 'published' && <Badge tone="green">Publiée</Badge>}
                        <p className="muted small">
                          {item.restoredFrom ? `Restaurée depuis la v${item.restoredFrom}` : VERSION_SOURCES[item.source]}
                          {item.edited && item.source !== 'edited' ? ', modifiée' : ''} · {formatTimestamp(item.updatedAt)}
                        </p>
                      </div>
                      {item.status === 'archived' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => restore(item)} disabled={busy}>Restaurer</button>}
                    </li>
                  ))}
                </ul>
              </Card>
            </aside>
          </div>
        </>
      )}

      {editor && version && (
        <SlotEditor
          target={editor}
          version={version}
          dates={data.dates}
          members={members}
          activities={workspace.activeActivities}
          activityById={workspace.activityById}
          absences={data.absences}
          hours={hours}
          busy={busy}
          onSave={saveSchedule}
          onClose={() => setEditor(null)}
        />
      )}

      {dialog === 'publish' && data.draft && (
        <ConfirmDialog title={`Publier la version ${data.draft.number} ?`} confirmLabel="Publier pour l’équipe" busy={busy} onConfirm={publish} onCancel={() => setDialog(null)}>
          <ul className="publish-summary">
            <li><Check size={18} aria-hidden="true" /> {stats.percent ?? 100} % des besoins couverts ({stats.covered} / {stats.needed} places)</li>
            <li className={errors.length ? 'is-error' : ''}><CircleAlert size={18} aria-hidden="true" /> {errors.length ? plural(errors.length, 'affectation impossible', 'affectations impossibles') : 'Aucune affectation impossible'}</li>
            <li><CalendarDays size={18} aria-hidden="true" /> {plural(warnings.length, 'point à vérifier', 'points à vérifier')}</li>
          </ul>
          {errors.length > 0 && <Callout tone="warning">Nous vous conseillons de corriger les affectations impossibles avant de publier.</Callout>}
          <p>Chaque collaborateur verra ses créneaux dans son espace personnel{data.published ? `, à la place de la version ${data.published.number}` : ''}.</p>
        </ConfirmDialog>
      )}
      {dialog === 'regenerate' && (
        <ConfirmDialog title="Regénérer une proposition ?" confirmLabel="Regénérer" busy={busy} onConfirm={generate} onCancel={() => setDialog(null)}>
          <p>OffiPlan repart des besoins, de l’équipe et des absences actuels pour proposer une nouvelle répartition.</p>
          <p className="muted">
            {isDraft ? `Le brouillon v${data.draft.number} sera remplacé mais restera disponible dans l’historique.` : 'La version publiée reste visible par l’équipe jusqu’à la prochaine publication.'}
          </p>
        </ConfirmDialog>
      )}
      {dialog === 'discard' && data.draft && data.published && (
        <ConfirmDialog title={`Abandonner le brouillon v${data.draft.number} ?`} confirmLabel="Abandonner le brouillon" tone="danger" busy={busy} onConfirm={discard} onCancel={() => setDialog(null)}>
          <p>Vous revenez à la version publiée v{data.published.number}. Le brouillon reste disponible dans l’historique.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

function groupAbsences(absences) {
  const groups = new Map();
  absences.forEach((absence) => {
    const group = groups.get(absence.requestId) || { ...absence, dayIndexes: [] };
    group.dayIndexes.push(absence.dayIndex);
    groups.set(absence.requestId, group);
  });
  const shortDays = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
  const periods = { full: '', morning: ' matin', afternoon: ' après-midi' };
  return [...groups.values()].map((group) => ({ ...group, days: `${group.dayIndexes.map((day) => shortDays[day]).join(', ')}${periods[group.period]}` }));
}

function WeekSteps({ data, errors, warnings }) {
  const version = data.draft || data.published;
  const published = data.published && !data.draft;
  const steps = [
    { title: 'Proposer', done: Boolean(version), text: version ? `Version ${version.number} prête` : 'Générer une proposition' },
    {
      title: 'Vérifier',
      done: Boolean(version) && errors === 0,
      text: !version ? 'Contrôler les points signalés' : errors ? `${errors} à corriger` : warnings ? `${plural(warnings, 'point', 'points')} à relire` : 'Rien à signaler',
    },
    {
      title: 'Publier',
      done: published,
      text: published ? 'Visible par l’équipe' : data.published ? `Brouillon en cours (v${data.published.number} visible)` : 'Partager avec l’équipe',
    },
  ];
  const current = steps.findIndex((step) => !step.done);
  return (
    <ol className="week-steps" aria-label="Avancement du planning de la semaine">
      {steps.map((step, index) => (
        <li key={step.title} className={step.done ? 'is-done' : index === current ? 'is-current' : ''}>
          <span className="step-dot">{step.done ? <Check size={14} aria-hidden="true" /> : index + 1}</span>
          <span><strong>{step.title}</strong><small>{step.text}</small></span>
        </li>
      ))}
    </ol>
  );
}

function EmptyPlanning({ data, members, busy, onGenerate }) {
  const neededHours = totalNeededHours(data.needs, data.layout);
  const planned = members.filter((member) => !member.archived && member.schedulable);
  const ready = neededHours > 0 && planned.length > 0;
  return (
    <section className="card">
      <EmptyState
        icon={Sparkles}
        title="Aucun planning pour cette semaine"
        actions={<button type="button" className="btn btn-primary btn-lg" onClick={onGenerate} disabled={busy || !ready}><Sparkles size={18} /> Générer une proposition</button>}
      >
        <p>OffiPlan répartit l’équipe selon les besoins, les compétences, les repos et les absences validées. Vous pourrez tout ajuster avant de publier.</p>
        <ul className="readiness">
          <li className={neededHours ? 'is-ok' : 'is-warning'}>
            {neededHours ? <CheckCircle2 size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}
            {neededHours ? `${formatHours(neededHours)} de besoins à couvrir` : <span>Aucun besoin défini · <Link to="/parametres/besoins">les renseigner</Link></span>}
          </li>
          <li className={planned.length ? 'is-ok' : 'is-warning'}>
            {planned.length ? <CheckCircle2 size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}
            {planned.length ? `${plural(planned.length, 'personne disponible', 'personnes disponibles')} pour les plannings` : <span>Personne n’est inclus dans les plannings · <Link to="/equipe">gérer l’équipe</Link></span>}
          </li>
          <li className="is-ok">
            <CheckCircle2 size={18} aria-hidden="true" />
            {data.absences.length ? `${plural(new Set(data.absences.map((absence) => absence.requestId)).size, 'absence validée prise', 'absences validées prises')} en compte` : 'Aucune absence validée cette semaine'}
          </li>
        </ul>
      </EmptyState>
    </section>
  );
}
