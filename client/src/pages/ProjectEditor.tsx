import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api, ApiError, STAGE_LABELS, STAGES, STATUS_LABELS, upload, type Stage, type Workspace } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Alert } from '../components/Alert';
import { FormField } from '../components/FormField';
import { CheckboxField, SelectField, TagInput, TextAreaField } from '../components/FormControls';
import { coverFor } from '../components/ProjectCard';

const LIMITS = { title: 120, summary: 200, problem: 2000, overview: 5000 };

interface Form {
  title: string;
  summary: string;
  problem: string;
  overview: string;
  tags: string[];
  stage: Stage;
  demoUrl: string;
  publicDemo: boolean;
}

const EMPTY: Form = { title: '', summary: '', problem: '', overview: '', tags: [], stage: 'IDEA', demoUrl: '', publicDemo: false };

/** Live projects edit the pending revision if there is one, so the owner keeps building on it. */
function formFrom(ws: Workspace): Form {
  const source = ws.revision?.status === 'PENDING' ? ws.revision : ws.project;
  return {
    title: source.title,
    summary: source.summary,
    problem: source.problem,
    overview: source.overview,
    tags: source.tags,
    demoUrl: source.demoUrl ?? '',
    stage: ws.project.stage,
    publicDemo: ws.project.publicDemo,
  };
}

