import { useEffect } from 'react';
import { RotateCw } from 'lucide-react';
import { Redirect, matchPath, useLocation } from './router.jsx';
import { WorkspaceProvider, useWorkspace } from './state/workspace.jsx';
import { ToastProvider } from './state/toasts.jsx';
import { SETUP_STEPS } from './domain/defaults.js';
import { isWeekStart, weekStartOf } from './lib/dates.js';
import AppShell from './components/AppShell.jsx';
import { EmptyState, Loader } from './components/ui.jsx';
import JoinView from './features/auth/JoinView.jsx';
import Onboarding from './features/onboarding/Onboarding.jsx';
import DashboardView from './features/dashboard/DashboardView.jsx';
import PlanningView from './features/planning/PlanningView.jsx';
import TeamView from './features/team/TeamView.jsx';
import MemberView, { NewMemberView } from './features/team/MemberView.jsx';
import RequestsView from './features/requests/RequestsView.jsx';
import SettingsView from './features/settings/SettingsView.jsx';
import EmployeeView from './features/employee/EmployeeView.jsx';

const weekPage = (week, render, fallback) => (week && !isWeekStart(week) ? <Redirect to={fallback} /> : render(week || weekStartOf()));

const MANAGER_ROUTES = [
  { path: '/accueil', title: 'Accueil', render: () => <DashboardView /> },
  { path: '/planning/:week?', title: 'Planning', render: ({ week }) => weekPage(week, (weekStart) => <PlanningView key={weekStart} weekStart={weekStart} />, '/planning') },
  { path: '/equipe', title: 'Équipe', render: () => <TeamView /> },
  { path: '/equipe/nouveau', title: 'Ajouter une personne', render: () => <NewMemberView /> },
  { path: '/equipe/:id', title: 'Fiche', render: ({ id }) => <MemberView key={id} memberId={id} /> },
  { path: '/demandes', title: 'Demandes', render: () => <RequestsView /> },
  { path: '/parametres/:section?', title: 'Paramètres', render: ({ section }) => <SettingsView key={section || 'hub'} section={section} /> },
];

const EMPLOYEE_ROUTES = [
  { path: '/mon-planning/:week?', title: 'Mon planning', render: ({ week }) => weekPage(week, (weekStart) => <EmployeeView key={weekStart} weekStart={weekStart} />, '/mon-planning') },
  { path: '/mes-demandes', title: 'Mes demandes', render: () => <RequestsView /> },
];

function findRoute(routes, path) {
  for (const route of routes) {
    const params = matchPath(route.path, path);
    if (params) return { route, params };
  }
  return null;
}

function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · Planiflow` : 'Planiflow — Planning officine';
  }, [title]);
}

function Routes() {
  const workspace = useWorkspace();
  const { path } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

  const join = matchPath('/rejoindre/:token', path);
  const setup = matchPath('/demarrage/:step', path);
  const routes = workspace.isManager ? MANAGER_ROUTES : EMPLOYEE_ROUTES;
  const found = workspace.membership ? findRoute(routes, path) : null;
  usePageTitle(join ? 'Invitation' : setup ? 'Configuration' : found?.route.title);

  if (workspace.status === 'loading') return <div className="full-page"><Loader label="Ouverture de Planiflow…" /></div>;
  if (workspace.status === 'error') {
    return (
      <div className="full-page">
        <EmptyState icon={RotateCw} title="Planiflow n’a pas pu démarrer" actions={<button type="button" className="btn btn-primary" onClick={workspace.refresh}>Réessayer</button>}>
          <p>{workspace.error.message}</p>
        </EmptyState>
      </div>
    );
  }
  if (join) return <JoinView key={join.token} token={join.token} />;

  // Profil sans officine : il commence par créer la sienne.
  if (!workspace.membership) return setup?.step === 'officine' ? <Onboarding stepId="officine" /> : <Redirect to="/demarrage/officine" />;

  if (workspace.isManager) {
    const { setup: progress } = workspace.pharmacy;
    if (setup) return <Onboarding stepId={setup.step} />;
    // La configuration doit être terminée avant d'accéder à une page quelconque de l'application,
    // pas seulement à l'accueil : impossible de l'éviter en visitant directement une autre adresse.
    if (!progress.done) {
      const next = SETUP_STEPS.find((step) => !progress.completed.includes(step.id));
      return <Redirect to={`/demarrage/${next?.id || 'recapitulatif'}`} />;
    }
  }

  if (!found) return <Redirect to={workspace.isManager ? '/accueil' : '/mon-planning'} />;
  return <AppShell>{found.route.render(found.params)}</AppShell>;
}

export default function App() {
  return (
    <ToastProvider>
      <WorkspaceProvider>
        <Routes />
      </WorkspaceProvider>
    </ToastProvider>
  );
}
