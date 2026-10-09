import { ArrowLeft, Check, ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { Link } from '../router.jsx';
import { addDays, formatSlot, formatWeekRange, relativeWeekLabel, weekStartOf } from '../lib/dates.js';
import { initials } from '../lib/labels.js';

const AVATAR_TONES = ['sage', 'blue', 'lilac', 'amber', 'coral', 'teal'];

export function Brand({ to = '/' }) {
  return (
    <Link to={to} className="brand" aria-label="OffiPlan, accueil">
      <img src={`${import.meta.env.BASE_URL}offiplan-mark.svg`} alt="" width="32" height="32" />
      <span className="brand-name">offi<span>plan</span></span>
    </Link>
  );
}

export function PageHeader({ eyebrow, title, description, actions, back }) {
  return (
    <header className="page-header">
      {back && <Link to={back.to} className="back-link"><ArrowLeft size={16} aria-hidden="true" /> {back.label}</Link>}
      <div className="page-header-row">
        <div className="page-header-text">
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
          {description && <p className="lead">{description}</p>}
        </div>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
    </header>
  );
}

export function Card({ title, description, actions, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-header">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({ id, label, hint, error, optional = false, children }) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={id}>
        {label}
        {optional && <span className="field-optional">facultatif</span>}
      </label>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export function FormError({ children }) {
  if (!children) return null;
  return <div className="alert alert-error" role="alert">{children}</div>;
}

export function Callout({ tone = 'info', icon: Icon, title, children, action }) {
  return (
    <div className={`callout callout-${tone}`}>
      {Icon && <Icon size={20} className="callout-icon" aria-hidden="true" />}
      <div className="callout-body">
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {action && <div className="callout-action">{action}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, actions }) {
  return (
    <div className="empty-state">
      {Icon && <span className="empty-icon"><Icon size={26} aria-hidden="true" /></span>}
      <h2>{title}</h2>
      {children && <div className="empty-text">{children}</div>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  );
}

export function Loader({ label = 'Chargement…' }) {
  return <div className="loader" role="status"><span className="spinner" aria-hidden="true" />{label}</div>;
}

export function ChoiceChips({ label, options, value, onChange }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((option) => {
        const selected = value.includes(option.value);
        return (
          <button
            type="button"
            key={option.value}
            className={`chip ${selected ? 'is-selected' : ''}`}
            aria-pressed={selected}
            disabled={option.disabled}
            onClick={() => onChange(selected ? value.filter((item) => item !== option.value) : [...value, option.value])}
          >
            {selected ? <Check size={15} aria-hidden="true" /> : option.color && <span className="swatch" data-color={option.color} aria-hidden="true" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function NumberInput({ value, onChange, min = 0, max = 99, label, disabled = false }) {
  const clamp = (next) => Math.max(min, Math.min(max, next));
  return (
    <div className="number-input">
      <button type="button" aria-label={`Diminuer : ${label}`} disabled={disabled || value <= min} onClick={() => onChange(clamp(value - 1))}><Minus size={15} /></button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(clamp(Number.parseInt(event.target.value, 10) || 0))}
        onFocus={(event) => event.target.select()}
      />
      <button type="button" aria-label={`Augmenter : ${label}`} disabled={disabled || value >= max} onClick={() => onChange(clamp(value + 1))}><Plus size={15} /></button>
    </div>
  );
}

export function Switch({ checked, onChange, label, description }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch-track" aria-hidden="true"><span /></span>
      <span className="switch-text">
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
    </label>
  );
}

export function Avatar({ name, size = 'md' }) {
  const hash = [...name].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  return <span className={`avatar avatar-${size}`} data-tone={AVATAR_TONES[hash % AVATAR_TONES.length]} aria-hidden="true">{initials(name)}</span>;
}

export function ActivityTag({ activity }) {
  if (!activity) return <span className="activity-tag">Poste supprimé</span>;
  return <span className="activity-tag" data-color={activity.color}><span className="swatch" aria-hidden="true" />{activity.name}</span>;
}

export function SlotList({ slots }) {
  return slots.map((slot, index) => (
    <span key={slot.id}>{index > 0 && ' · '}<span className="slot-inline">{formatSlot(slot)}</span></span>
  ));
}

export function Badge({ tone = 'neutral', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function WeekSwitcher({ weekStart, onChange }) {
  const current = weekStartOf();
  return (
    <div className="week-switcher">
      <button type="button" className="icon-btn" aria-label="Semaine précédente" onClick={() => onChange(addDays(weekStart, -7))}><ChevronLeft size={20} /></button>
      <div className="week-switcher-label" aria-live="polite">
        <strong>{formatWeekRange(weekStart)}</strong>
        <span>{relativeWeekLabel(weekStart, current)}</span>
      </div>
      <button type="button" className="icon-btn" aria-label="Semaine suivante" onClick={() => onChange(addDays(weekStart, 7))}><ChevronRight size={20} /></button>
      {weekStart !== current && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(current)}>Aujourd’hui</button>}
    </div>
  );
}
