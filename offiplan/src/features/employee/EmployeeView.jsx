import { CalendarClock, CalendarPlus, Coffee, Lock } from 'lucide-react';
import { api } from '../../services/api.js';
import { Link, navigate } from '../../router.jsx';
import { useResource, useWorkspace } from '../../state/workspace.jsx';
import { slotHours } from '../../domain/schedule.js';
import { WEEKDAYS, formatDate, formatHours, formatSlot, formatTimestamp, todayISO } from '../../lib/dates.js';
import { PERIOD_LABELS, REQUEST_TYPE_LABELS, firstName, plural } from '../../lib/labels.js';
import { ActivityTag, Badge, Callout, EmptyState, Loader, PageHeader, WeekSwitcher } from '../../components/ui.jsx';

export default function EmployeeView({ weekStart }) {
  const workspace = useWorkspace();
  const schedule = useResource(() => api.mySchedule(weekStart), [weekStart, workspace.revision]);
  const requests = useResource(() => api.requests(), [workspace.revision]);
  const pending = (requests.data?.requests || []).filter((request) => request.status === 'pending');
  const data = schedule.data;
  const totalHours = data?.shifts.reduce((sum, shift) => sum + slotHours(shift), 0) || 0;

  return (
    <>
      <PageHeader
        eyebrow={workspace.pharmacy.name}
        title={`Bonjour ${firstName(workspace.membership.employeeName)}`}
        description="Votre planning, tel que publié par le titulaire."
        actions={<WeekSwitcher weekStart={weekStart} onChange={(next) => navigate(`/mon-planning/${next}`)} />}
      />

      {pending.length > 0 && (
        <Callout tone="info" title={`${plural(pending.length, 'demande en attente', 'demandes en attente')} de réponse`} action={<Link to="/mes-demandes" className="btn btn-secondary btn-sm">Voir mes demandes</Link>} />
      )}

      {!data ? <Loader /> : !data.published ? (
        <section className="card">
          <EmptyState icon={Lock} title="Pas encore de planning publié pour cette semaine">
            <p>Il apparaîtra ici dès que le titulaire l’aura publié.</p>
          </EmptyState>
        </section>
      ) : (
        <>
          <div className="stat-row">
            <div className="stat"><span className="stat-label">Heures planifiées</span><strong>{formatHours(totalHours)}</strong></div>
            <div className="stat"><span className="stat-label">Créneaux</span><strong>{data.shifts.length}</strong></div>
            <div className="stat"><span className="stat-label">Version</span><strong>v{data.published.number}</strong><small>publiée le {formatTimestamp(data.published.publishedAt)}</small></div>
          </div>
          <ol className="day-list">
            {data.dates.map((date, dayIndex) => {
              const shifts = data.shifts.filter((shift) => shift.dayIndex === dayIndex);
              const absences = data.absences.filter((absence) => absence.dayIndex === dayIndex);
              const open = data.layout.openDays[dayIndex];
              if (!open && !shifts.length) return null;
              const hours = shifts.reduce((sum, shift) => sum + slotHours(shift), 0);
              return (
                <li key={date} className={`card day-card ${date === todayISO() ? 'is-today' : ''} ${shifts.length ? '' : 'is-off'}`}>
                  <header>
                    <div>
                      <strong>{WEEKDAYS[dayIndex]}</strong>
                      <span>{formatDate(date, { day: 'numeric', month: 'long' })}</span>
                    </div>
                    {date === todayISO() && <Badge tone="blue">Aujourd’hui</Badge>}
                    <span className="day-hours">{shifts.length ? formatHours(hours) : 'Repos'}</span>
                  </header>
                  {absences.map((absence) => (
                    <p key={absence.requestId} className="absence-chip">{REQUEST_TYPE_LABELS[absence.type]} · {PERIOD_LABELS[absence.period].toLowerCase()}</p>
                  ))}
                  {shifts.length ? (
                    <ul className="shift-list">
                      {shifts.map((shift) => (
                        <li key={`${shift.slotId}-${shift.activityId}`}>
                          <span className="shift-time"><CalendarClock size={16} aria-hidden="true" /> {formatSlot(shift)}</span>
                          <ActivityTag activity={workspace.activityById.get(shift.activityId)} />
                        </li>
                      ))}
                    </ul>
                  ) : <p className="muted day-off"><Coffee size={16} aria-hidden="true" /> Pas de créneau prévu.</p>}
                </li>
              );
            })}
          </ol>
        </>
      )}

      <section className="card cta-card">
        <div>
          <h2>Une absence à prévoir ?</h2>
          <p className="muted">Congé, indisponibilité ou formation : le titulaire en tiendra compte pour les prochains plannings.</p>
        </div>
        <Link to="/mes-demandes?nouvelle" className="btn btn-secondary"><CalendarPlus size={18} /> Faire une demande</Link>
      </section>
    </>
  );
}
