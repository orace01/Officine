import { useState } from 'react';
import { CalendarPlus, Copy, ExternalLink, KeyRound, Link2, ShieldCheck, UserMinus } from 'lucide-react';
import { api } from '../../services/api.js';
import { Redirect, navigate } from '../../router.jsx';
import { useResource, useWorkspace } from '../../state/workspace.jsx';
import { useAction, useToast } from '../../state/toasts.jsx';
import { formatDate, formatDateRange } from '../../lib/dates.js';
import { PERIOD_LABELS, REQUEST_STATUS, REQUEST_TYPE_LABELS } from '../../lib/labels.js';
import { ConfirmDialog } from '../../components/Modal.jsx';
import { Avatar, Badge, Card, Loader, PageHeader } from '../../components/ui.jsx';
import MemberForm from './MemberForm.jsx';
import RequestFormModal from '../requests/RequestFormModal.jsx';
import { ACCESS_LABELS } from './MemberSummary.jsx';

export function NewMemberView() {
  const workspace = useWorkspace();
  const notify = useToast();

  async function create(values) {
    const { member } = await api.addMember(values);
    await workspace.refresh();
    notify({ title: `${member.name} a rejoint l’équipe`, message: 'Vous pouvez maintenant lui envoyer une invitation.' });
    navigate(`/equipe/${member.id}`, { force: true });
  }

  return (
    <>
      <PageHeader back={{ to: '/equipe', label: 'Équipe' }} title="Ajouter une personne" description="Les postes et les repos servent à proposer un planning adapté. Vous pourrez inviter la personne juste après." />
      <div className="narrow">
        <Card>
          <MemberForm activities={workspace.activeActivities} onSubmit={create} onCancel={() => navigate('/equipe')} submitLabel="Ajouter à l’équipe" />
        </Card>
      </div>
    </>
  );
}

