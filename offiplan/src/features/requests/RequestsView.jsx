import { useId, useState } from 'react';
import { CalendarPlus, Check, Inbox, MessageSquareText, X } from 'lucide-react';
import { api } from '../../services/api.js';
import { Link, useQuery } from '../../router.jsx';
import { useResource, useWorkspace } from '../../state/workspace.jsx';
import { useAction, useToast } from '../../state/toasts.jsx';
import { formatDateRange, formatTimestamp, formatWeekRange, weekStartOf } from '../../lib/dates.js';
import { PERIOD_LABELS, REQUEST_STATUS, REQUEST_TYPE_LABELS } from '../../lib/labels.js';
import Modal, { ConfirmDialog } from '../../components/Modal.jsx';
import { Avatar, Badge, EmptyState, Loader, PageHeader } from '../../components/ui.jsx';
import RequestFormModal from './RequestFormModal.jsx';

const FILTERS = [
  { id: 'pending', label: 'À traiter' },
  { id: 'approved', label: 'Acceptées' },
  { id: 'refused', label: 'Refusées' },
  { id: 'all', label: 'Toutes' },
];

export default function RequestsView() {
  const workspace = useWorkspace();
  const notify = useToast();
  const [run, busy] = useAction();
  const manager = workspace.isManager;
  const requests = useResource(() => api.requests(), [workspace.revision]);
  const team = useResource(() => (manager ? api.team() : Promise.resolve(null)), [workspace.revision, manager]);
  const query = useQuery();
  const [filter, setFilter] = useState(manager ? 'pending' : 'all');
  const [dialog, setDialog] = useState(() => (query.has('nouvelle') ? { type: 'create' } : null));

  const list = requests.data?.requests || [];
  const counts = Object.fromEntries(FILTERS.map(({ id }) => [id, id === 'all' ? list.length : list.filter((request) => request.status === id).length]));
  const visible = list.filter((request) => filter === 'all' || request.status === filter);
  const members = (team.data?.members || []).filter((member) => !member.archived);

  async function act(action, options) {
    const result = await run(action, options);
    if (result.ok) await workspace.refresh();
    return result;
  }

  async function approve(request) {
    const week = weekStartOf(request.startDate);
    await act(() => api.reviewRequest(request.id, 'approved'), {
      success: {
        title: `Demande de ${request.employeeName} acceptée`,
        message: `Vérifiez le planning de la semaine du ${formatWeekRange(week)}.`,
        action: { label: 'Ouvrir le planning', to: `/planning/${week}` },
      },
    });
  }

  async function refuse(request, note) {
    const result = await act(() => api.reviewRequest(request.id, 'refused', note), { success: 'Demande refusée' });
    if (result.ok) setDialog(null);
  }

  async function cancel(request) {
    const result = await act(() => api.cancelRequest(request.id), { success: manager ? 'Absence annulée' : 'Demande annulée' });
    if (result.ok) setDialog(null);
  }

  async function create(values) {
    await api.createRequest(values);
    await workspace.refresh();
    notify(manager
      ? { title: 'Absence enregistrée', message: 'Elle est prise en compte dans les prochaines propositions de planning.' }
      : { title: 'Demande envoyée', message: 'Vous serez informé·e ici de la décision du titulaire.' });
  }

  return (
    <>
      <PageHeader
        eyebrow={manager ? 'Absences et disponibilités' : 'Mon espace'}
        title={manager ? 'Demandes d’absence' : 'Mes demandes'}
        description={manager
          ? 'Acceptez ou refusez les demandes de l’équipe, puis vérifiez le planning des semaines concernées.'
          : 'Déclarez un congé, une indisponibilité ou une formation et suivez la réponse du titulaire.'}
        actions={(
          <button type="button" className="btn btn-primary" onClick={() => setDialog({ type: 'create' })} disabled={manager && !members.length}>
            <CalendarPlus size={18} /> {manager ? 'Saisir une absence' : 'Nouvelle demande'}
          </button>
        )}
      />

      {manager && (
        <div className="segmented filter-tabs" role="tablist" aria-label="Filtrer les demandes">
          {FILTERS.map((item) => (
            <button type="button" role="tab" key={item.id} aria-selected={filter === item.id} className={filter === item.id ? 'is-active' : ''} onClick={() => setFilter(item.id)}>
              {item.label}<span className="count">{counts[item.id]}</span>
            </button>
          ))}
        </div>
      )}

      {!requests.data ? <Loader /> : visible.length ? (
        <ul className="request-list">
          {visible.map((request) => {
            const status = REQUEST_STATUS[request.status];
            const week = weekStartOf(request.startDate);
            return (
              <li key={request.id} className="card request-card">
                <div className="request-main">
                  {manager && <Avatar name={request.employeeName} />}
                  <div className="request-text">
                    <div className="request-title">
                      <strong>{manager ? request.employeeName : REQUEST_TYPE_LABELS[request.type]}</strong>
                      {manager && <Badge>{REQUEST_TYPE_LABELS[request.type]}</Badge>}
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    <p>{formatDateRange(request.startDate, request.endDate)} · {PERIOD_LABELS[request.period].toLowerCase()}</p>
                    {request.note && <p className="request-note"><MessageSquareText size={15} aria-hidden="true" /> {request.note}</p>}
                    {request.reviewNote && <p className="request-note"><MessageSquareText size={15} aria-hidden="true" /> Réponse : {request.reviewNote}</p>}
                    <p className="muted small">
                      Envoyée le {formatTimestamp(request.createdAt)}{request.createdByName && request.createdByName !== request.employeeName ? ` par ${request.createdByName}` : ''}
                      {request.reviewedAt && request.status !== 'pending' && request.reviewedAt !== request.createdAt ? ` · traitée le ${formatTimestamp(request.reviewedAt)}` : ''}
                    </p>
                  </div>
                </div>
                <div className="request-actions">
                  {manager && request.status === 'pending' && (
                    <>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog({ type: 'refuse', request })} disabled={busy}><X size={16} /> Refuser</button>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => approve(request)} disabled={busy}><Check size={16} /> Accepter</button>
                    </>
                  )}
                  {manager && request.status === 'approved' && (
                    <>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ type: 'cancel', request })} disabled={busy}>Annuler l’absence</button>
                      <Link to={`/planning/${week}`} className="btn btn-secondary btn-sm">Planning du {formatWeekRange(week)}</Link>
                    </>
                  )}
                  {!manager && request.status === 'pending' && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ type: 'cancel', request })} disabled={busy}>Annuler la demande</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <section className="card">
          <EmptyState icon={Inbox} title={filter === 'pending' ? 'Aucune demande à traiter' : 'Aucune demande ici'}>
            <p>{manager ? 'Les demandes déposées par l’équipe apparaîtront ici.' : 'Vos demandes d’absence et leur réponse apparaîtront ici.'}</p>
          </EmptyState>
        </section>
      )}

      {dialog?.type === 'create' && (
        <RequestFormModal title={manager ? 'Saisir une absence' : 'Nouvelle demande d’absence'} members={manager ? members : null} managerEntry={manager} onSubmit={create} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'refuse' && <RefuseDialog request={dialog.request} busy={busy} onConfirm={refuse} onCancel={() => setDialog(null)} />}
      {dialog?.type === 'cancel' && (
        <ConfirmDialog title={manager ? 'Annuler cette absence ?' : 'Annuler cette demande ?'} confirmLabel="Annuler la demande" tone="danger" busy={busy} onConfirm={() => cancel(dialog.request)} onCancel={() => setDialog(null)}>
          <p>{manager ? 'La personne redeviendra disponible sur ces dates pour les prochaines propositions de planning.' : 'Le titulaire ne verra plus cette demande.'}</p>
        </ConfirmDialog>
      )}
    </>
  );
}

function RefuseDialog({ request, busy, onConfirm, onCancel }) {
  const [note, setNote] = useState('');
  const noteId = useId();
  return (
    <Modal
      title={`Refuser la demande de ${request.employeeName} ?`}
      description={`${REQUEST_TYPE_LABELS[request.type]} · ${formatDateRange(request.startDate, request.endDate)}`}
      onClose={onCancel}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Retour</button>
          <button type="button" className="btn btn-danger" onClick={() => onConfirm(request, note)} disabled={busy}>Refuser la demande</button>
        </>
      )}
    >
      <div className="field">
        <label htmlFor={noteId}>Motif <span className="field-optional">facultatif</span></label>
        <textarea id={noteId} rows={3} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ex. Deux personnes sont déjà absentes ce jour-là." />
        <p className="field-hint">Le motif est visible par la personne concernée.</p>
      </div>
    </Modal>
  );
}
