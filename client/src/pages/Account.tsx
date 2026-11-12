import { useEffect, useState } from 'react';
import { api, ApiError, ROLE_LABELS, type Role } from '../api';
import { Alert } from '../components/Alert';
import { TextDialog } from '../components/TextDialog';
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

      {user.role === 'UPLOADER' && <RoleRequest active={user.status === 'ACTIVE'} />}
    </main>
  );
}

interface MyRoleRequest {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  decisionNote: string | null;
  createdAt: string;
}

/** FR15: an Uploader asks for the Professional role; an Admin decides. */
function RoleRequest({ active }: { active: boolean }) {
  const [latest, setLatest] = useState<MyRoleRequest | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () =>
    api<{ items: MyRoleRequest[] }>('/role-requests/mine')
      .then((res) => setLatest(res.items[0] ?? null))
      .catch(() => setLatest(null));
  useEffect(() => {
    load();
  }, []);

  async function send(reason: string) {
    setBusy(true);
    setError('');
    try {
      await api('/role-requests', { body: { reason } });
      setOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the request.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card card-pad stack" aria-labelledby="role-request-title">
      <h2 id="role-request-title">Professional access</h2>
      <p className="muted">Professionals are industry experts who can like, comment and post paid offers. An Admin reviews each request.</p>
      {latest?.status === 'PENDING' && <Alert tone="info">Your request is waiting for an Admin.</Alert>}
      {latest?.status === 'REJECTED' && <Alert tone="info">Your last request was not approved{latest.decisionNote ? `: ${latest.decisionNote}` : '.'} You can ask again.</Alert>}
      {latest !== undefined && latest?.status !== 'PENDING' && (
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)} disabled={!active} style={{ alignSelf: 'flex-start' }}>
          Request Professional role
        </button>
      )}
      {open && (
        <TextDialog
          title="Request the Professional role"
          intro="Say who you are and where you work, so an Admin can verify it."
          label="Why should you be a Professional?"
          submitLabel="Send request"
          minLength={20}
          maxLength={1000}
          busy={busy}
          error={error}
          onSubmit={send}
          onClose={() => {
            setOpen(false);
            setError('');
          }}
        />
      )}
    </section>
  );
}
