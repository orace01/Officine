import { useId, useState } from 'react';
import { ArrowRight, Link2Off, MailCheck, MailOpen } from 'lucide-react';
import { api } from '../../services/api.js';
import { Link, navigate } from '../../router.jsx';
import { useResource, useWorkspace } from '../../state/workspace.jsx';
import { formatDate } from '../../lib/dates.js';
import { ROLE_LABELS } from '../../lib/labels.js';
import { Brand, Callout, EmptyState, Field, FormError, Loader } from '../../components/ui.jsx';

// Page ouverte depuis un lien d'invitation : création de compte (ou connexion) puis rattachement à l'équipe.
export default function JoinView({ token }) {
  const workspace = useWorkspace();
  const invitation = useResource(() => api.invitation(token), [token]);
  const [mode, setMode] = useState('signup');
  const [values, setValues] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const info = invitation.data;
  const form = values || { name: info?.employeeName || '', email: '', password: '' };
  const isSignup = mode === 'signup';
  const home = workspace.membership ? (workspace.isManager ? '/accueil' : '/mon-planning') : '/';

  async function join(event) {
    event?.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (workspace.status === 'anonymous') {
        if (isSignup) {
          const { needsConfirmation } = await api.signup(form);
          if (needsConfirmation) {
            setAwaitingConfirmation(true);
            setBusy(false);
            return;
          }
        } else {
          await api.login(form);
        }
      }
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
        {workspace.status === 'anonymous' && awaitingConfirmation && (
          <Callout tone="success" icon={MailCheck} title="Vérifiez votre boîte de réception">
            Un courriel de confirmation a été envoyé à {form.email}. Cliquez sur le lien qu’il contient, puis revenez sur ce lien d’invitation pour rejoindre l’équipe.
          </Callout>
        )}
        {workspace.status === 'anonymous' && !awaitingConfirmation && (
          <form onSubmit={join} className="form-stack-tight">
            {isSignup && (
              <Field id={nameId} label="Votre nom">
                <input id={nameId} value={form.name} onChange={(event) => setValues({ ...form, name: event.target.value })} autoComplete="name" required minLength={2} />
              </Field>
            )}
            <Field id={emailId} label="Adresse courriel">
              <input id={emailId} type="email" value={form.email} onChange={(event) => setValues({ ...form, email: event.target.value })} autoComplete="email" required autoFocus />
            </Field>
            <Field id={passwordId} label="Mot de passe">
              <input
                id={passwordId} type="password" value={form.password} onChange={(event) => setValues({ ...form, password: event.target.value })}
                autoComplete={isSignup ? 'new-password' : 'current-password'} required minLength={6}
              />
            </Field>
            <FormError>{error}</FormError>
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || (isSignup && form.name.trim().length < 2) || !form.email.trim() || form.password.length < 6}>
              {busy ? 'Un instant…' : 'Rejoindre l’équipe'} {!busy && <ArrowRight size={18} />}
            </button>
            <button type="button" className="link-btn" onClick={() => { setMode(isSignup ? 'login' : 'signup'); setError(''); }}>
              {isSignup ? 'Vous avez déjà un espace ? Se connecter' : 'Pas encore de compte ? Créer un espace'}
            </button>
          </form>
        )}
        {workspace.status === 'ready' && !workspace.membership && (
          <div className="form-stack-tight">
            <p>Vous êtes connecté·e en tant que <strong>{workspace.user.name}</strong>.</p>
            <FormError>{error}</FormError>
            <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => join()} disabled={busy}>Rejoindre l’équipe <ArrowRight size={18} /></button>
            <button type="button" className="btn btn-ghost btn-block" onClick={logout}>Se déconnecter</button>
          </div>
        )}
        {workspace.status === 'ready' && workspace.membership && (
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
