import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiError, ROLE_LABELS, STAGE_LABELS, STATUS_LABELS, upload, type MyProfile, type MyProject, type Role } from '../api';
import { Alert } from '../components/Alert';
import { TextDialog } from '../components/TextDialog';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/Avatar';

const ROLE_BADGE: Record<Role, string> = {
  UPLOADER: 'badge-accent',
  PROFESSIONAL: 'badge-amber',
  ADMIN: 'badge-navy',
};

const COVER_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const COVER_MAX_BYTES = 2 * 1024 * 1024;

export function Account() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<MyProfile | null | undefined>(undefined);

  const loadProfile = () =>
    api<MyProfile>('/auth/me/profile')
      .then(setProfile)
      .catch(() => setProfile(null));
  useEffect(() => {
    if (user) loadProfile();
  }, [user?.id]);

  if (!user) return null;

  const status = user.status.charAt(0) + user.status.slice(1).toLowerCase();

  return (
    <main className="page page-narrow stack">
      <section className="card profile-card">
        <CoverPhoto
          url={profile?.coverUrl ?? null}
          canEdit={user.status === 'ACTIVE'}
          onChange={(coverUrl) => setProfile((p) => (p ? { ...p, coverUrl } : p))}
        />
        <div className="profile card-pad">
          <Avatar name={user.name} size={64} />
          <div className="profile-info">
            <h1>{user.name}</h1>
            <span className="muted">{user.email}</span>
            <span className={`badge ${ROLE_BADGE[user.role]}`} style={{ alignSelf: 'flex-start' }}>
              {ROLE_LABELS[user.role]}
            </span>
          </div>
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
          {profile && (
            <>
              <dt>Member since</dt>
              <dd>{new Date(profile.memberSince).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</dd>
            </>
          )}
        </dl>
      </section>

      <PasswordRecovery email={user.email} hasPassword={user.hasPassword} />

      {user.role === 'UPLOADER' && <RoleRequest active={user.status === 'ACTIVE'} />}

      <ActivityStats profile={profile} />

      <UploadedProjects />
    </main>
  );
}

