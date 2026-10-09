import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Brand } from './ui.jsx';

// La configuration doit être terminée avant d'accéder au reste de l'application : pas de
// sortie anticipée ici. Le logo reste cliquable mais ramène à l'étape en cours, pas ailleurs.
export default function WizardLayout({ steps, currentIndex, completed, onSelect, children }) {
  const firstOpen = steps.findIndex((step) => !completed.includes(step.id));
  const reachable = firstOpen === -1 ? steps.length - 1 : firstOpen;
  return (
    <div className="wizard">
      <header className="wizard-topbar">
        <Brand to="/" />
      </header>
      <nav className="wizard-progress" aria-label="Étapes de la configuration">
        <p className="wizard-count">Étape {currentIndex + 1} sur {steps.length}</p>
        <ol className="step-list">
          {steps.map((step, index) => {
            const done = completed.includes(step.id) && index !== currentIndex;
            const state = index === currentIndex ? 'is-current' : done ? 'is-done' : '';
            return (
              <li key={step.id} className={state}>
                <button type="button" onClick={() => onSelect(step.id)} disabled={index > reachable} aria-current={index === currentIndex ? 'step' : undefined}>
                  <span className="step-dot">{done ? <Check size={14} aria-hidden="true" /> : index + 1}</span>
                  <span className="step-label">{step.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <main className="wizard-main" id="contenu">{children}</main>
    </div>
  );
}

export function WizardStep({ eyebrow, title, description, children }) {
  return (
    <section className="wizard-step">
      <header className="wizard-step-header">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="lead">{description}</p>}
      </header>
      {children}
    </section>
  );
}

export function WizardFooter({ onBack, nextLabel = 'Continuer', busy = false, disabled = false, onNext, hint }) {
  return (
    <div className="wizard-footer">
      {onBack
        ? <button type="button" className="btn btn-ghost" onClick={onBack}><ArrowLeft size={18} /> Retour</button>
        : <span />}
      <div className="wizard-footer-next">
        {hint && <span className="wizard-hint">{hint}</span>}
        <button type={onNext ? 'button' : 'submit'} className="btn btn-primary btn-lg" disabled={busy || disabled} onClick={onNext}>
          {busy ? 'Enregistrement…' : nextLabel} {!busy && <ArrowRight size={18} />}
        </button>
      </div>
    </div>
  );
}
