import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../api';
import { useAuth } from '../auth/AuthContext';
import { ReviewQueue } from '../components/ReviewQueue';

const UPCOMING = [
  { id: 'FR14', title: 'Remove violating projects', text: 'Act on confirmed policy or copyright reports.' },
  { id: 'FR15', title: 'Change account roles', text: 'Promote approved Uploaders to Professional.' },
  { id: 'FR16', title: 'Control Professional access', text: 'Restrict, suspend, ban or restore accounts.' },
];

/**
 * Always asks the server, even when the UI thinks the user is not an Admin.
 * This shows during the demo that the API itself refuses access.
 */
export function AdminArea() {
  const { user, loading } = useAuth();
  const [result, setResult] = useState<{ ok: boolean; text: string; status?: number } | null>(null);

  useEffect(() => {
    if (loading) return;
    api<{ message: string }>('/admin/ping')
      .then((res) => setResult({ ok: true, text: res.message }))
      .catch((err) =>
        setResult({
          ok: false,
          status: err instanceof ApiError ? err.status : undefined,
          text: err instanceof ApiError ? err.message : 'Request failed.',
        }),
      );
  }, [loading, user?.id]);

  return (
    <main className="page stack">
      <header className="page-header">
        <h1>Admin dashboard</h1>
        <p className="muted">Moderation, roles and account controls.</p>
      </header>

      {!result && (
        <p className="muted" role="status">
          Checking permissions…
        </p>
      )}

      {result && (
        <section className="card card-pad status-card" role={result.ok ? 'status' : 'alert'}>
          <div className={`status-icon ${result.ok ? 'ok' : 'denied'}`} aria-hidden="true">
            {result.ok ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            )}
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <h2>{result.ok ? 'Access granted' : `Access denied${result.status ? ` (HTTP ${result.status})` : ''}`}</h2>
            <p className="muted">{result.text}</p>
            {result.status === 401 && (
              <Link to="/login" className="btn btn-primary" style={{ alignSelf: 'flex-start', marginTop: 6 }}>
                Sign in
              </Link>
            )}
          </div>
        </section>
      )}

      {result?.ok && <ReviewQueue />}

      {result?.ok && (
        <section className="stack" aria-labelledby="upcoming-title">
          <h2 id="upcoming-title">Coming in later releases</h2>
          <ul className="todo-list">
            {UPCOMING.map((item) => (
              <li key={item.id}>
                <span className="badge" style={{ alignSelf: 'flex-start' }}>
                  {item.id}
                </span>
                <strong>{item.title}</strong>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