/** The user's own cover photo, shown as a banner above their name. */
function CoverPhoto({ url, canEdit, onChange }: { url: string | null; canEdit: boolean; onChange: (url: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    if (!COVER_TYPES.includes(file.type)) return setError('The cover photo must be a PNG, JPEG or WebP image.');
    if (file.size > COVER_MAX_BYTES) return setError('The cover photo must be at most 2 MB.');
    setBusy(true);
    try {
      const form = new FormData();
      form.append('cover', file);
      const res = await upload<{ coverUrl: string }>('/auth/me/cover', form);
      onChange(res.coverUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload the cover photo.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await api('/auth/me/cover', { method: 'DELETE' });
      onChange(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove the cover photo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-cover" style={url ? { backgroundImage: `url("${url}")` } : undefined}>
      {canEdit && (
        <div className="profile-cover-actions">
          <input ref={input} type="file" accept={COVER_TYPES.join(',')} onChange={choose} hidden aria-hidden="true" tabIndex={-1} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? 'Saving…' : url ? 'Change cover photo' : 'Upload cover photo'}
          </button>
          {url && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={remove} disabled={busy}>
              Remove
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="profile-cover-error">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
    </div>
  );
}

/** Mails a password reset link to the account's own address; the link proves the user owns it. */
function PasswordRecovery({ email, hasPassword }: { email: string; hasPassword: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function send() {
    setBusy(true);
    setMessage(null);
    try {
      await api('/auth/forgot-password', { body: { email } });
      setMessage({ tone: 'success', text: `We sent a password reset link to ${email}. Open it within 1 hour to choose a new password.` });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Could not send the email.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card card-pad stack" aria-labelledby="password-title">
      <h2 id="password-title">Password</h2>
      <p className="muted">
        {hasPassword
          ? 'Forgot your password, or want to change it? We will email a verification link to your address, and you can choose a new password from there. Every device will be signed out.'
          : 'You sign in with Google. To also sign in with a password, we will email a verification link to your address so you can set one.'}
      </p>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <button type="button" className="btn btn-secondary" onClick={send} disabled={busy} style={{ alignSelf: 'flex-start' }}>
        {busy ? 'Sending…' : hasPassword ? 'Email me a password reset link' : 'Email me a link to set a password'}
      </button>
    </section>
  );
}

/** Everything the user has done since the account was created. */
function ActivityStats({ profile }: { profile: MyProfile | null | undefined }) {
  if (profile === undefined) {
    return (
      <section className="card card-pad">
        <h2>Activity</h2>
        <p className="muted" role="status">Loading your activity…</p>
      </section>
    );
  }
  if (profile === null) {
    return (
      <section className="card card-pad">
        <h2>Activity</h2>
        <Alert tone="error">Could not load your activity. Refresh the page to try again.</Alert>
      </section>
    );
  }

  const { stats } = profile;
  const since = new Date(profile.memberSince).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const tiles: { label: string; value: number; note?: string }[] = [
    { label: 'Projects uploaded', value: stats.projects.uploaded, note: `${stats.projects.published} published` },
    { label: 'Team projects', value: stats.projects.team, note: 'as an editor' },
    { label: 'Likes received', value: stats.likesReceived },
    { label: 'Comments received', value: stats.commentsReceived },
    { label: 'Likes given', value: stats.likesGiven },
    { label: 'Comments written', value: stats.commentsWritten },
    { label: 'Contact requests sent', value: stats.contactRequestsSent },
    { label: 'Contact requests received', value: stats.contactRequestsReceived },
    { label: 'Messages sent', value: stats.messagesSent },
    { label: 'Paid offers posted', value: stats.offersPosted },
  ];
  const breakdown = [
    ['In review', stats.projects.inReview],
    ['Drafts', stats.projects.drafts],
    ['Hidden', stats.projects.hidden],
    ['Removed', stats.projects.removed],
  ] as const;

  return (
    <section className="card card-pad stack" aria-labelledby="activity-title">
      <div>
        <h2 id="activity-title">Activity</h2>
        <p className="muted small">Everything since you joined on {since}.</p>
      </div>
      <ul className="stat-grid">
        {tiles.map((t) => (
          <li key={t.label} className="stat-tile">
            <span className="stat-value">{t.value.toLocaleString()}</span>
            <span className="stat-label">{t.label}</span>
            {t.note && <span className="stat-note">{t.note}</span>}
          </li>
        ))}
      </ul>
      {stats.projects.uploaded > 0 && (
        <p className="muted small">
          Your projects: {breakdown.map(([label, n]) => `${label} ${n}`).join(' · ')}
        </p>
      )}
    </section>
  );
}

/** The projects this user owns or edits, newest change first. */
function UploadedProjects() {
  const [items, setItems] = useState<MyProject[] | null | undefined>(undefined);

  useEffect(() => {
    api<{ items: MyProject[] }>('/projects/mine')
      .then((res) => setItems(res.items))
      .catch(() => setItems(null));
  }, []);

  return (
    <section className="card card-pad stack" aria-labelledby="uploaded-title">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id="uploaded-title">Uploaded projects</h2>
        <Link to="/my-projects" className="btn btn-ghost btn-sm">
          Manage projects
        </Link>
      </div>
      {items === undefined ? (
        <p className="muted" role="status">Loading your projects…</p>
      ) : items === null ? (
        <Alert tone="error">Could not load your projects. Refresh the page to try again.</Alert>
      ) : items.length === 0 ? (
        <p className="muted">You have not uploaded any projects yet.</p>
      ) : (
        <ul className="list">
          {items.map((p) => (
            <li key={p.id} className="list-row">
              <div className="stack" style={{ gap: 4 }}>
                <div className="row">
                  <strong>{p.title}</strong>
                  <span className={`badge ${STATUS_LABELS[p.status].badge}`}>{STATUS_LABELS[p.status].label}</span>
                  {p.myRole === 'EDITOR' && <span className="badge">Editor</span>}
                </div>
                <span className="muted small">
                  {STAGE_LABELS[p.stage]}
                  {p.publishedAt ? ` · published ${new Date(p.publishedAt).toLocaleDateString()}` : ''} · updated {new Date(p.updatedAt).toLocaleDateString()}
                </span>
              </div>
              <Link to={p.status === 'PUBLISHED' ? `/projects/${p.id}` : `/projects/${p.id}/edit`} className="btn btn-ghost btn-sm">
                {p.status === 'PUBLISHED' ? 'View' : 'Open'}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
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
