import { useState } from 'react';
import { Pencil, UserPlus } from 'lucide-react';
import { api } from '../../services/api.js';
import { Redirect, navigate } from '../../router.jsx';
import { useResource, useWorkspace } from '../../state/workspace.jsx';
import { useAction } from '../../state/toasts.jsx';
import { SETUP_STEPS } from '../../domain/defaults.js';
import WizardLayout, { WizardFooter, WizardStep } from '../../components/WizardLayout.jsx';
import { Callout, Card, Loader } from '../../components/ui.jsx';
import PharmacyForm from '../settings/PharmacyForm.jsx';
import OpeningForm from '../settings/OpeningForm.jsx';
import ActivitiesEditor from '../settings/ActivitiesEditor.jsx';
import NeedsView from '../needs/NeedsView.jsx';
import MemberForm from '../team/MemberForm.jsx';
import MemberSummary from '../team/MemberSummary.jsx';
import SetupSummary from './SetupSummary.jsx';

// Assistant de première configuration : une étape par page, chacune enregistrée avant de passer à la suivante.
export default function Onboarding({ stepId }) {
  const workspace = useWorkspace();
  const completed = workspace.pharmacy?.setup.completed || [];
  const index = SETUP_STEPS.findIndex((step) => step.id === stepId);
  const firstOpen = SETUP_STEPS.findIndex((step) => !completed.includes(step.id));
  const reachable = firstOpen === -1 ? SETUP_STEPS.length - 1 : firstOpen;
  if (index === -1 || index > reachable) return <Redirect to={`/demarrage/${SETUP_STEPS[reachable].id}`} />;

  const goTo = (id) => navigate(`/demarrage/${id}`, { force: true });
  const next = async () => {
    await api.completeSetupStep(SETUP_STEPS[index].id);
    await workspace.refresh();
    goTo(SETUP_STEPS[index + 1].id);
  };
  const back = index > 0 ? () => goTo(SETUP_STEPS[index - 1].id) : null;
  const props = { onDone: next, onBack: back, eyebrow: `Étape ${index + 1} sur ${SETUP_STEPS.length}` };

  const steps = {
    officine: <PharmacyStep {...props} />,
    jours: <DaysStep {...props} />,
    creneaux: <SlotsStep {...props} />,
    postes: <ActivitiesStep {...props} />,
    besoins: <NeedsStep {...props} />,
    equipe: <TeamStep {...props} />,
    recapitulatif: <SetupSummary {...props} goTo={goTo} />,
  };

  return (
    <WizardLayout steps={SETUP_STEPS} currentIndex={index} completed={completed} onSelect={goTo}>
      {steps[stepId]}
    </WizardLayout>
  );
}

function PharmacyStep({ onDone, eyebrow }) {
  const workspace = useWorkspace();
  return (
    <WizardStep eyebrow={eyebrow} title="Commençons par votre officine" description="Son nom apparaîtra en tête des plannings partagés avec l’équipe et sur les versions imprimées.">
      <PharmacyForm
        pharmacy={workspace.pharmacy}
        onSaved={onDone}
        renderActions={({ busy, valid }) => <WizardFooter busy={busy} disabled={!valid} nextLabel="Enregistrer et continuer" />}
      />
    </WizardStep>
  );
}

function DaysStep({ onDone, onBack, eyebrow }) {
  const workspace = useWorkspace();
  return (
    <WizardStep eyebrow={eyebrow} title="Quels jours l’officine est-elle ouverte ?" description="Le planning ne proposera des postes que ces jours-là. Ce choix est déjà fait pour vous : ajustez-le si besoin.">
      <OpeningForm
        fields="days"
        settings={workspace.pharmacy.settings}
        onSaved={onDone}
        renderActions={({ busy, valid }) => <WizardFooter onBack={onBack} busy={busy} disabled={!valid} nextLabel="Enregistrer et continuer" />}
      />
    </WizardStep>
  );
}

function SlotsStep({ onDone, onBack, eyebrow }) {
  const workspace = useWorkspace();
  return (
    <WizardStep eyebrow={eyebrow} title="Comment est découpée votre journée ?" description="Le planning se remplit créneau par créneau. Choisissez un modèle courant ou composez le vôtre.">
      <OpeningForm
        fields="slots"
        settings={workspace.pharmacy.settings}
        onSaved={onDone}
        renderActions={({ busy, valid }) => <WizardFooter onBack={onBack} busy={busy} disabled={!valid} nextLabel="Enregistrer et continuer" />}
      />
    </WizardStep>
  );
}

