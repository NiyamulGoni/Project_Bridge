import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthContext';

/** Convenience redirect only; the server enforces every permission itself. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <p className="page muted" role="status">
        Loading…
      </p>
    );
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}
