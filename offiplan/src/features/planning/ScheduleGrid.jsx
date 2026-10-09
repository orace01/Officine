import { useState } from 'react';
import { Plus } from 'lucide-react';
import { shiftsOf } from '../../domain/schedule.js';
import { COMPACT_SCREEN, useMediaQuery } from '../../state/media.js';
import { WEEKDAYS, WEEKDAYS_SHORT, formatDate, formatHours, formatSlot, formatTime, todayISO } from '../../lib/dates.js';
import { PERIOD_LABELS } from '../../lib/labels.js';
import { Avatar } from '../../components/ui.jsx';

export function visibleDays(version) {
  return version.layout.openDays.flatMap((open, dayIndex) => (open || Object.keys(version.schedule[dayIndex] || {}).length ? [dayIndex] : []));
}

function DayHeader({ dayIndex, date }) {
  return (
    <th scope="col" className={date === todayISO() ? 'is-today' : ''}>
      <span className="day-name"><span className="only-wide">{WEEKDAYS[dayIndex]}</span><span className="only-narrow">{WEEKDAYS_SHORT[dayIndex]}</span></span>
      <span className="day-date">{formatDate(date, { day: 'numeric', month: 'short' })}</span>
    </th>
  );
}

// Contenu d'un créneau pour un jour : les postes à tenir et le bouton d'ajout.
function SlotCell({ version, dayIndex, slot, activityById, names, errorKeys, onOpenTask, onAddTask }) {
  const order = (task) => activityById.get(task.activityId)?.order ?? 999;
  const tasks = [...(version.schedule[dayIndex]?.[slot.id] || [])].sort((left, right) => order(left) - order(right));
  const open = version.layout.openDays[dayIndex];
  const place = `${WEEKDAYS[dayIndex]} ${formatSlot(slot)}`;
  const errorKey = (task, id) => `${dayIndex}|${slot.id}|${task.activityId}|${id}`;
  return (
    <div className="cell">
      {tasks.map((task) => {
        const activity = activityById.get(task.activityId);
        const short = task.assignees.length < task.required;
        const hasError = task.assignees.some((id) => errorKeys.has(errorKey(task, id)));
        return (
          <button
            type="button"
            key={task.activityId}
            className={`task-card ${short ? 'is-short' : ''} ${hasError ? 'has-error' : ''}`}
            data-color={activity?.color}
            onClick={() => onOpenTask({ dayIndex, slotId: slot.id, activityId: task.activityId })}
            aria-label={`${activity?.name || 'Poste supprimé'}, ${place} : ${task.assignees.length} sur ${task.required}. Modifier`}
          >
            <span className="task-head">
              <span className="task-name">{activity?.name || 'Poste supprimé'}</span>
              <span className="task-count">{task.assignees.length}/{task.required}</span>
            </span>
            <span className="task-people">
              {task.assignees.map((id) => (
                <span key={id} className={`person-chip ${errorKeys.has(errorKey(task, id)) ? 'is-error' : ''}`}>{names.get(id) || 'Inconnu'}</span>
              ))}
              {short && <span className="person-chip is-missing">{task.required - task.assignees.length} à pourvoir</span>}
            </span>
          </button>
        );
      })}
      {open && (
        <button type="button" className={`cell-add ${tasks.length ? '' : 'is-empty'}`} onClick={() => onAddTask({ dayIndex, slotId: slot.id })} aria-label={`Ajouter un poste, ${place}`}>
          <Plus size={14} aria-hidden="true" />{!tasks.length && <span>Ajouter</span>}
        </button>
      )}
    </div>
  );
}

