import { Clock3, Moon } from 'lucide-react';
import { WEEKDAYS_SHORT, formatHours } from '../../lib/dates.js';
import { ActivityTag, Avatar, Badge } from '../../components/ui.jsx';

export const ACCESS_LABELS = {
  owner: { label: 'Titulaire', tone: 'green' },
  linked: { label: 'Accès actif', tone: 'green' },
  invited: { label: 'Invitation envoyée', tone: 'amber' },
  none: { label: 'Sans accès', tone: 'neutral' },
};

export default function MemberSummary({ member, activityById, isSelf = false, showAccess = false }) {
  const access = ACCESS_LABELS[member.access?.status];
  return (
    <div className="member-summary">
      <Avatar name={member.name} />
      <div className="member-summary-body">
        <div className="member-summary-title">
          <strong>{member.name}</strong>
          {isSelf && <Badge tone="blue">Vous</Badge>}
          {!member.schedulable && <Badge>Hors planning</Badge>}
          {showAccess && access && <Badge tone={access.tone}>{member.access.role === 'manager' && member.access.status !== 'owner' ? `${access.label} · gestionnaire` : access.label}</Badge>}
        </div>
        <p className="member-summary-role">{member.roleTitle}</p>
        <div className="member-summary-facts">
          <span><Clock3 size={15} aria-hidden="true" /> {member.weeklyHours == null ? 'Sans limite horaire' : `${formatHours(member.weeklyHours)} / semaine`}</span>
          <span><Moon size={15} aria-hidden="true" /> {member.restDays.length ? `Repos : ${member.restDays.map((day) => WEEKDAYS_SHORT[day]).join(' ')}` : 'Aucun repos fixe'}</span>
        </div>
        {member.skills.length > 0 && (
          <div className="tag-list">
            {member.skills.map((id) => activityById.get(id)).filter((activity) => activity && !activity.archived).map((activity) => <ActivityTag key={activity.id} activity={activity} />)}
          </div>
        )}
      </div>
    </div>
  );
}
