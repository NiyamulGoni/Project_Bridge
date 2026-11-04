import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiError } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Alert } from '../components/Alert';
import { AuthLayout } from '../components/AuthLayout';
import { FormField } from '../components/FormField';
import { GoogleSignInButton } from '../components/GoogleSignInButton';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/account';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', 'Something went wrong.');
      setErrors(apiErr.fields);
      setError(apiErr);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back to ProjectBridge."
      footer={
        <>
          <Link to="/forgot-password">Forgot your password?</Link>
          <span>
            New to ProjectBridge? <Link to="/register">Create an account</Link>
          </span>
        </>
      }
    >
      <GoogleSignInButton />
      {error && (
        <Alert tone="error">
          <strong>{error.code === 'ACCOUNT_DISABLED' ? 'Account disabled. ' : ''}</strong>
          {error.message}
        </Alert>
      )}
      <form className="form" onSubmit={handleSubmit} noValidate>
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          required
        />
        <FormField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          required
        />
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  );
}
