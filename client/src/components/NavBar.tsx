import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from './Avatar';
import { Logo } from './Logo';

export function NavBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [unread, setUnread] = useState(0);

  // Polled, and refreshed on each page change or when the Notifications page marks something read.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const refresh = () =>
      api<{ count: number }>('/notifications/unread-count')
        .then((res) => !cancelled && setUnread(res.count))
        .catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('notifications-changed', refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('notifications-changed', refresh);
    };
  }, [user?.id, location.pathname]);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <Logo />
        <nav className="nav-links" aria-label="Main">
          <NavLink to="/" end>
            Explore
          </NavLink>
          {user && user.role !== 'ADMIN' && <NavLink to="/my-projects">My projects</NavLink>}
          {user && user.role !== 'ADMIN' && <NavLink to="/requests">Requests</NavLink>}
          {user && user.role !== 'ADMIN' && <NavLink to="/messages">Messages</NavLink>}
          {user?.role === 'PROFESSIONAL' && <NavLink to="/offers">Offers</NavLink>}
          {user?.role === 'ADMIN' && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <div className="nav-actions">
          {user ? (
            <>
              {user.role !== 'ADMIN' && (
                <Link to="/projects/new" className="btn btn-primary nav-new">
                  + New project
                </Link>
              )}
              <Link to="/notifications" className="btn btn-ghost nav-bell" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
                <span aria-hidden="true">🔔</span>
                {unread > 0 && <span className="nav-bell-count">{unread > 99 ? '99+' : unread}</span>}
              </Link>
              <Link to="/account" className="nav-user" aria-label={`Your account (${user.name})`}>
                <Avatar name={user.name} size={30} />
                <span className="nav-user-name">{user.name.split(' ')[0]}</span>
              </Link>
              <button type="button" className="btn btn-ghost" onClick={handleLogout}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost">
                Sign in
              </Link>
              <Link to="/register" className="btn btn-primary">
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
