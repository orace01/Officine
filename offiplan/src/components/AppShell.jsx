import { useEffect, useState } from 'react';
import { CalendarDays, ClipboardList, Home, Inbox, LogOut, Menu, Settings, ShieldCheck, UsersRound, X } from 'lucide-react';
import { Link, navigate, useLocation } from '../router.jsx';
import { api } from '../services/api.js';
import { useWorkspace } from '../state/workspace.jsx';
import { ROLE_LABELS, initials } from '../lib/labels.js';
import { Avatar, Brand } from './ui.jsx';

const MANAGER_NAV = [
  { to: '/accueil', label: 'Accueil', icon: Home },
  { to: '/planning', label: 'Planning', icon: CalendarDays },
  { to: '/equipe', label: 'Équipe', icon: UsersRound },
  { to: '/demandes', label: 'Demandes', icon: Inbox, badge: 'pendingRequests' },
  { to: '/parametres', label: 'Paramètres', icon: Settings },
];

const EMPLOYEE_NAV = [
  { to: '/mon-planning', label: 'Mon planning', icon: CalendarDays },
  { to: '/mes-demandes', label: 'Mes demandes', icon: ClipboardList },
];

export default function AppShell({ children }) {
  const workspace = useWorkspace();
  const { path } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const items = workspace.isManager ? MANAGER_NAV : EMPLOYEE_NAV;

  useEffect(() => {
    setMenuOpen(false);
  }, [path]);

  async function logout() {
    await api.logout();
    navigate('/', { force: true });
    await workspace.refresh();
  }

  return (
    <div className={`shell ${menuOpen ? 'is-menu-open' : ''}`}>
      <a className="skip-link" href="#contenu">Aller au contenu</a>
      <header className="shell-topbar">
        <Brand to={items[0].to} />
        <button type="button" className="icon-btn" aria-expanded={menuOpen} aria-controls="navigation" onClick={() => setMenuOpen((open) => !open)}>
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
          <span className="sr-only">{menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}</span>
        </button>
      </header>

      <aside className="shell-sidebar" id="navigation">
        <div className="sidebar-brand"><Brand to={items[0].to} /></div>
        <div className="sidebar-pharmacy">
          <span className="pharmacy-mark" aria-hidden="true">{initials(workspace.pharmacy.name)}</span>
          <div>
            <strong>{workspace.pharmacy.name}</strong>
            <span>{workspace.pharmacy.city || 'Officine'}</span>
          </div>
        </div>
        <nav aria-label="Navigation principale">
          <ul className="nav-list">
            {items.map((item) => {
              const Icon = item.icon;
              const active = path === item.to || path.startsWith(`${item.to}/`);
              const count = item.badge ? workspace.counts?.[item.badge] : 0;
              return (
                <li key={item.to}>
                  <Link to={item.to} className={`nav-link ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}>
                    <Icon size={19} aria-hidden="true" />
                    <span>{item.label}</span>
                    {count > 0 && <span className="nav-badge" aria-label={`${count} en attente`}>{count}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <Avatar name={workspace.user.name} size="sm" />
            <div>
              <strong>{workspace.user.name}</strong>
              <span>{ROLE_LABELS[workspace.membership.role]}</span>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm btn-block" onClick={logout}><LogOut size={16} /> Se déconnecter</button>
          <p className="sidebar-note"><ShieldCheck size={14} aria-hidden="true" /> Données enregistrées dans ce navigateur</p>
        </div>
      </aside>
      {menuOpen && <button type="button" className="shell-scrim" aria-label="Fermer le menu" onClick={() => setMenuOpen(false)} />}

      <main className="shell-main" id="contenu" tabIndex={-1}>
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
