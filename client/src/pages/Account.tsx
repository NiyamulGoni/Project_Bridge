import { ROLE_LABELS, type Role } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/Avatar';

const ROLE_BADGE: Record<Role, string> = {
  UPLOADER: 'badge-accent',
  PROFESSIONAL: 'badge-amber',
  ADMIN: 'badge-navy',
};

export function Account() {
  const { user } = useAuth();
  if (!user) return null;

  const status = user.status.charAt(0) + user.status.slice(1).toLowerCase();

  return (
    <main className="page page-narrow stack">
      <section className="card card-pad profile">
        <Avatar name={user.name} size={64} />
        <div className="profile-info">
          <h1>{user.name}</h1>
          <span className="muted">{user.email}</span>
          <span className={`badge ${ROLE_BADGE[user.role]}`} style={{ alignSelf: 'flex-start' }}>
            {ROLE_LABELS[user.role]}
          </span>
        </div>
      </section>

      <section className="card card-pad" aria-labelledby="details-title">
        <h2 id="details-title">Account details</h2>
        <dl className="details">
          <dt>Role</dt>
          <dd>{ROLE_LABELS[user.role]}</dd>
          <dt>Account status</dt>
          <dd>
            <span className={`badge ${user.status === 'ACTIVE' ? 'badge-success' : 'badge-amber'}`}>
              {user.status === 'ACTIVE' ? '● ' : ''}
              {status}
            </span>
          </dd>
          <dt>Sign-in methods</dt>
          <dd>
            {user.hasPassword && <span className="badge">Password</span>}
            {user.googleLinked && <span className="badge badge-success">Google</span>}
          </dd>
        </dl>
      </section>

      {user.role === 'UPLOADER' && (
        <div className="hint-card">
          <span aria-hidden="true">💡</span>
          <p>
            Want Professional access? An Admin can change your role after reviewing a request. This is coming in a
            later release.
          </p>
        </div>
      )}
    </main>
  );
}
