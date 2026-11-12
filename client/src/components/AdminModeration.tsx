import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiError, OFFER_TYPE_LABELS, type AccountStatus, type Role } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Alert } from './Alert';
import { TextDialog } from './TextDialog';

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');

/** Loads a list, and runs a decision that needs a typed reason before reloading it. */
function useQueue<T>(path: string) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api<{ items: T[] }>(path)
      .then((res) => setItems(res.items))
      .catch((err) => setError(errorText(err)));
  }, [path]);
  useEffect(load, [load]);
  return { items, error, setError, load };
}

interface Pending {
  title: string;
  intro: string;
  submitLabel: string;
  run: (text: string) => Promise<unknown>;
}

/** One reason dialog shared by every decision in a panel. */
function useDecision(reload: () => void) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = pending && (
    <TextDialog
      title={pending.title}
      intro={pending.intro}
      label="Reason"
      submitLabel={pending.submitLabel}
      minLength={3}
      maxLength={1000}
      busy={busy}
      error={error}
      onClose={() => {
        setPending(null);
        setError('');
      }}
      onSubmit={async (text) => {
        setBusy(true);
        setError('');
        try {
          await pending.run(text);
          setPending(null);
          reload();
        } catch (err) {
          setError(errorText(err));
        } finally {
          setBusy(false);
        }
      }}
    />
  );
  return { ask: setPending, dialog };
}

interface PendingOffer {
  id: string;
  title: string;
  skills: string[];
  type: string;
  compensation: string;
  currency: string;
  applicationRoute: string;
  project: { id: string; title: string };
  author: { name: string };
}

/** FR11: paid offers wait here until an Admin approves or rejects them. */
export function OfferQueue() {
  const { items, error, setError, load } = useQueue<PendingOffer>('/admin/offers');
  const { ask, dialog } = useDecision(load);
  const approve = (id: string) =>
    api(`/admin/offers/${id}/approve`, { method: 'POST' })
      .then(load)
      .catch((err) => setError(errorText(err)));

  return (
    <section className="stack" aria-labelledby="offers-title">
      <h2 id="offers-title">Paid offers to review</h2>
      {error && <Alert tone="error">{error}</Alert>}
      {items?.length === 0 && (
        <div className="card empty">
          <p className="muted">No offers waiting.</p>
        </div>
      )}
      {items?.map((o) => (
        <article key={o.id} className="card card-pad stack">
          <div className="row space-between">
            <strong>{o.title}</strong>
            <span className="badge">{OFFER_TYPE_LABELS[o.type] ?? o.type}</span>
          </div>
          <p className="small muted">
            By {o.author.name} on <Link to={`/projects/${o.project.id}`}>{o.project.title}</Link> · {o.compensation} {o.currency} · skills: {o.skills.join(', ')}
          </p>
          <p className="comment-body">{o.applicationRoute}</p>
          <div className="row">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => approve(o.id)}>
              Approve
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => ask({ title: 'Reject this offer', intro: 'The author is told why.', submitLabel: 'Reject offer', run: (note) => api(`/admin/offers/${o.id}/reject`, { body: { note } }) })}
            >
              Reject
            </button>
          </div>
        </article>
      ))}
      {dialog}
    </section>
  );
}

interface RoleRequestRow {
  id: string;
  reason: string;
  createdAt: string;
  user: { id: string; name: string };
}

/** FR15: Uploaders asking for the Professional role. */
export function RoleRequestQueue() {
  const { items, error, load } = useQueue<RoleRequestRow>('/admin/role-requests');
  const { ask, dialog } = useDecision(load);
  const decide = (r: RoleRequestRow, action: 'approve' | 'reject') =>
    ask({
      title: action === 'approve' ? `Make ${r.user.name} a Professional` : `Reject ${r.user.name}’s request`,
      intro: action === 'approve' ? 'They keep every project they own. The reason is recorded in the audit log.' : 'They are told why and can ask again.',
      submitLabel: action === 'approve' ? 'Approve' : 'Reject',
      run: (reason) => api(`/admin/role-requests/${r.id}/${action}`, { body: { reason } }),
    });

  return (
    <section className="stack" aria-labelledby="roles-title">
      <h2 id="roles-title">Professional role requests</h2>
      {error && <Alert tone="error">{error}</Alert>}
      {items?.length === 0 && (
        <div className="card empty">
          <p className="muted">No requests waiting.</p>
        </div>
      )}
      {items?.map((r) => (
        <article key={r.id} className="card card-pad stack">
          <div className="row space-between">
            <strong>{r.user.name}</strong>
            <time className="muted small" dateTime={r.createdAt}>
              {new Date(r.createdAt).toLocaleString()}
            </time>
          </div>
          <p className="comment-body">{r.reason}</p>
          <div className="row">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => decide(r, 'approve')}>
              Approve
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => decide(r, 'reject')}>
              Reject
            </button>
          </div>
        </article>
      ))}
      {dialog}
    </section>
  );
}

