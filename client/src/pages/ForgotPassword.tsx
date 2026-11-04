import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../api';
import { Alert } from '../components/Alert';
import { AuthLayout } from '../components/AuthLayout';
import { FormField } from '../components/FormField';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setMessage(null);
    setSubmitting(true);
    try {
      const res = await api<{ message: string }>('/auth/forgot-password', { body: { email } });
      setMessage({ tone: 'success', text: res.message });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setMessage({ tone: 'error', text: err.message });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your account email and we'll send you a link to choose a new password."
      footer={<Link to="/login">Back to sign in</Link>}
    >
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
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
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
    </AuthLayout>
  );
}
