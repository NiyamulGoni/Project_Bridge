import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Alert } from '../components/Alert';
import { AuthLayout } from '../components/AuthLayout';
import { FormField, PasswordChecklist } from '../components/FormField';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { emailProblem, nameProblem, passwordProblem } from '../passwordRules';

export function Register() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError('');
    const found: Record<string, string | undefined> = {
      name: nameProblem(form.name),
      email: emailProblem(form.email),
      password: passwordProblem(form.password),
      confirm: form.password !== form.confirm ? 'Passwords do not match.' : undefined,
    };
    const problems = Object.fromEntries(Object.entries(found).filter(([, v]) => v)) as Record<string, string>;
    if (Object.keys(problems).length) {
      setErrors(problems);
      setFormError('Please correct the highlighted fields.');
      return;
    }
    setSubmitting(true);
    try {
      // Registering also signs the new account in.
      await api('/auth/register', { body: { name: form.name, email: form.email, password: form.password } });
      await refresh();
      navigate('/account', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setFormError(err.message);
      } else setFormError('Something went wrong.');
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="New accounts start as Uploaders. Professional access is granted by an Admin after review."
      footer={
        <span>
          Already registered? <Link to="/login">Sign in</Link>
        </span>
      }
    >
      <GoogleSignInButton text="signup_with" />
      {formError && <Alert tone="error">{formError}</Alert>}
      <form className="form" onSubmit={handleSubmit} noValidate>
        <FormField
          label="Full name"
          autoComplete="name"
          hint="Letters only. Spaces, hyphens, apostrophes and periods are fine."
          value={form.name}
          onChange={update('name')}
          error={errors.name}
          maxLength={80}
          required
        />
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="name@example.com"
          value={form.email}
          onChange={update('email')}
          error={errors.email}
          required
        />
        <FormField
          label="Password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={update('password')}
          error={errors.password}
          maxLength={128}
          required
        >
          <PasswordChecklist value={form.password} />
        </FormField>
        <FormField
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          value={form.confirm}
          onChange={update('confirm')}
          error={errors.confirm}
          required
        />
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthLayout>
  );
}