function ActivitiesStep({ onDone, onBack, eyebrow }) {
  const workspace = useWorkspace();
  const [run, busy] = useAction();
  return (
    <WizardStep eyebrow={eyebrow} title="Quels postes faut-il tenir ?" description="Un poste correspond à une activité à couvrir pendant un créneau : comptoir, réception des commandes, préparation des piluliers… Gardez ceux qui vous concernent, renommez-les ou ajoutez les vôtres.">
      <ActivitiesEditor />
      <WizardFooter onBack={onBack} busy={busy} disabled={!workspace.activeActivities.length} onNext={() => run(onDone)} />
    </WizardStep>
  );
}

function NeedsStep({ onDone, onBack, eyebrow }) {
  return (
    <WizardStep eyebrow={eyebrow} title="Combien de personnes faut-il ?" description="Un jour à la fois : indiquez le nombre de personnes nécessaires sur chaque poste et chaque créneau, puis passez au jour suivant avec la flèche. Vous pouvez aussi copier un jour type sur les autres.">
      <NeedsView
        onSaved={onDone}
        renderActions={({ busy, valid }) => (
          <WizardFooter onBack={onBack} busy={busy} disabled={!valid} nextLabel="Enregistrer et continuer" hint={valid ? null : 'Indiquez au moins un besoin pour continuer.'} />
        )}
      />
    </WizardStep>
  );
}

function TeamStep({ onDone, onBack, eyebrow }) {
  const workspace = useWorkspace();
  const team = useResource(() => api.team(), [workspace.revision]);
  const [editing, setEditing] = useState(null);
  const [run, busy] = useAction();
  const members = (team.data?.members || []).filter((member) => !member.archived);
  const planned = members.filter((member) => member.schedulable && member.skills.length);

  async function save(values) {
    if (editing === 'new') await api.addMember(values);
    else await api.updateMember(editing, values);
    setEditing(null);
    await workspace.refresh();
  }

  return (
    <WizardStep eyebrow={eyebrow} title="Qui travaille à l’officine ?" description="Ajoutez chaque personne avec les postes qu’elle peut tenir et ses jours de repos fixes. Vous pourrez l’inviter à consulter son planning plus tard, depuis la page Équipe.">
      {!team.data ? <Loader /> : (
        <div className="form-stack">
          <ul className="member-rows">
            {members.map((member) => (
              <li key={member.id} className="card member-row">
                {editing === member.id ? (
                  <MemberForm member={member} activities={workspace.activeActivities} onSubmit={save} onCancel={() => setEditing(null)} />
                ) : (
                  <>
                    <MemberSummary member={member} activityById={workspace.activityById} isSelf={member.id === workspace.membership.employeeId} />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(member.id)} disabled={editing !== null}><Pencil size={16} /> Modifier</button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {editing === 'new' ? (
            <Card title="Nouvelle personne">
              <MemberForm activities={workspace.activeActivities} onSubmit={save} onCancel={() => setEditing(null)} submitLabel="Ajouter à l’équipe" />
            </Card>
          ) : (
            <button type="button" className="add-tile" onClick={() => setEditing('new')} disabled={editing !== null}>
              <UserPlus size={22} aria-hidden="true" />
              <span><strong>Ajouter une personne</strong><small>Pharmacien·ne, préparateur·rice, apprenti·e, rayonniste…</small></span>
            </button>
          )}
          {members.length === 1 && editing === null && (
            <Callout tone="info" title="Vous êtes la seule personne de l’équipe pour l’instant">
              Ajoutez vos collaborateurs pour que le planning se répartisse entre plusieurs personnes.
            </Callout>
          )}
          <WizardFooter
            onBack={onBack}
            busy={busy}
            disabled={!planned.length || editing !== null}
            onNext={() => run(onDone)}
            hint={editing !== null ? 'Enregistrez ou annulez la fiche en cours.' : !planned.length ? 'Au moins une personne doit être incluse dans les plannings.' : null}
          />
        </div>
      )}
    </WizardStep>
  );
}
