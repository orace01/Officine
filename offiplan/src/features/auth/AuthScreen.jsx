import { useId, useState } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { api } from '../../services/api.js';
import { navigate } from '../../router.jsx';
import { useWorkspace } from '../../state/workspace.jsx';
import { Brand, Field, FormError } from '../../components/ui.jsx';

const STEPS = [
  { title: 'Configurez', text: 'Jours d’ouverture, créneaux, postes à tenir et besoins de chaque journée.' },
  { title: 'Générez', text: 'Une proposition qui respecte compétences, repos, volumes horaires et absences.' },
  { title: 'Publiez', text: 'Chacun consulte son planning et dépose ses demandes d’absence.' },
];

// Écran d'entrée : connexion uniquement. Pour cette première version, un seul compte existe
// (créé avec `scripts/create-admin.mjs`) ; la création de compte est désactivée côté Supabase Auth.
export default function AuthScreen() {
  const workspace = useWorkspace();
  const [values, setValues] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const emailId = useId();
  const passwordId = useId();

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(values);
      navigate('/', { replace: true, force: true });
      await workspace.refresh();
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  }

  return (
    <div className="welcome">
      <section className="welcome-intro">
        <Brand />
        <h1>Le planning de l’officine, étape par étape.</h1>
        <p className="lead">Décrivez votre officine et votre équipe : Planiflow propose le planning de la semaine, signale ce qui coince et le partage avec chacun.</p>
        <ol className="welcome-steps">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <span className="step-dot">{index + 1}</span>
              <div><strong>{step.title}</strong><p>{step.text}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <main className="welcome-panel" id="contenu">
        <section className="card">
          <h2 className="card-title">Se connecter</h2>
          <p className="muted">Retrouvez votre officine et votre équipe.</p>
          <form onSubmit={submit} className="form-stack-tight">
            <Field id={emailId} label="Adresse courriel">
              <input id={emailId} type="email" value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} placeholder="camille@officine.fr" autoComplete="email" required autoFocus />
            </Field>
            <Field id={passwordId} label="Mot de passe">
              <input id={passwordId} type="password" value={values.password} onChange={(event) => setValues({ ...values, password: event.target.value })} autoComplete="current-password" required minLength={6} />
            </Field>
            <FormError>{error}</FormError>
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || !values.email.trim() || values.password.length < 6}>
              {busy ? 'Un instant…' : 'Se connecter'} {!busy && <ArrowRight size={18} />}
            </button>
          </form>
        </section>

        <p className="welcome-note"><ShieldCheck size={15} aria-hidden="true" /> Vos données sont protégées par un mot de passe.</p>
      </main>
    </div>
  );
}
