import { Link } from 'react-router';

export function GuestCapPrompt({ limit }: { limit: number }) {
  return (
    <section className="card cta" aria-labelledby="cap-title">
      <div className="cta-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      </div>
      <h2 id="cap-title">You've explored {limit} projects as a guest</h2>
      <p>Create a free account to keep browsing, read longer project overviews and connect with project teams.</p>
      <div className="actions">
        <Link to="/register" className="btn btn-primary">
          Create free account
        </Link>
        <Link to="/login" className="btn btn-secondary">
          Sign in
        </Link>
      </div>
    </section>
  );
}
