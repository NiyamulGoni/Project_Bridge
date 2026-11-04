import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError, MILESTONE_LABELS, STATUS_LABELS, type MilestoneStatus, type Workspace } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Alert } from '../components/Alert';
import { Avatar } from '../components/Avatar';
import { FormField } from '../components/FormField';
import { TextAreaField } from '../components/FormControls';

const MEMBER_LABELS = { INVITED: 'Invited', ACCEPTED: 'Editor', DECLINED: 'Declined' } as const;

/** FR03: progress entries, milestone status and the team. None of these need Admin review. */
export function ProjectManage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ws, setWs] = useState<Workspace | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [update, setUpdate] = useState('');
  const [milestone, setMilestone] = useState({ title: '', dueDate: '' });
  const [inviteEmail, setInviteEmail] = useState('');

  const reload = useCallback(async () => {
    try {
      setWs(await api<Workspace>(`/projects/${id}/workspace`));
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Could not load the project.' });
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Runs a change, shows field errors under the right form, then refreshes the workspace. */
  async function run(scope: string, fn: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setMessage(null);
    setErrors({});
    try {
      await fn();
      if (success) setMessage({ tone: 'success', text: success });
      await reload();
      return true;
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [`${scope}.${k}`, v])));
        if (!Object.keys(err.fields).length) setMessage({ tone: 'error', text: err.message });
      } else setMessage({ tone: 'error', text: 'Something went wrong.' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addUpdate(e: FormEvent) {
    e.preventDefault();
    if (await run('progress', () => api(`/projects/${id}/progress`, { body: { body: update } }), 'Progress update posted.')) setUpdate('');
  }

  async function addMilestone(e: FormEvent) {
    e.preventDefault();
    if (await run('milestone', () => api(`/projects/${id}/milestones`, { body: milestone }))) setMilestone({ title: '', dueDate: '' });
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    const email = inviteEmail;
    if (await run('invite', () => api(`/projects/${id}/members`, { body: { email } }), `Invitation sent to ${email}. They must accept before joining.`)) {
      setInviteEmail('');
    }
  }

  async function leave() {
    if (!user) return;
    if (await run('team', () => api(`/projects/${id}/members/${user.id}`, { method: 'DELETE' }))) {
      navigate('/my-projects', { state: { flash: 'You left the project team.' } });
    }
  }

  if (!ws) {
    return (
      <main className="page page-narrow">
        {message ? <Alert tone={message.tone}>{message.text}</Alert> : <p className="muted">Loading…</p>}
      </main>
    );
  }

  const isOwner = ws.myRole === 'OWNER';
  const removed = ws.project.status === 'REMOVED';

  return (
    <main className="page page-narrow stack">
      <Link to="/my-projects" className="back-link">
        ← My projects
      </Link>
      <header className="page-header">
        <h1>{ws.project.title}</h1>
        <div className="row">
          <span className={`badge ${STATUS_LABELS[ws.project.status].badge}`}>{STATUS_LABELS[ws.project.status].label}</span>
          <Link to={`/projects/${id}/edit`}>Edit content</Link>
        </div>
        <p className="muted small">Progress, milestones and team changes appear right away. They do not need Admin review.</p>
      </header>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <section className="card card-pad stack" aria-labelledby="milestones-title">
        <h2 id="milestones-title">Milestones</h2>
        {ws.milestones.length === 0 && <p className="muted">No milestones yet.</p>}
        <ul className="list">
          {ws.milestones.map((m) => (
            <li key={m.id} className="list-row">
              <div>
                <strong>{m.title}</strong>
                {m.dueDate && <div className="muted small">Due {new Date(m.dueDate).toLocaleDateString()}</div>}
              </div>
              <div className="row">
                <label className="visually-hidden" htmlFor={`ms-${m.id}`}>
                  Status of {m.title}
                </label>
                <select
                  id={`ms-${m.id}`}
                  className="input input-sm"
                  value={m.status}
                  disabled={busy || removed}
                  onChange={(e) => run('milestone', () => api(`/projects/${id}/milestones/${m.id}`, { method: 'PATCH', body: { status: e.target.value } }))}
                >
                  {(Object.keys(MILESTONE_LABELS) as MilestoneStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {MILESTONE_LABELS[s]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-label={`Delete milestone ${m.title}`}
                  disabled={busy}
                  onClick={() => run('milestone', () => api(`/projects/${id}/milestones/${m.id}`, { method: 'DELETE' }))}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
        {!removed && (
          <form className="row align-end" onSubmit={addMilestone} noValidate>
            <FormField label="New milestone" value={milestone.title} maxLength={120} error={errors['milestone.title']} onChange={(e) => setMilestone((m) => ({ ...m, title: e.target.value }))} />
            <FormField label="Due date (optional)" type="date" value={milestone.dueDate} onChange={(e) => setMilestone((m) => ({ ...m, dueDate: e.target.value }))} />
            <button type="submit" className="btn btn-secondary" disabled={busy}>
              Add
            </button>
          </form>
        )}
      </section>

      <section className="card card-pad stack" aria-labelledby="progress-title">
        <h2 id="progress-title">Progress updates</h2>
        {!removed && (
          <form className="form" onSubmit={addUpdate} noValidate>
            <TextAreaField label="Post an update" rows={3} maxLength={2000} value={update} error={errors['progress.body']} onChange={(e) => setUpdate(e.target.value)} />
            <button type="submit" className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} disabled={busy || !update.trim()}>
              Post update
            </button>
          </form>
        )}
        <ul className="progress-list">
          {ws.progress.map((p) => (
            <li key={p.id}>
              <div className="row space-between">
                <span className="muted small">
                  {p.authorName} · {new Date(p.createdAt).toLocaleDateString()}
                </span>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run('progress', () => api(`/projects/${id}/progress/${p.id}`, { method: 'DELETE' }))}>
                  Delete
                </button>
              </div>
              <p>{p.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="card card-pad stack" aria-labelledby="team-title">
        <h2 id="team-title">Team</h2>
        <p className="muted small">Invited people must accept before they are credited or can edit. Professionals see team names, never emails.</p>
        <ul className="list">
          <li className="list-row">
            <div className="row">
              <Avatar name={ws.project.owner.name} size={30} />
              <span>{ws.project.owner.name}</span>
            </div>
            <span className="badge badge-accent">Owner</span>
          </li>
          {ws.members.map((m) => (
            <li key={m.userId} className="list-row">
              <div className="row">
                <Avatar name={m.name} size={30} />
                <div>
                  <div>{m.name}</div>
                  {m.email && <div className="muted small">{m.email}</div>}
                </div>
              </div>
              <div className="row">
                <span className={`badge ${m.status === 'ACCEPTED' ? 'badge-success' : ''}`}>{MEMBER_LABELS[m.status]}</span>
                {isOwner && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => run('team', () => api(`/projects/${id}/members/${m.userId}`, { method: 'DELETE' }), `${m.name} was removed.`)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {isOwner && !removed && (
          <form className="row align-end" onSubmit={invite} noValidate>
            <FormField
              label="Invite by email"
              type="email"
              placeholder="teammate@example.com"
              value={inviteEmail}
              error={errors['invite.email']}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <button type="submit" className="btn btn-secondary" disabled={busy || !inviteEmail}>
              Invite
            </button>
          </form>
        )}
        {!isOwner && (
          <button type="button" className="btn btn-ghost danger-text" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={leave}>
            Leave this team
          </button>
        )}
      </section>
    </main>
  );
}