/** FR02 create/edit a draft, preview and submit; FR03 propose changes to a live project. */
export function ProjectEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [ws, setWs] = useState<Workspace | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [declared, setDeclared] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    if ((location.state as { saved?: boolean } | null)?.saved) setMessage({ tone: 'success', text: 'Draft created. Keep editing, or add screenshots below.' });
    api<Workspace>(`/projects/${id}/workspace`)
      .then((res) => {
        setWs(res);
        setForm(formFrom(res));
      })
      .catch((err) => setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Could not load the project.' }))
      .finally(() => setLoading(false));
  }, [id]);

  const status = ws?.project.status ?? 'DRAFT';
  const isDraft = status === 'DRAFT' || status === 'CHANGES_REQUESTED';
  const isLive = status === 'PUBLISHED' || status === 'HIDDEN';
  const locked = status === 'SUBMITTED' || status === 'REMOVED';
  const isOwner = !ws || ws.myRole === 'OWNER';

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  }

  function fail(err: unknown, fallback: string) {
    if (err instanceof ApiError) {
      setErrors(err.fields);
      setMessage({ tone: 'error', text: err.message });
    } else setMessage({ tone: 'error', text: fallback });
  }

  async function save(): Promise<boolean> {
    setErrors({});
    setMessage(null);
    try {
      if (!id) {
        const res = await api<{ id: string }>('/projects', { body: form });
        navigate(`/projects/${res.id}/edit`, { replace: true, state: { saved: true } });
        return true;
      }
      const res = await api<Workspace>(`/projects/${id}`, { method: 'PATCH', body: form });
      setWs(res);
      setForm(formFrom(res));
      return true;
    } catch (err) {
      fail(err, 'Could not save the project.');
      return false;
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await save();
    setBusy(false);
    if (ok && id) {
      setMessage({
        tone: 'success',
        text: isLive ? 'Changes sent for Admin review. The current version stays live until approved.' : 'Draft saved.',
      });
    }
  }

  async function onSubmitForReview() {
    if (!id) return;
    setBusy(true);
    if (await save()) {
      try {
        await api(`/projects/${id}/submit`, { body: { ownershipDeclared: declared } });
        navigate('/my-projects', { state: { flash: 'Submitted for Admin review. You will see the result in My projects.' } });
        return;
      } catch (err) {
        fail(err, 'Could not submit the project.');
      }
    }
    setBusy(false);
  }

  async function onUpload(files: FileList | null) {
    if (!id || !files?.length) return;
    const data = new FormData();
    for (const file of Array.from(files)) data.append('screenshots', file);
    setBusy(true);
    setMessage(null);
    try {
      setWs(await upload<Workspace>(`/projects/${id}/media`, data));
    } catch (err) {
      fail(err, 'Could not upload the screenshots.');
    } finally {
      setBusy(false);
    }
  }

  async function onUploadCover(files: FileList | null) {
    if (!id || !files?.length) return;
    const data = new FormData();
    data.append('cover', files[0]);
    setBusy(true);
    setMessage(null);
    try {
      setWs(await upload<Workspace>(`/projects/${id}/cover`, data));
    } catch (err) {
      fail(err, 'Could not upload the cover image.');
    } finally {
      setBusy(false);
    }
  }

  async function onRemoveCover() {
    if (!id) return;
    try {
      setWs(await api<Workspace>(`/projects/${id}/cover`, { method: 'DELETE' }));
    } catch (err) {
      fail(err, 'Could not remove the cover image.');
    }
  }

  async function onRemoveMedia(mediaId: string) {
    if (!id) return;
    try {
      await api(`/projects/${id}/media/${mediaId}`, { method: 'DELETE' });
      setWs(await api<Workspace>(`/projects/${id}/workspace`));
    } catch (err) {
      fail(err, 'Could not remove the screenshot.');
    }
  }

  if (user && user.role === 'ADMIN' && !id) {
    return (
      <main className="page page-narrow">
        <Alert tone="info">Admins review projects but do not publish their own.</Alert>
      </main>
    );
  }
  if (loading) {
    return (
      <p className="page muted" role="status">
        Loading project…
      </p>
    );
  }
  if (id && !ws) {
    return (
      <main className="page page-narrow">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        <Link to="/my-projects">← My projects</Link>
      </main>
    );
  }

  const revision = ws?.revision;

  return (
    <main className="page page-narrow stack">
      <Link to="/my-projects" className="back-link">
        ← My projects
      </Link>
      <header className="page-header">
        <h1>{id ? 'Edit project' : 'New project'}</h1>
        {ws && (
          <div className="row">
            <span className={`badge ${STATUS_LABELS[status].badge}`}>{STATUS_LABELS[status].label}</span>
            {revision?.status === 'PENDING' && <span className="badge badge-navy">Changes in review</span>}
            <Link to={`/projects/${id}/preview`}>Preview</Link>
            <Link to={`/projects/${id}/manage`}>Progress &amp; team</Link>
          </div>
        )}
      </header>

      {!id && <p className="muted small">Create the draft first, then you can add a cover image and screenshots and submit it for review.</p>}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {status === 'CHANGES_REQUESTED' && ws?.project.reviewNote && (
        <Alert tone="info">
          <strong>Admin requested changes:</strong> {ws.project.reviewNote}
        </Alert>
      )}
      {status === 'SUBMITTED' && <Alert tone="info">This project is waiting for Admin review. You can edit it again once it has been reviewed.</Alert>}
      {status === 'REMOVED' && <Alert tone="error">This project was removed by an Admin and can no longer be edited.</Alert>}
      {isLive && (
        <Alert tone="info">
          This project is live. Changes to the title, summary, problem, overview, tags or demo link go to Admin review, and
          the current version stays visible until they are approved. Stage and demo visibility change immediately.
        </Alert>
      )}
      {revision?.status === 'REJECTED' && (
        <Alert tone="error">
          <strong>Your last change was not approved:</strong> {revision.reviewNote}
        </Alert>
      )}

      <form className="card card-pad form" onSubmit={onSave} noValidate>
        <fieldset disabled={locked || busy} className="form">
          <FormField label="Project title" value={form.title} maxLength={LIMITS.title} error={errors.title} onChange={(e) => set('title', e.target.value)} required />
          <TextAreaField
            label="Summary"
            hint="One or two sentences shown on project cards. Guests see up to 150 characters."
            rows={2}
            maxLength={LIMITS.summary}
            value={form.summary}
            error={errors.summary}
            onChange={(e) => set('summary', e.target.value)}
          />
          <TextAreaField
            label="Problem"
            hint="Who has this problem and why does it matter? Shown in full to Professionals."
            rows={4}
            maxLength={LIMITS.problem}
            value={form.problem}
            error={errors.problem}
            onChange={(e) => set('problem', e.target.value)}
          />
          <TextAreaField
            label="Solution / overview"
            hint="How your project solves it. Uploaders see the first 500 characters; Professionals see all of it."
            rows={8}
            maxLength={LIMITS.overview}
            value={form.overview}
            error={errors.overview}
            onChange={(e) => set('overview', e.target.value)}
          />
          <TagInput label="Tags" tags={form.tags} onChange={(t) => set('tags', t)} error={errors.tags} disabled={locked} />
          <SelectField label="Stage" value={form.stage} error={errors.stage} onChange={(e) => set('stage', e.target.value as Stage)}>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </SelectField>
          <FormField
            label="Demonstration link"
            type="url"
            inputMode="url"
            placeholder="https://"
            hint="A secure (https://) link to a live demo, video or prototype."
            value={form.demoUrl}
            error={errors.demoUrl}
            onChange={(e) => set('demoUrl', e.target.value)}
          />
          <CheckboxField
            label="Show my demo link and screenshots to other Uploaders"
            hint="Professionals always see them. Guests never do."
            checked={form.publicDemo}
            onChange={(v) => set('publicDemo', v)}
            disabled={locked}
          />
          <div className="row">
            <button type="submit" className="btn btn-secondary" disabled={busy || locked}>
              {busy ? 'Saving…' : isLive ? 'Send changes for review' : id ? 'Save draft' : 'Create draft'}
            </button>
          </div>
        </fieldset>
      </form>

      {id && ws && (
        <section className="card card-pad stack" aria-labelledby="cover-title">
          <h2 id="cover-title">Cover image (optional)</h2>
          <p className="muted small">
            Shown at the top of your project card to everyone, Guests included. A wide PNG, JPEG or WebP photo works best, up to 2 MB.
            {!isDraft && ' The cover can be changed while the project is a draft.'}
          </p>
          <div className="cover-preview" style={{ background: coverFor(ws.project) }}>
            {ws.project.thumbnailUrl ? <img src={ws.project.thumbnailUrl} alt="Cover image" /> : <span className="muted small">No cover yet</span>}
          </div>
          {isDraft && (
            <div className="row">
              <label className="btn btn-secondary file-button">
                {ws.project.thumbnailUrl ? 'Replace cover' : 'Add cover image'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="visually-hidden"
                  disabled={busy}
                  onChange={(e) => {
                    void onUploadCover(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
              {ws.project.thumbnailUrl && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onRemoveCover}>
                  Remove
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {id && ws && (
        <section className="card card-pad stack" aria-labelledby="shots-title">
          <h2 id="shots-title">Screenshots (optional)</h2>
          <p className="muted small">PNG, JPEG or WebP, up to 2 MB each, at most 5.{!isDraft && ' Screenshots can be changed while the project is a draft.'}</p>
          {ws.media.length > 0 && (
            <ul className="screenshot-grid editable">
              {ws.media.map((m, i) => (
                <li key={m.id}>
                  {m.url ? <img src={m.url} alt={`Screenshot ${i + 1}`} /> : <div className="screenshot-missing">Screenshot {i + 1}</div>}
                  {isDraft && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRemoveMedia(m.id)}>
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {isDraft && ws.media.length < 5 && (
            <label className="btn btn-secondary file-button">
              Add screenshots
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="visually-hidden"
                disabled={busy}
                onChange={(e) => {
                  void onUpload(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </section>
      )}

      {id && isDraft && (
        <section className="card card-pad stack" aria-labelledby="submit-title">
          <h2 id="submit-title">Submit for review</h2>
          {isOwner ? (
            <>
              <p className="muted">
                An Admin checks every project before it is published. <Link to={`/projects/${id}/preview`}>Preview it first</Link> to see
                what Professionals will see.
              </p>
              <CheckboxField
                label="I own this work, or have the right to share it, and it contains no one else's confidential material."
                checked={declared}
                onChange={setDeclared}
                error={errors.ownershipDeclared}
              />
              <button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={onSubmitForReview}>
                {busy ? 'Submitting…' : 'Save and submit for review'}
              </button>
            </>
          ) : (
            <p className="muted">Only the project owner can submit it for review.</p>
          )}
        </section>
      )}
    </main>
  );
}
