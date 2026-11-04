import { Link, NavLink, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from './Avatar';
import { Logo } from './Logo';

export function NavBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

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