export default function MemberView({ memberId }) {
  const workspace = useWorkspace();
  const notify = useToast();
  const [run, busy] = useAction();
  const team = useResource(() => api.team(), [workspace.revision]);
  const requests = useResource(() => api.requests(), [workspace.revision]);
  const [dialog, setDialog] = useState(null);

  if (!team.data) return <Loader />;
  const member = team.data.members.find((item) => item.id === memberId);
  if (!member || member.archived) return <Redirect to="/equipe" />;

  const isSelf = member.id === workspace.membership.employeeId;
  const isOwnerProfile = member.access.status === 'owner';
  const viewerIsOwner = workspace.membership.role === 'owner';
  const canEdit = !isOwnerProfile || viewerIsOwner;
  const canManageAccess = !isOwnerProfile && !isSelf && (member.access.role !== 'manager' || viewerIsOwner);
  const memberRequests = (requests.data?.requests || []).filter((request) => request.employeeId === member.id && request.status !== 'cancelled');

  async function update(values) {
    await api.updateMember(member.id, values);
    await workspace.refresh();
    notify({ title: 'Fiche enregistrée' });
  }

  async function invite(role) {
    const result = await run(() => api.inviteMember(member.id, role), { errorTitle: 'Invitation impossible' });
    if (result.ok) await workspace.refresh();
  }

  async function copy(url) {
    try {
      await navigator.clipboard.writeText(url);
      notify({ title: 'Lien copié', message: 'Ouvrez-le dans une fenêtre de navigation privée ou un autre navigateur pour jouer le rôle de cette personne.' });
    } catch {
      notify({ tone: 'error', title: 'Copie impossible', message: 'Sélectionnez le lien et copiez-le manuellement.' });
    }
  }

  async function revoke() {
    const result = await run(() => api.revokeAccess(member.id), { success: member.access.status === 'invited' ? 'Invitation annulée' : 'Accès retiré' });
    setDialog(null);
    if (result.ok) await workspace.refresh();
  }

  async function remove() {
    const result = await run(() => api.removeMember(member.id), { success: `${member.name} a été retiré·e de l’équipe` });
    if (result.ok) {
      navigate('/equipe', { force: true });
      await workspace.refresh();
    }
  }

  async function createAbsence(values) {
    await api.createRequest({ ...values, employeeId: member.id });
    await workspace.refresh();
    notify({ title: 'Absence enregistrée', message: 'Pensez à vérifier le planning des semaines concernées.' });
  }

  return (
    <>
      <PageHeader
        back={{ to: '/equipe', label: 'Équipe' }}
        title={<span className="title-with-avatar"><Avatar name={member.name} size="lg" />{member.name}</span>}
        description={member.roleTitle}
      />
      <div className="member-layout">
        <Card title="Fiche" description={canEdit ? 'Postes tenus, volume horaire et repos fixes.' : 'Seul le titulaire peut modifier sa propre fiche.'}>
          {canEdit
            ? <MemberForm key={JSON.stringify(member)} member={member} activities={workspace.activeActivities} onSubmit={update} submitLabel="Enregistrer la fiche" />
            : <p className="muted">{member.roleTitle}</p>}
        </Card>

        <div className="member-side">
          <Card title="Accès à Planiflow" actions={<Badge tone={ACCESS_LABELS[member.access.status].tone}>{ACCESS_LABELS[member.access.status].label}</Badge>}>
            {member.access.status === 'owner' && <p className="muted"><ShieldCheck size={16} aria-hidden="true" /> Titulaire de l’officine : accès complet.</p>}
            {member.access.status === 'linked' && (
              <p className="muted">
                <ShieldCheck size={16} aria-hidden="true" /> {member.access.role === 'manager' ? 'Gestionnaire : prépare et publie les plannings.' : 'Collaborateur : consulte son planning publié et dépose ses demandes.'}
              </p>
            )}
            {member.access.status === 'invited' && (
              <div className="invite-box">
                <p>Lien personnel {member.access.role === 'manager' ? 'gestionnaire' : 'collaborateur'}, valable jusqu’au {formatDate(member.access.expiresAt.slice(0, 10), { day: 'numeric', month: 'long' })}. Il ne peut servir qu’une fois.</p>
                <input readOnly value={member.access.url} aria-label="Lien d’invitation" onFocus={(event) => event.target.select()} />
                <div className="button-row">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => copy(member.access.url)}><Copy size={16} /> Copier le lien</button>
                  <a className="btn btn-secondary btn-sm" href={member.access.url} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Ouvrir</a>
                </div>
                <p className="muted small">Envoyez-le à {member.name.split(' ')[0]} par le moyen de votre choix (message, courriel…) : Planiflow ne l’envoie pas automatiquement.</p>
              </div>
            )}
            {member.access.status === 'none' && (
              <>
                <p className="muted">Créez un lien personnel pour que {member.name.split(' ')[0]} consulte son planning et dépose ses demandes d’absence.</p>
                <div className="button-row">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => invite('employee')} disabled={busy}><Link2 size={16} /> Inviter comme collaborateur</button>
                  {viewerIsOwner && <button type="button" className="btn btn-secondary btn-sm" onClick={() => invite('manager')} disabled={busy}><KeyRound size={16} /> Inviter comme gestionnaire</button>}
                </div>
              </>
            )}
            {canManageAccess && ['invited', 'linked'].includes(member.access.status) && (
              <button type="button" className="link-btn danger" onClick={() => setDialog('revoke')}>{member.access.status === 'invited' ? 'Annuler l’invitation' : 'Retirer l’accès'}</button>
            )}
          </Card>

          <Card title="Absences" actions={<button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog('absence')}><CalendarPlus size={16} /> Saisir</button>}>
            {memberRequests.length ? (
              <ul className="plain-list">
                {memberRequests.map((request) => (
                  <li key={request.id}>
                    <span><strong>{REQUEST_TYPE_LABELS[request.type]}</strong> · {formatDateRange(request.startDate, request.endDate)}</span>
                    <span className="muted small">{PERIOD_LABELS[request.period]} · <Badge tone={REQUEST_STATUS[request.status].tone}>{REQUEST_STATUS[request.status].label}</Badge></span>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Aucune absence enregistrée.</p>}
          </Card>

          {!isOwnerProfile && !isSelf && (
            <section className="card danger-zone compact">
              <div>
                <h2>Retirer de l’équipe</h2>
                <p className="muted small">La personne n’apparaîtra plus dans les nouveaux plannings et perdra son accès. Les plannings passés la conservent.</p>
              </div>
              <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => setDialog('remove')}><UserMinus size={16} /> Retirer</button>
            </section>
          )}
        </div>
      </div>

      {dialog === 'revoke' && (
        <ConfirmDialog title={member.access.status === 'invited' ? 'Annuler l’invitation ?' : `Retirer l’accès de ${member.name} ?`} confirmLabel="Confirmer" tone="danger" busy={busy} onConfirm={revoke} onCancel={() => setDialog(null)}>
          <p>{member.access.status === 'invited' ? 'Le lien envoyé ne fonctionnera plus.' : 'Cette personne ne pourra plus consulter son planning. Sa fiche et ses affectations restent en place.'}</p>
        </ConfirmDialog>
      )}
      {dialog === 'remove' && (
        <ConfirmDialog title={`Retirer ${member.name} de l’équipe ?`} confirmLabel="Retirer de l’équipe" tone="danger" busy={busy} onConfirm={remove} onCancel={() => setDialog(null)}>
          <p>Ses affectations dans les brouillons en cours seront signalées comme à corriger. Son accès à Planiflow est retiré.</p>
        </ConfirmDialog>
      )}
      {dialog === 'absence' && <RequestFormModal title={`Absence de ${member.name}`} onClose={() => setDialog(null)} onSubmit={createAbsence} managerEntry />}
    </>
  );
}
