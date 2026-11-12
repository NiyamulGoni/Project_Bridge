import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api, ApiError, STAGE_LABELS, STAGES, STATUS_LABELS, upload, type Stage, type Workspace } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Alert } from '../components/Alert';
import { FormField } from '../components/FormField';
import { CheckboxField, SelectField, TagInput, TextAreaField } from '../components/FormControls';
import { coverFor } from '../components/ProjectCard';

const LIMITS = { title: 120, summary: 200, problem: 2000, overview: 5000 };
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_SCREENSHOTS = 5;

/** The same checks the server makes, so a bad file is caught before the draft is created. */
function imageProblem(file: File): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return `${file.name} is not a PNG, JPEG or WebP image.`;
  if (file.size > MAX_IMAGE_BYTES) return `${file.name} is larger than 2 MB.`;
  return null;
}

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
  // A new project's images wait here and upload as soon as the draft exists.
  const [pendingCover, setPendingCover] = useState<File | null>(null);
  const [pendingShots, setPendingShots] = useState<File[]>([]);
  const coverPreview = useMemo(() => (pendingCover ? URL.createObjectURL(pendingCover) : null), [pendingCover]);
  const shotPreviews = useMemo(() => pendingShots.map((f) => URL.createObjectURL(f)), [pendingShots]);
  useEffect(() => () => void (coverPreview && URL.revokeObjectURL(coverPreview)), [coverPreview]);
  useEffect(() => () => shotPreviews.forEach((u) => URL.revokeObjectURL(u)), [shotPreviews]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    const state = location.state as { saved?: boolean; imageError?: string } | null;
    if (state?.imageError) setMessage({ tone: 'error', text: `Draft created, but ${state.imageError} Try adding them again below.` });
    else if (state?.saved) setMessage({ tone: 'success', text: 'Draft created. Keep editing, then preview and submit it for review.' });
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
  /** Images are the showcase: changeable on a draft and on a live project, not while in review. */
  const canEditImages = isDraft || isLive;

  function pickCover(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const problem = imageProblem(file);
    if (problem) return setMessage({ tone: 'error', text: problem });
    setPendingCover(file);
  }

  function pickShots(files: FileList | null) {
    if (!files?.length) return;
    const chosen = Array.from(files);
    const problem = chosen.map(imageProblem).find(Boolean);
    if (problem) return setMessage({ tone: 'error', text: problem });
    const room = MAX_SCREENSHOTS - pendingShots.length;
    if (chosen.length > room) setMessage({ tone: 'info', text: `A project can have at most ${MAX_SCREENSHOTS} screenshots, so only the first ${room} were added.` });
    setPendingShots((list) => [...list, ...chosen.slice(0, room)]);
  }

  /** Uploads a new draft's chosen images. Returns what failed, if anything, in words. */
  async function uploadPending(projectId: string): Promise<string | null> {
    const failed: string[] = [];
    if (pendingCover) {
      const data = new FormData();
      data.append('cover', pendingCover);
      await upload(`/projects/${projectId}/cover`, data).catch(() => failed.push('the cover image'));
    }
    if (pendingShots.length) {
      const data = new FormData();
      for (const file of pendingShots) data.append('screenshots', file);
      await upload(`/projects/${projectId}/media`, data).catch(() => failed.push('the screenshots'));
    }
    return failed.length ? `${failed.join(' and ')} could not be uploaded.` : null;
  }

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
        const imageError = await uploadPending(res.id);
        navigate(`/projects/${res.id}/edit`, { replace: true, state: { saved: true, imageError } });
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

      {!id && <p className="muted small">Fill in your project, add images if you have them, and create the draft. You can preview it before submitting it for review.</p>}
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
          {!id && (
            <div className="stack new-images">
              <h2 className="new-images-title">Images (optional)</h2>
              <p className="muted small">They upload when you create the draft. PNG, JPEG or WebP, up to 2 MB each.</p>
              <div className="stack">
                <strong className="small">Cover image</strong>
                <div className="cover-preview" style={{ background: coverFor({ tags: form.tags, title: form.title || 'P' }) }}>
                  {coverPreview ? <img src={coverPreview} alt="Chosen cover image" /> : <span className="muted small">No cover yet</span>}
                </div>
                <div className="row">
                  <label className="btn btn-secondary btn-sm file-button">
                    {pendingCover ? 'Replace cover' : 'Choose cover image'}
                    <input type="file" accept={IMAGE_TYPES.join(',')} className="visually-hidden" onChange={(e) => { pickCover(e.target.files); e.target.value = ''; }} />
                  </label>
                  {pendingCover && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPendingCover(null)}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <div className="stack">
                <strong className="small">
                  Screenshots ({pendingShots.length}/{MAX_SCREENSHOTS})
                </strong>
                {pendingShots.length > 0 && (
                  <ul className="screenshot-grid editable">
                    {shotPreviews.map((url, i) => (
                      <li key={url}>
                        <img src={url} alt={`Chosen screenshot ${i + 1}`} />
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPendingShots((list) => list.filter((_, j) => j !== i))}>
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {pendingShots.length < MAX_SCREENSHOTS && (
                  <label className="btn btn-secondary btn-sm file-button">
                    Choose screenshots
                    <input type="file" accept={IMAGE_TYPES.join(',')} multiple className="visually-hidden" onChange={(e) => { pickShots(e.target.files); e.target.value = ''; }} />
                  </label>
                )}
              </div>
            </div>
          )}
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
            {isLive && ' Changes show at once, without review.'}
            {locked && ' The cover cannot be changed while the project is in review.'}
          </p>
          <div className="cover-preview" style={{ background: coverFor(ws.project) }}>
            {ws.project.thumbnailUrl ? <img src={ws.project.thumbnailUrl} alt="Cover image" /> : <span className="muted small">No cover yet</span>}
          </div>
          {canEditImages && (
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
          <p className="muted small">
            Shown as a gallery on your project page. PNG, JPEG or WebP, up to 2 MB each, at most 5.
            {isLive && ' Changes show at once, without review.'}
            {locked && ' Screenshots cannot be changed while the project is in review.'}
          </p>
          {ws.media.length > 0 && (
            <ul className="screenshot-grid editable">
              {ws.media.map((m, i) => (
                <li key={m.id}>
                  {m.url ? <img src={m.url} alt={`Screenshot ${i + 1}`} /> : <div className="screenshot-missing">Screenshot {i + 1}</div>}
                  {canEditImages && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRemoveMedia(m.id)}>
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEditImages && ws.media.length < MAX_SCREENSHOTS && (
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
