import { useState, type FormEvent } from 'react';
import { api, ApiError, type ProjectComment, type ProjectDetail } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Alert } from './Alert';
import { Avatar } from './Avatar';
import { ContactButton } from './ContactButton';
import { TextAreaField } from './FormControls';
import { ReportButton } from './ReportButton';

const MAX = 500;
const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');

/**
 * FR08, FR09: the like button and comments. The server only sends these to the Professional tier,
 * and only active Professionals may like or comment; Admins read them.
 */
export function Engagement({ project }: { project: ProjectDetail }) {
  const { user } = useAuth();
  const canAct = user?.role === 'PROFESSIONAL' && user.status === 'ACTIVE';
  const [liked, setLiked] = useState(project.likedByMe ?? false);
  const [likeCount, setLikeCount] = useState(project.likeCount ?? 0);
  const [comments, setComments] = useState<ProjectComment[]>(project.comments ?? []);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const toggleLike = () =>
    run(async () => {
      const res = await api<{ liked: boolean; likeCount: number }>(`/projects/${project.id}/like`, { method: liked ? 'DELETE' : 'PUT' });
      setLiked(res.liked);
      setLikeCount(res.likeCount);
    });

  const post = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    run(async () => {
      const res = await api<{ comment: ProjectComment }>(`/projects/${project.id}/comments`, { body: { body: draft } });
      setComments((list) => [res.comment, ...list]);
      setDraft('');
    });
  };

  const saveEdit = (e: FormEvent) => {
    e.preventDefault();
    if (!editing || !editing.body.trim()) return;
    run(async () => {
      const res = await api<{ comment: ProjectComment }>(`/projects/${project.id}/comments/${editing.id}`, { method: 'PATCH', body: { body: editing.body } });
      setComments((list) => list.map((c) => (c.id === res.comment.id ? res.comment : c)));
      setEditing(null);
    });
  };

  const remove = (id: string) =>
    run(async () => {
      await api(`/projects/${project.id}/comments/${id}`, { method: 'DELETE' });
      setComments((list) => list.filter((c) => c.id !== id));
    });

  return (
    <section className="card card-pad stack" aria-labelledby="engagement-title">
      <div className="row space-between">
        <h2 id="engagement-title">Discussion</h2>
        <button
          type="button"
          className="btn btn-secondary btn-sm like-btn"
          aria-pressed={liked}
          onClick={toggleLike}
          disabled={!canAct || busy}
          title={canAct ? undefined : 'Only active Professionals can like projects.'}
        >
          {liked ? '♥ Liked' : '♡ Like'} · {likeCount}
        </button>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {canAct ? (
        <form onSubmit={post} className="stack">
          <TextAreaField label="Add a comment" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={MAX} rows={3} disabled={busy} />
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !draft.trim()} style={{ alignSelf: 'flex-start' }}>
            Post comment
          </button>
        </form>
      ) : (
        <p className="muted small">Only active Professionals can like and comment.</p>
      )}

      {comments.length === 0 ? (
        <p className="muted">No comments yet.</p>
      ) : (
        <ul className="comment-list">
          {comments.map((c) => (
            <li key={c.id} className="comment">
              <Avatar name={c.author.name} size={32} />
              <div className="comment-main">
                <div className="row">
                  <strong>{c.author.name}</strong>
                  <time className="muted small" dateTime={c.createdAt}>
                    {new Date(c.createdAt).toLocaleString()}
                  </time>
                  {c.edited && <span className="muted small">(edited)</span>}
                </div>
                {editing?.id === c.id ? (
                  <form onSubmit={saveEdit} className="stack">
                    <TextAreaField label="Edit comment" value={editing.body} onChange={(e) => setEditing({ id: c.id, body: e.target.value })} maxLength={MAX} rows={3} disabled={busy} />
                    <div className="row">
                      <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !editing.body.trim()}>
                        Save
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)} disabled={busy}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  // Rendered as text by React, so HTML in a comment is shown, never run.
                  <p className="comment-body">{c.body}</p>
                )}
                {!c.mine && (
                  <div className="row">
                    <ContactButton userId={c.author.id} name={c.author.name} label="Contact" className="btn btn-ghost btn-sm" />
                    <ReportButton targetType="COMMENT" targetId={c.id} />
                  </div>
                )}
                {c.mine && canAct && editing?.id !== c.id && (
                  <div className="row">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ id: c.id, body: c.body })} disabled={busy}>
                      Edit
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm danger-text" onClick={() => remove(c.id)} disabled={busy}>
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