/** FR14: removed projects. Re-review is the only way back. */
export function RemovedProjects() {
  const { items, error, load } = useQueue<{ id: string; title: string; removedAt: string | null; owner: { name: string } }>('/admin/projects/removed');
  const { ask, dialog } = useDecision(load);
  if (!items?.length && !error) return null;
  return (
    <section className="stack" aria-labelledby="removed-title">
      <h2 id="removed-title">Removed projects</h2>
      {error && <Alert tone="error">{error}</Alert>}
      {items?.map((p) => (
        <article key={p.id} className="card card-pad row space-between">
          <span>
            <strong>{p.title}</strong> <span className="muted small">by {p.owner.name}{p.removedAt ? `, removed ${new Date(p.removedAt).toLocaleDateString()}` : ''}</span>
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => ask({ title: `Send “${p.title}” back to review`, intro: 'It returns to the review queue and stays hidden until approved.', submitLabel: 'Send to review', run: (reason) => api(`/admin/projects/${p.id}/re-review`, { body: { reason } }) })}
          >
            Re-review
          </button>
        </article>
      ))}
      {dialog}
    </section>
  );
}

interface UserRow {
  id: string;
  name: string;
  role: Role;
  status: AccountStatus;
}
interface AuditRow {
  id: string;
  action: string;
  byThisUser: boolean;
  reason: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}

/** The same table the server enforces (FR16). */
const TRANSITIONS: Record<AccountStatus, AccountStatus[]> = { ACTIVE: ['RESTRICTED', 'SUSPENDED', 'BANNED'], RESTRICTED: ['ACTIVE'], SUSPENDED: ['ACTIVE', 'BANNED'], BANNED: ['ACTIVE'] };
const VERB: Record<AccountStatus, string> = { ACTIVE: 'Restore', RESTRICTED: 'Restrict', SUSPENDED: 'Suspend', BANNED: 'Ban' };

/** FR16: find an account, see its history, and control a Professional's access. */
export function UserAccess() {
  const { user: me } = useAuth();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const { items, error, load } = useQueue<UserRow>(`/admin/users?q=${encodeURIComponent(search)}`);
  const { ask, dialog } = useDecision(load);
  const [history, setHistory] = useState<{ userId: string; items: AuditRow[] } | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSearch(q.trim());
  };
  const toggleHistory = (id: string) => {
    if (history?.userId === id) return setHistory(null);
    api<{ items: AuditRow[] }>(`/admin/users/${id}/audit`)
      .then((res) => setHistory({ userId: id, items: res.items }))
      .catch(() => undefined);
  };

  return (
    <section className="stack" aria-labelledby="users-title">
      <h2 id="users-title">Accounts and access</h2>
      <form className="row" onSubmit={submit} role="search">
        <label className="sr-only" htmlFor="user-search">
          Search accounts by name
        </label>
        <input id="user-search" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" style={{ maxWidth: 280 }} />
        <button type="submit" className="btn btn-secondary btn-sm">
          Search
        </button>
      </form>
      {error && <Alert tone="error">{error}</Alert>}
      {items?.length === 0 && <p className="muted">No accounts match.</p>}
      {items?.map((u) => (
        <article key={u.id} className="card card-pad stack">
          <div className="row space-between">
            <span className="row">
              <strong>{u.name}</strong>
              <span className="badge">{u.role.charAt(0) + u.role.slice(1).toLowerCase()}</span>
              <span className={`badge ${u.status === 'ACTIVE' ? 'badge-success' : 'badge-amber'}`}>{u.status.charAt(0) + u.status.slice(1).toLowerCase()}</span>
            </span>
            <span className="row">
              {u.role === 'PROFESSIONAL' &&
                u.id !== me?.id &&
                TRANSITIONS[u.status].map((to) => (
                  <button
                    key={to}
                    type="button"
                    className={`btn btn-sm ${to === 'ACTIVE' ? 'btn-secondary' : 'btn-ghost danger-text'}`}
                    onClick={() =>
                      ask({
                        title: `${VERB[to]} ${u.name}`,
                        intro: to === 'SUSPENDED' || to === 'BANNED' ? 'They are signed out everywhere at once. Their projects are kept.' : 'They are notified, and the change is recorded in the audit log.',
                        submitLabel: VERB[to],
                        run: (reason) => api(`/admin/users/${u.id}/status`, { body: { status: to, reason } }),
                      })
                    }
                  >
                    {VERB[to]}
                  </button>
                ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleHistory(u.id)} aria-expanded={history?.userId === u.id}>
                History
              </button>
            </span>
          </div>
          {history?.userId === u.id && (
            <ul className="audit-list">
              {history.items.length === 0 && <li className="muted small">No recorded activity.</li>}
              {history.items.map((a) => (
                <li key={a.id} className="small">
                  <time className="muted" dateTime={a.createdAt}>
                    {new Date(a.createdAt).toLocaleString()}
                  </time>{' '}
                  <code>{a.action}</code>
                  {a.oldValue && ` ${a.oldValue} → ${a.newValue}`}
                  {a.reason && ` · ${a.reason}`}
                  {!a.byThisUser && <span className="muted"> (done to this account)</span>}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
      {dialog}
    </section>
  );
}