// Vue par poste : une ligne par créneau et une colonne par jour ; un jour à la fois sur téléphone.
export function ScheduleGrid({ version, dates, activityById, names, issues, onOpenTask, onAddTask }) {
  const compact = useMediaQuery(COMPACT_SCREEN);
  const days = visibleDays(version);
  const [selectedDay, setSelectedDay] = useState(() => days.find((dayIndex) => dates[dayIndex] === todayISO()) ?? days[0]);
  const errorKeys = new Set(issues.filter((issue) => issue.severity === 'error' && issue.slotId)
    .map((issue) => `${issue.dayIndex}|${issue.slotId}|${issue.activityId}|${issue.employeeId}`));
  const cellProps = { version, activityById, names, errorKeys, onOpenTask, onAddTask };

  if (compact) {
    const day = days.includes(selectedDay) ? selectedDay : days[0];
    return (
      <div className="day-agenda">
        <div className="day-tabs" role="tablist" aria-label="Jour affiché">
          {days.map((dayIndex) => (
            <button type="button" role="tab" key={dayIndex} aria-selected={day === dayIndex} className={`day-tab ${day === dayIndex ? 'is-active' : ''}`} onClick={() => setSelectedDay(dayIndex)}>
              <span className="day-tab-name">{WEEKDAYS_SHORT[dayIndex]}</span>
              <span className="day-tab-count">{formatDate(dates[dayIndex], { day: 'numeric' })}</span>
            </button>
          ))}
        </div>
        <ol className="agenda-slots">
          {version.layout.slots.map((slot) => (
            <li key={slot.id}>
              <span className="agenda-time">{formatSlot(slot)}</span>
              <SlotCell {...cellProps} dayIndex={day} slot={slot} />
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="schedule-scroll">
      <table className="schedule-grid" style={{ '--days': days.length }}>
        <thead>
          <tr>
            <th scope="col" className="corner"><span className="sr-only">Créneau</span></th>
            {days.map((dayIndex) => <DayHeader key={dayIndex} dayIndex={dayIndex} date={dates[dayIndex]} />)}
          </tr>
        </thead>
        <tbody>
          {version.layout.slots.map((slot) => (
            <tr key={slot.id}>
              <th scope="row" className="slot-head"><span>{formatTime(slot.start)}</span><span>{formatTime(slot.end)}</span></th>
              {days.map((dayIndex) => (
                <td key={dayIndex} className={version.layout.openDays[dayIndex] ? '' : 'is-closed'}>
                  <SlotCell {...cellProps} dayIndex={dayIndex} slot={slot} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Vue par personne : une ligne par membre de l'équipe, avec ses créneaux et son total d'heures.
export function PeopleGrid({ version, dates, members, activityById, hours, absences, onOpenTask }) {
  const { schedule, layout } = version;
  const days = visibleDays(version);
  const assigned = new Set(schedule.flatMap((day) => Object.values(day).flatMap((tasks) => tasks.flatMap((task) => task.assignees))));
  const rows = members.filter((member) => (!member.archived && member.schedulable) || assigned.has(member.id));

  return (
    <div className="schedule-scroll">
      <table className="people-grid">
        <thead>
          <tr>
            <th scope="col" className="corner">Personne</th>
            {days.map((dayIndex) => <DayHeader key={dayIndex} dayIndex={dayIndex} date={dates[dayIndex]} />)}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((member) => {
            const shifts = shiftsOf(schedule, layout, member.id);
            const total = hours[member.id] || 0;
            const over = member.weeklyHours != null && total > member.weeklyHours;
            return (
              <tr key={member.id}>
                <th scope="row" className="person-cell">
                  <div className="person-head">
                    <Avatar name={member.name} size="sm" />
                    <span><strong>{member.name}</strong><small>{member.archived ? 'Retiré·e de l’équipe' : member.roleTitle}</small></span>
                  </div>
                </th>
                {days.map((dayIndex) => {
                  const dayShifts = shifts.filter((shift) => shift.dayIndex === dayIndex);
                  const absence = absences.find((item) => item.employeeId === member.id && item.dayIndex === dayIndex);
                  return (
                    <td key={dayIndex}>
                      <div className="cell">
                        {absence && <span className="absence-chip">Absent·e · {PERIOD_LABELS[absence.period].toLowerCase()}</span>}
                        {dayShifts.map((shift) => {
                          const activity = activityById.get(shift.activityId);
                          return (
                            <button type="button" key={`${shift.slot.id}-${shift.activityId}`} className="shift-chip" data-color={activity?.color} onClick={() => onOpenTask({ dayIndex, slotId: shift.slot.id, activityId: shift.activityId })}>
                              <span>{formatSlot(shift.slot)}</span>
                              <strong>{activity?.name || 'Poste supprimé'}</strong>
                            </button>
                          );
                        })}
                        {!dayShifts.length && !absence && <span className="cell-muted">{member.restDays.includes(dayIndex) ? 'Repos' : '—'}</span>}
                      </div>
                    </td>
                  );
                })}
                <td className={`total-cell ${over ? 'is-over' : ''}`}>
                  <strong>{formatHours(total)}</strong>
                  {member.weeklyHours != null && <small>sur {formatHours(member.weeklyHours)}</small>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
