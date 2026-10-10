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

// Écran d'entrée : création de l'espace, ou reconnexion avec le même nom et la même adresse.
export default function AuthScreen() {
  const workspace = useWorkspace();
  const [values, setValues] = useState({ name: '', email: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const emailId = useId();

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
          <h2 className="card-title">Créer votre espace</h2>
          <p className="muted">Indiquez votre nom et votre adresse courriel. La configuration de votre officine suit tout de suite après.</p>
          <form onSubmit={submit} className="form-stack-tight">
            <Field id={nameId} label="Votre nom">
              <input id={nameId} value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} placeholder="Ex. Camille Martin" autoComplete="name" required minLength={2} maxLength={120} autoFocus />
            </Field>
            <Field id={emailId} label="Adresse courriel" hint="Ressaisissez le même nom et la même adresse pour retrouver votre espace.">
              <input id={emailId} type="email" value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} placeholder="camille@officine.fr" autoComplete="email" required />
            </Field>
            <FormError>{error}</FormError>
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || values.name.trim().length < 2 || !values.email.trim()}>
              {busy ? 'Un instant…' : 'Commencer'} {!busy && <ArrowRight size={18} />}
            </button>
          </form>
        </section>

        <p className="welcome-note"><ShieldCheck size={15} aria-hidden="true" /> Vos données sont enregistrées dans ce navigateur.</p>
      </main>
    </div>
  );
}
