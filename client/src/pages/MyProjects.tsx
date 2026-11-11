import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { api, ApiError, STAGE_LABELS, STATUS_LABELS, type Invite, type MyProject } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Alert } from '../components/Alert';
import { ConfirmDeleteDialog } from '../components/ConfirmDeleteDialog';

/** FR02–FR04: the owner's and editor's list of projects, invitations, hide and delete. */
export function MyProjects() {
  const { user } = useAuth();
  const location = useLocation();
  const [items, setItems] = useState<MyProject[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(() => {
    const flash = (location.state as { flash?: string } | null)?.flash;
    return flash ? { tone: 'success', text: flash } : null;
  });
  const [deleting, setDeleting] = useState<MyProject | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [mine, inv] = await Promise.all([
        api<{ items: MyProject[] }>('/projects/mine'),
        api<{ items: Invite[] }>('/projects/invites'),
      ]);
      setItems(mine.items);
      setInvites(inv.items);
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Could not load your projects.' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(path: string, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      await api(path, { method: 'POST' });
      setMessage({ tone: 'success', text: success });
      await load();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(typed: string) {
    if (!deleting) return;
    setBusy(true);
    setDeleteError('');
    try {
      await api(`/projects/${deleting.id}`, { method: 'DELETE', body: { confirmTitle: typed } });
      setMessage({ tone: 'success', text: `“${deleting.title}” was deleted.` });
      setDeleting(null);
      await load();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? (err.fields.confirmTitle ?? err.message) : 'Could not delete the project.');
    } finally {
      setBusy(false);
    }
  }

  const canCreate = user?.role === 'UPLOADER' || user?.role === 'PROFESSIONAL';

  return (
    <main className="page stack">
      <header className="row space-between">
        <div className="page-header" style={{ marginBottom: 0 }}>
          <h1>My projects</h1>
          <p className="muted">Drafts, submissions and published projects you own or edit.</p>
        </div>
        {canCreate && (
          <Link to="/projects/new" className="btn btn-primary">
            + New project
          </Link>
        )}
      </header>

      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      {invites.length > 0 && (
        <section className="card card-pad stack" aria-labelledby="invites-title">
          <h2 id="invites-title">Team invitations</h2>
          <ul className="list">
            {invites.map((i) => (
              <li key={i.projectId} className="list-row">
                <div>
                  <strong>{i.title}</strong>
                  <div className="muted small">Invited by {i.ownerName} to join as an editor</div>
                </div>
                <div className="row">
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(`/projects/invites/${i.projectId}/accept`, `You joined “${i.title}”.`)}>
                    Accept
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(`/projects/invites/${i.projectId}/decline`, 'Invitation declined.')}>
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {items === null ? (
        <p className="muted" role="status">
          Loading your projects…
        </p>
      ) : items.length === 0 ? (
        <section className="card empty">
          <h2>No projects yet</h2>
          <p className="muted">Start a draft. You can save it and come back before submitting for review.</p>
          {canCreate && (
            <div className="actions" style={{ marginTop: 16 }}>
              <Link to="/projects/new" className="btn btn-primary">
                Create your first project
              </Link>
            </div>
          )}
        </section>
      ) : (
        <ul className="list card">
          {items.map((p) => (
            <li key={p.id} className="list-row">
              <div className="stack" style={{ gap: 4 }}>
                <div className="row">
                  <strong>{p.title}</strong>
                  <span className={`badge ${STATUS_LABELS[p.status].badge}`}>{STATUS_LABELS[p.status].label}</span>
                  {p.hasPendingRevision && <span className="badge badge-navy">Changes in review</span>}
                  {p.myRole === 'EDITOR' && <span className="badge">Editor</span>}
                </div>
                <span className="muted small">
                  {STAGE_LABELS[p.stage]} · updated {new Date(p.updatedAt).toLocaleDateString()}
                  {p.tags.length > 0 && ` · ${p.tags.join(' ')}`}
                </span>
                {p.status === 'CHANGES_REQUESTED' && p.reviewNote && <span className="small review-note">Admin: {p.reviewNote}</span>}
              </div>
              <div className="row wrap">
                {p.status === 'PUBLISHED' && (
                  <Link to={`/projects/${p.id}`} className="btn btn-ghost btn-sm">
                    View
                  </Link>
                )}
                <Link to={`/projects/${p.id}/edit`} className="btn btn-secondary btn-sm">
                  {p.status === 'SUBMITTED' || p.status === 'REMOVED' ? 'Open' : 'Edit'}
                </Link>
                <Link to={`/projects/${p.id}/manage`} className="btn btn-ghost btn-sm">
                  Progress &amp; team
                </Link>
                {p.myRole === 'OWNER' && p.status === 'PUBLISHED' && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(`/projects/${p.id}/hide`, `“${p.title}” is hidden. Unhide it any time.`)}>
                    Hide
                  </button>
                )}
                {p.myRole === 'OWNER' && p.status === 'HIDDEN' && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(`/projects/${p.id}/unhide`, `“${p.title}” is visible again.`)}>
                    Unhide
                  </button>
                )}
                {p.myRole === 'OWNER' && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm danger-text"
                    disabled={busy}
                    onClick={() => {
                      setDeleteError('');
                      setDeleting(p);
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {deleting && (
        <ConfirmDeleteDialog title={deleting.title} error={deleteError} busy={busy} onConfirm={confirmDelete} onCancel={() => setDeleting(null)} />
      )}
    </main>
  );
}
