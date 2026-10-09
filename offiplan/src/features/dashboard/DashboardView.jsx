import { ArrowRight, CalendarCheck2, CalendarDays, CheckCircle2, CircleAlert, Inbox, UsersRound } from 'lucide-react';
import { api } from '../../services/api.js';
import { Link } from '../../router.jsx';
import { useResource, useWorkspace } from '../../state/workspace.jsx';
import { coverage, findIssues } from '../../domain/schedule.js';
import { addDays, formatDateRange, formatWeekRange, weekStartOf } from '../../lib/dates.js';
import { REQUEST_TYPE_LABELS, firstName, plural } from '../../lib/labels.js';
import { Avatar, Badge, Card, Loader, PageHeader } from '../../components/ui.jsx';

function WeekCard({ label, weekStart, plan, members }) {
  if (!plan) return <Card title={label}><Loader /></Card>;
  const version = plan.draft || plan.published;
  const stats = version && coverage(version.schedule);
  const errors = version ? findIssues(version.schedule, { layout: version.layout, staff: members, absences: plan.absences }).filter((issue) => issue.severity === 'error').length : 0;
  let status = { tone: 'neutral', text: 'Pas encore préparé', action: 'Préparer le planning' };
  if (plan.draft) status = { tone: 'amber', text: `Brouillon v${plan.draft.number} à publier`, action: 'Reprendre le brouillon' };
  else if (plan.published) status = { tone: 'green', text: `Publié · v${plan.published.number}`, action: 'Voir le planning' };

  return (
    <section className="card week-card">
      <header>
        <div>
          <p className="eyebrow">{label}</p>
          <h2>{formatWeekRange(weekStart)}</h2>
        </div>
        <Badge tone={status.tone}>{status.text}</Badge>
      </header>
      {version ? (
        <ul className="week-card-facts">
          <li><CheckCircle2 size={18} aria-hidden="true" /> {stats.percent ?? 100} % des besoins couverts</li>
          <li className={errors ? 'is-error' : ''}>
            {errors ? <CircleAlert size={18} aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />}
            {errors ? `${plural(errors, 'affectation', 'affectations')} à corriger` : 'Aucune affectation impossible'}
          </li>
        </ul>
      ) : <p className="muted">Générez une proposition en un clic, puis ajustez-la avant de la publier.</p>}
      <Link to={`/planning/${weekStart}`} className={`btn ${plan.draft || !version ? 'btn-primary' : 'btn-secondary'}`}>{status.action} <ArrowRight size={17} /></Link>
    </section>
  );
}

export default function DashboardView() {
  const workspace = useWorkspace();
  const thisWeek = weekStartOf();
  const nextWeek = addDays(thisWeek, 7);
  const current = useResource(() => api.plan(thisWeek), [thisWeek, workspace.revision]);
  const upcoming = useResource(() => api.plan(nextWeek), [nextWeek, workspace.revision]);
  const team = useResource(() => api.team(), [workspace.revision]);
  const requests = useResource(() => api.requests(), [workspace.revision]);

  const { pharmacy } = workspace;
  const members = team.data?.members || [];
  const activeMembers = members.filter((member) => !member.archived);
  const withoutAccess = activeMembers.filter((member) => member.access.status === 'none');
  const pending = (requests.data?.requests || []).filter((request) => request.status === 'pending');

  return (
    <>
      <PageHeader eyebrow={pharmacy.name} title={`Bonjour ${firstName(workspace.user.name)}`} description="Voici où en est l’organisation de l’équipe." />

      <div className="dashboard-grid">
        <WeekCard label="Cette semaine" weekStart={thisWeek} plan={current.data} members={members} />
        <WeekCard label="Semaine prochaine" weekStart={nextWeek} plan={upcoming.data} members={members} />
      </div>

      <div className="dashboard-grid">
        <Card title="Demandes à traiter" actions={<Badge tone={pending.length ? 'amber' : 'green'}>{pending.length}</Badge>}>
          {pending.length ? (
            <ul className="plain-list">
              {pending.slice(0, 4).map((request) => (
                <li key={request.id} className="with-avatar">
                  <Avatar name={request.employeeName} size="sm" />
                  <span><strong>{request.employeeName}</strong><span className="muted small">{REQUEST_TYPE_LABELS[request.type]} · {formatDateRange(request.startDate, request.endDate)}</span></span>
                </li>
              ))}
            </ul>
          ) : <p className="ok-line"><Inbox size={18} aria-hidden="true" /> Aucune demande en attente.</p>}
          <Link to="/demandes" className="btn btn-secondary btn-sm">Ouvrir les demandes <ArrowRight size={16} /></Link>
        </Card>

        <Card title="Équipe" actions={<UsersRound size={20} className="muted" aria-hidden="true" />}>
          <ul className="week-card-facts">
            <li><CalendarDays size={18} aria-hidden="true" /> {plural(activeMembers.filter((member) => member.schedulable).length, 'personne incluse', 'personnes incluses')} dans les plannings</li>
            <li className={withoutAccess.length ? 'is-warning' : ''}>
              <CalendarCheck2 size={18} aria-hidden="true" />
              {withoutAccess.length ? `${plural(withoutAccess.length, 'personne', 'personnes')} sans accès à son planning` : 'Tout le monde a accès à son planning'}
            </li>
          </ul>
          <Link to="/equipe" className="btn btn-secondary btn-sm">Gérer l’équipe <ArrowRight size={16} /></Link>
        </Card>
      </div>
    </>
  );
}
