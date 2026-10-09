import { ChevronRight, UserPlus, UsersRound } from 'lucide-react';
import { api } from '../../services/api.js';
import { Link } from '../../router.jsx';
import { useResource, useWorkspace } from '../../state/workspace.jsx';
import { plural } from '../../lib/labels.js';
import { Callout, EmptyState, Loader, PageHeader } from '../../components/ui.jsx';
import MemberSummary from './MemberSummary.jsx';

export default function TeamView() {
  const workspace = useWorkspace();
  const team = useResource(() => api.team(), [workspace.revision]);
  const members = (team.data?.members || []).filter((member) => !member.archived);
  const withoutAccess = members.filter((member) => member.access.status === 'none');
  const uncoveredActivities = workspace.activeActivities.filter((activity) => !members.some((member) => member.schedulable && member.skills.includes(activity.id)));

  return (
    <>
      <PageHeader
        eyebrow="Équipe"
        title="Les personnes de l’officine"
        description="Leurs postes, leurs repos et leur accès à OffiPlan. Cliquez sur une personne pour modifier sa fiche ou l’inviter."
        actions={<Link to="/equipe/nouveau" className="btn btn-primary"><UserPlus size={18} /> Ajouter une personne</Link>}
      />
      {!team.data ? <Loader /> : (
        <>
          {uncoveredActivities.length > 0 && (
            <Callout tone="warning" title="Postes sans personne compétente">
              {uncoveredActivities.map((activity) => activity.name).join(', ')} : personne dans l’équipe ne peut tenir ce poste. Ajoutez la compétence à une fiche.
            </Callout>
          )}
          {withoutAccess.length > 0 && (
            <Callout tone="info" title={`${plural(withoutAccess.length, 'personne n’a', 'personnes n’ont')} pas encore accès à son planning`}>
              Ouvrez sa fiche pour créer un lien d’invitation personnel.
            </Callout>
          )}
          {members.length ? (
            <ul className="team-list">
              {members.map((member) => (
                <li key={member.id}>
                  <Link to={`/equipe/${member.id}`} className="card team-card">
                    <MemberSummary member={member} activityById={workspace.activityById} isSelf={member.id === workspace.membership.employeeId} showAccess />
                    <ChevronRight size={20} className="team-card-arrow" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <section className="card">
              <EmptyState icon={UsersRound} title="Votre équipe commence ici" actions={<Link to="/equipe/nouveau" className="btn btn-primary"><UserPlus size={18} /> Ajouter une personne</Link>}>
                <p>Ajoutez chaque personne avec les postes qu’elle peut tenir.</p>
              </EmptyState>
            </section>
          )}
        </>
      )}
    </>
  );
}
