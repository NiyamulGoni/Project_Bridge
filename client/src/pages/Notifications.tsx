import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError, type AppNotification } from '../api';
import { Alert } from '../components/Alert';

/** Where a notice leads, if anywhere the user can open. */
function linkFor(n: AppNotification): string | null {
  if (n.targetType === 'Project' && n.targetId) return `/projects/${n.targetId}`;
  if (n.targetType === 'ContactRequest' || n.targetType === 'Conversation') return '/requests';
  if (n.eventType === 'TEAM_INVITE') return '/my-projects';
  return null;
}

/** In-app notices (DFD 8.0): the signed-in user's own only. */
export function Notifications() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError('');
    try {
      const res = await api<{ items: AppNotification[]; hasMore: boolean }>(`/notifications?page=${p}`);
      setItems((list) => (p === 1 ? res.items : [...list, ...res.items]));
      setHasMore(res.hasMore);
      setPage(p);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load notifications.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(1);
  }, [load]);

  const announce = () => window.dispatchEvent(new Event('notifications-changed'));

  async function markRead(id: string) {
    setItems((list) => list.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    await api(`/notifications/${id}/read`, { method: 'POST' }).catch(() => undefined);
    announce();
  }

  async function markAll() {
    try {
      await api('/notifications/read-all', { method: 'POST' });
      setItems((list) => list.map((n) => ({ ...n, isRead: true })));
      announce();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update notifications.');
    }
  }

  const unread = items.some((n) => !n.isRead);

  return (
    <main className="page page-narrow stack">
      <header className="page-header row space-between">
        <div>
          <h1>Notifications</h1>
          <p className="muted">Invitations, review decisions, comments and contact requests.</p>
        </div>
        {unread && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={markAll}>
            Mark all as read
          </button>
        )}
      </header>

      {error && <Alert tone="error">{error}</Alert>}
      {!loading && items.length === 0 && !error && (
        <section className="card empty">
          <p className="muted">You have no notifications yet.</p>
        </section>
      )}

      {items.length > 0 && (
        <ul className="notice-list card">
          {items.map((n) => {
            const to = linkFor(n);
            return (
              <li key={n.id} className={`notice${n.isRead ? '' : ' notice-unread'}`}>
                <span className="notice-dot" aria-label={n.isRead ? undefined : 'Unread'} />
                <div className="notice-main">
                  {to ? (
                    <Link to={to} onClick={() => markRead(n.id)}>
                      {n.message}
                    </Link>
                  ) : (
                    <span>{n.message}</span>
                  )}
                  <time className="muted small" dateTime={n.createdAt}>
                    {new Date(n.createdAt).toLocaleString()}
                  </time>
                </div>
                {!n.isRead && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => markRead(n.id)}>
                    Mark read
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {loading && (
        <p className="muted" role="status">
          Loading…
        </p>
      )}
      {hasMore && !loading && (
        <button type="button" className="btn btn-secondary" onClick={() => load(page + 1)} style={{ alignSelf: 'center' }}>
          Load more
        </button>
      )}
    </main>
  );
}
