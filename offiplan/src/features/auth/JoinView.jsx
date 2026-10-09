import { useState } from 'react';
import { ArrowRight, Link2Off, MailOpen } from 'lucide-react';
import { api } from '../../services/api.js';
import { Link, navigate } from '../../router.jsx';
import { useResource, useWorkspace } from '../../state/workspace.jsx';
import { formatDate } from '../../lib/dates.js';
import { ROLE_LABELS } from '../../lib/labels.js';
import { Brand, Callout, EmptyState, FormError, Loader } from '../../components/ui.jsx';

// Page ouverte depuis un lien d'invitation : rattachement du profil courant à l'équipe.
export default function JoinView({ token }) {
  const workspace = useWorkspace();
  const invitation = useResource(() => api.invitation(token), [token]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const info = invitation.data;
  const home = workspace.membership ? (workspace.isManager ? '/accueil' : '/mon-planning') : '/';

  async function join() {
    setBusy(true);
    setError('');
    try {
      const result = await api.acceptInvitation(token);
      navigate(result.role === 'employee' ? '/mon-planning' : '/accueil', { replace: true, force: true });
      await workspace.refresh();
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
      await workspace.refresh();
    }
  }

  async function logout() {
    await api.logout();
    await workspace.refresh();
  }

  let content;
  if (!info) {
    content = <Loader label="Vérification du lien…" />;
  } else if (info.state !== 'valid') {
    content = (
      <EmptyState icon={Link2Off} title="Ce lien ne fonctionne plus" actions={<Link to={home} className="btn btn-primary">Retour à l’accueil</Link>}>
        <p>{info.message}</p>
      </EmptyState>
    );
  } else {
    content = (
      <>
        <div className="join-header">
          <span className="settings-icon"><MailOpen size={22} aria-hidden="true" /></span>
          <p className="eyebrow">Invitation</p>
          <h1>{info.pharmacyName} vous invite à rejoindre son équipe</h1>
          <p className="lead">
            Profil : <strong>{info.employeeName}</strong> · accès {ROLE_LABELS[info.role].toLowerCase()}.
            Lien valable jusqu’au {formatDate(info.expiresAt.slice(0, 10))}.
          </p>
        </div>
        {!workspace.membership && (
          <div className="form-stack-tight">
            <p>Vous êtes connecté·e en tant que <strong>{workspace.user.name}</strong>.</p>
            <FormError>{error}</FormError>
            <button type="button" className="btn btn-primary btn-lg btn-block" onClick={join} disabled={busy}>Rejoindre l’équipe <ArrowRight size={18} /></button>
            <button type="button" className="btn btn-ghost btn-block" onClick={logout}>Se déconnecter</button>
          </div>
        )}
        {workspace.membership && (
          <Callout
            tone="warning"
            title={`Vous êtes connecté·e en tant que ${workspace.user.name}`}
            action={<button type="button" className="btn btn-secondary btn-sm" onClick={logout}>Se déconnecter</button>}
          >
            Ce profil fait déjà partie de « {workspace.pharmacy.name} ». Pour accepter l’invitation, déconnectez-vous
            et utilisez un autre profil (ou ouvrez le lien dans un autre onglet).
          </Callout>
        )}
      </>
    );
  }

  return (
    <div className="join">
      <header className="wizard-topbar"><Brand to={home} /></header>
      <main className="join-main" id="contenu">
        <section className="card join-card">{content}</section>
      </main>
    </div>
  );
}
