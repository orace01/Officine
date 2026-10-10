import { ArrowRight, Building2, CalendarClock, ClipboardList, Users } from 'lucide-react';
import { api } from '../../services/api.js';
import { Link, Redirect } from '../../router.jsx';
import { useResource, useWorkspace } from '../../state/workspace.jsx';
import { useToast } from '../../state/toasts.jsx';
import { totalNeededHours } from '../../domain/schedule.js';
import { WEEKDAYS_SHORT, formatHours } from '../../lib/dates.js';
import { ActivityTag, PageHeader, SlotList } from '../../components/ui.jsx';
import PharmacyForm from './PharmacyForm.jsx';
import OpeningForm from './OpeningForm.jsx';
import ActivitiesEditor from './ActivitiesEditor.jsx';
import NeedsView from '../needs/NeedsView.jsx';

const SECTIONS = {
  officine: { title: 'Officine', description: 'Le nom et la ville affichés sur les plannings.' },
  horaires: { title: 'Jours et créneaux', description: 'Les jours d’ouverture et le découpage de la journée.' },
  postes: { title: 'Postes', description: 'Les activités à tenir. Les modifications sont enregistrées immédiatement.' },
  besoins: { title: 'Besoins', description: 'Le nombre de personnes nécessaires par poste, par jour et par créneau.' },
};

function SaveBar({ busy, dirty, valid }) {
  return (
    <div className="save-bar">
      <span className={dirty ? 'save-bar-dirty' : 'muted'}>{dirty ? 'Modifications non enregistrées' : 'Tout est enregistré'}</span>
      <button type="submit" className="btn btn-primary" disabled={busy || !dirty || !valid}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
    </div>
  );
}

export default function SettingsView({ section }) {
  const workspace = useWorkspace();
  const notify = useToast();
  if (!section) return <SettingsHub />;
  const meta = SECTIONS[section];
  if (!meta) return <Redirect to="/parametres" />;

  const onSaved = () => notify({ title: `${meta.title} : modifications enregistrées` });
  const renderActions = (state) => <SaveBar {...state} />;

  return (
    <>
      <PageHeader back={{ to: '/parametres', label: 'Paramètres' }} title={meta.title} description={meta.description} />
      <div className="narrow">
        {section === 'officine' && <PharmacyForm key={workspace.pharmacy.name + workspace.pharmacy.city} pharmacy={workspace.pharmacy} onSaved={onSaved} renderActions={renderActions} />}
        {section === 'horaires' && <OpeningForm key={JSON.stringify(workspace.pharmacy.settings)} settings={workspace.pharmacy.settings} onSaved={onSaved} renderActions={renderActions} warnAboutNeeds />}
        {section === 'postes' && <ActivitiesEditor />}
        {section === 'besoins' && <NeedsView onSaved={onSaved} renderActions={renderActions} />}
      </div>
    </>
  );
}

function SettingsHub() {
  const workspace = useWorkspace();
  const needs = useResource(() => api.needs(), [workspace.revision]);
  const { pharmacy, activeActivities } = workspace;
  const layout = pharmacy.settings;
  const neededHours = needs.data ? totalNeededHours(needs.data.needs, layout) : null;

  const cards = [
    { id: 'officine', icon: Building2, content: <><strong>{pharmacy.name}</strong><span>{pharmacy.city || 'Ville non renseignée'}</span></> },
    {
      id: 'horaires',
      icon: CalendarClock,
      content: <><strong>{layout.openDays.flatMap((open, index) => (open ? [WEEKDAYS_SHORT[index]] : [])).join(' ')}</strong><span><SlotList slots={layout.slots} /></span></>,
    },
    { id: 'postes', icon: ClipboardList, content: <div className="tag-list">{activeActivities.map((activity) => <ActivityTag key={activity.id} activity={activity} />)}</div> },
    { id: 'besoins', icon: Users, content: <><strong>{neededHours === null ? '…' : `${formatHours(neededHours)} par semaine`}</strong><span>de présence à couvrir, tous postes confondus</span></> },
  ];

  return (
    <>
      <PageHeader eyebrow="Configuration" title="Paramètres" description="Ce qui sert de base à chaque nouveau planning. Les plannings déjà créés ne sont pas modifiés." />
      <div className="settings-grid">
        {cards.map(({ id, icon: Icon, content }) => (
          <Link key={id} to={`/parametres/${id}`} className="card settings-card">
            <span className="settings-icon"><Icon size={22} aria-hidden="true" /></span>
            <div className="settings-card-body">
              <h2>{SECTIONS[id].title}</h2>
              <p className="muted">{SECTIONS[id].description}</p>
              <div className="settings-card-value">{content}</div>
            </div>
            <ArrowRight size={20} className="settings-arrow" aria-hidden="true" />
          </Link>
        ))}
      </div>
    </>
  );
}
