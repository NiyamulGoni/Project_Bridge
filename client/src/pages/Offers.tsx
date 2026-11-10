import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiError, OFFER_TYPE_LABELS, type MyOffer, type MyProject } from '../api';
import { Alert } from '../components/Alert';
import { SelectField, TextAreaField } from '../components/FormControls';
import { FormField } from '../components/FormField';

const REVIEW_BADGE: Record<MyOffer['reviewStatus'], { label: string; badge: string }> = {
  PENDING: { label: 'In review', badge: 'badge-navy' },
  APPROVED: { label: 'Approved', badge: 'badge-success' },
  REJECTED: { label: 'Not approved', badge: 'badge-amber' },
};
const EMPTY = { projectId: '', title: '', skills: '', type: 'FIXED', compensation: '', currency: 'BDT', applicationRoute: '' };

/** FR11: a Professional's own paid offers, and the form to post one on a project they own or edit. */
export function Offers() {
  const [offers, setOffers] = useState<MyOffer[] | null>(null);
  const [projects, setProjects] = useState<MyProject[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    api<{ items: MyOffer[] }>('/offers/mine')
      .then((res) => setOffers(res.items))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load your offers.'));
  }, []);
  useEffect(() => {
    load();
    api<{ items: MyProject[] }>('/projects/mine')
      .then((res) => setProjects(res.items.filter((p) => p.status === 'PUBLISHED')))
      .catch(() => undefined);
  }, [load]);

  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    setFields({});
    try {
      await api('/offers', { body: { ...form, skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean) } });
      setForm(EMPTY);
      setNotice('Offer submitted. It becomes visible to Professionals once an Admin approves it.');
      load();
    } catch (err) {
      if (err instanceof ApiError) {
        setFields(err.fields);
        setError(err.message);
      } else setError('Could not submit the offer.');
    } finally {
      setBusy(false);
    }
  }

  async function close(id: string) {
    setError('');
    try {
      await api(`/offers/${id}/close`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not close the offer.');
    }
  }

  return (
    <main className="page page-narrow stack">
      <header className="page-header">
        <h1>My paid offers</h1>
        <p className="muted">Offer paid work on a project you own or edit. ProjectBridge does not process payments; you arrange them directly.</p>
      </header>
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <section className="card card-pad stack" aria-labelledby="new-offer-title">
        <h2 id="new-offer-title">Post an offer</h2>
        {projects.length === 0 ? (
          <p className="muted">
            You need a published project first. See <Link to="/my-projects">My projects</Link>.
          </p>
        ) : (
          <form className="form" onSubmit={submit}>
            <SelectField label="Project" value={form.projectId} onChange={set('projectId')} error={fields.projectId} required>
              <option value="">Choose a project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </SelectField>
            <FormField label="Title" value={form.title} onChange={set('title')} error={fields.title} maxLength={120} required />
            <FormField label="Skills needed" value={form.skills} onChange={set('skills')} error={fields.skills} hint="Separate with commas, for example: react, figma" required />
            <SelectField label="Type" value={form.type} onChange={set('type')} error={fields.type}>
              {Object.entries(OFFER_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
            <div className="row">
              <FormField label="Compensation" value={form.compensation} onChange={set('compensation')} error={fields.compensation} hint="For example 25000, or 500 per hour" required />
              <FormField label="Currency" value={form.currency} onChange={set('currency')} error={fields.currency} maxLength={3} required />
            </div>
            <TextAreaField label="How to apply" value={form.applicationRoute} onChange={set('applicationRoute')} error={fields.applicationRoute} maxLength={500} rows={3} required />
            <button type="submit" className="btn btn-primary" disabled={busy} style={{ alignSelf: 'flex-start' }}>
              {busy ? 'Submitting…' : 'Submit for review'}
            </button>
          </form>
        )}
      </section>

      <section className="stack" aria-labelledby="my-offers-title">
        <h2 id="my-offers-title">Your offers</h2>
        {offers === null && <p className="muted">Loading…</p>}
        {offers?.length === 0 && <p className="muted">You have not posted any offers yet.</p>}
        {offers?.map((o) => (
          <article key={o.id} className="card card-pad stack">
            <div className="row space-between">
              <strong>{o.title}</strong>
              <span className="row">
                <span className={`badge ${REVIEW_BADGE[o.reviewStatus].badge}`}>{REVIEW_BADGE[o.reviewStatus].label}</span>
                {o.status === 'CLOSED' && <span className="badge">Closed</span>}
              </span>
            </div>
            <p className="small muted">
              On <Link to={`/projects/${o.project.id}`}>{o.project.title}</Link> · {OFFER_TYPE_LABELS[o.type] ?? o.type} · {o.compensation} {o.currency}
            </p>
            {o.reviewNote && <p className="small">Admin note: {o.reviewNote}</p>}
            {o.status === 'OPEN' && o.reviewStatus !== 'REJECTED' && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => close(o.id)} style={{ alignSelf: 'flex-start' }}>
                Close offer
              </button>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
