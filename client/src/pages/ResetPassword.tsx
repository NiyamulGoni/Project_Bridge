import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, ApiError } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Alert } from '../components/Alert';
import { AuthLayout } from '../components/AuthLayout';
import { FormField } from '../components/FormField';

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { refresh } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setMessage(null);
    if (password !== confirm) {
      setErrors({ confirm: 'Passwords do not match.' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await api<{ message: string }>('/auth/reset-password', { body: { token, password } });
      setMessage({ tone: 'success', text: res.message });
      // All sessions were revoked on the server.
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setMessage({ tone: 'error', text: err.fields.token ?? err.message });
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Choose a new password" footer={<Link to="/forgot-password">Request a new link</Link>}>
        <Alert tone="error">This reset link is missing its token.</Alert>
      </AuthLayout>
    );
  }

  if (message?.tone === 'success') {
    return (
      <AuthLayout title="Password changed">
        <Alert tone="success">{message.text}</Alert>
        <Link to="/login" className="btn btn-primary btn-block btn-lg">
          Sign in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="Pick a password you haven't used here before.">
      {message && (
        <Alert tone="error">
          {message.text} <Link to="/forgot-password">Request a new link</Link>
        </Alert>
      )}
      <form className="form" onSubmit={handleSubmit} noValidate>
        <FormField
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          required
        />
        <FormField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
          required
        />
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={submitting}>
          {submitting ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </AuthLayout>
  );
}
