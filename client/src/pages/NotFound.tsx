import { Link } from 'react-router';

export function NotFound() {
  return (
    <main className="page not-found">
      <span className="code" aria-hidden="true">
        404
      </span>
      <h1>Page not found</h1>
      <p className="muted">The page you're looking for doesn't exist or has moved.</p>
      <Link to="/" className="btn btn-primary btn-lg" style={{ marginTop: 8 }}>
        Back to Explore
      </Link>
    </main>
  );
}
