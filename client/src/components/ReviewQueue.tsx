import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, STAGE_LABELS, type ProjectContent, type ReviewQueue as Queue } from '../api';
import { Alert } from './Alert';
import { TextAreaField } from './FormControls';

const FIELD_LABELS: Record<keyof ProjectContent, string> = {
  title: 'Title',
  summary: 'Summary',
  problem: 'Problem',
  overview: 'Solution / overview',
  tags: 'Tags',
  demoUrl: 'Demo link',
};

function show(value: ProjectContent[keyof ProjectContent]): string {
  if (Array.isArray(value)) return value.join(' ');
  return value ?? '—';
}

/** Approve, or send back with a note. Used for both submissions and revisions. */
function Decision({ onApprove, onReturn, returnLabel, busy }: { onApprove: () => void; onReturn: (note: string) => Promise<boolean>; returnLabel: string; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onApprove}>
          Approve
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {returnLabel}
        </button>
      </div>
      {open && (
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onReturn(note)) setOpen(false);
          }}
        >
          <TextAreaField label="Note to the owner" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} hint="Explain what needs to change." />
          <button type="submit" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy || note.trim().length < 3}>
            Send back
          </button>
        </form>
      )}
    </div>
  );
}

/** FR02/FR03 review queue: new submissions and changes to live projects. */
export function ReviewQueue() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setQueue(await api<Queue>('/admin/reviews'));
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Could not load the review queue.' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(path: string, success: string, note?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await api(path, { method: 'POST', body: note === undefined ? undefined : { note } });
      setMessage({ tone: 'success', text: success });
      await load();
      return true;
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? (Object.values(err.fields)[0] ?? err.message) : 'Action failed.' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!queue) return message ? <Alert tone={message.tone}>{message.text}</Alert> : <p className="muted">Loading review queue…</p>;

  const empty = queue.submissions.length === 0 && queue.revisions.length === 0;

  return (
    <section className="stack" aria-labelledby="queue-title">
      <h2 id="queue-title">
        Review queue <span className="badge badge-navy">{queue.submissions.length + queue.revisions.length}</span>
      </h2>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {empty && (
        <div className="card empty">
          <p className="muted">Nothing waiting for review.</p>
        </div>
      )}

      {queue.submissions.map((s) => (
        <article key={s.id} className="card card-pad stack review-item">
          <div className="row space-between">
            <div className="row">
              <span className="badge badge-accent">New submission</span>
              <span className="badge badge-amber">{STAGE_LABELS[s.stage]}</span>
            </div>
            <span className="muted small">
              {s.owner.name} ({s.owner.email}) · {s.submittedAt && new Date(s.submittedAt).toLocaleString()}
            </span>
          </div>
          <h3>{s.title}</h3>
          <dl className="details">
            {(Object.keys(FIELD_LABELS) as Array<keyof ProjectContent>)
              .filter((f) => f !== 'title')
              .map((f) => (
                <div key={f} style={{ display: 'contents' }}>
                  <dt>{FIELD_LABELS[f]}</dt>
                  <dd className="pre-wrap">
                    {f === 'demoUrl' && s.demoUrl ? (
                      <a href={s.demoUrl} target="_blank" rel="noopener noreferrer">
                        {s.demoUrl}
                      </a>
                    ) : (
                      show(s[f])
                    )}
                  </dd>
                </div>
              ))}
            <dt>Ownership</dt>
            <dd>{s.ownershipDeclaredAt ? `Declared ${new Date(s.ownershipDeclaredAt).toLocaleString()}` : 'Not declared'}</dd>
          </dl>
          {s.screenshots.length > 0 && (
            <div className="screenshot-grid">
              {s.screenshots.map((m, i) => (
                <a key={m.id} href={m.url} target="_blank" rel="noopener noreferrer">
                  <img src={m.url} alt={`Screenshot ${i + 1}`} />
                </a>
              ))}
            </div>
          )}
          <Decision
            busy={busy}
            returnLabel="Request changes"
            onApprove={() => decide(`/admin/reviews/projects/${s.id}/approve`, `“${s.title}” is now published.`)}
            onReturn={(note) => decide(`/admin/reviews/projects/${s.id}/request-changes`, `Changes requested for “${s.title}”.`, note)}
          />
        </article>
      ))}

      {queue.revisions.map((r) => {
        const changed = (Object.keys(FIELD_LABELS) as Array<keyof ProjectContent>).filter((f) => show(r.current[f]) !== show(r.proposed[f]));
        return (
          <article key={r.id} className="card card-pad stack review-item">
            <div className="row space-between">
              <span className="badge badge-navy">Change to a live project</span>
              <span className="muted small">
                {r.owner.name} · {new Date(r.submittedAt).toLocaleString()}
              </span>
            </div>
            <h3>{r.current.title}</h3>
            <p className="muted small">The current version stays live until you approve. Changed: {changed.map((f) => FIELD_LABELS[f]).join(', ') || 'nothing'}.</p>
            {changed.map((f) => (
              <div key={f} className="diff">
                <strong>{FIELD_LABELS[f]}</strong>
                <div className="diff-cols">
                  <div className="diff-old">
                    <span className="small muted">Current</span>
                    <p className="pre-wrap">{show(r.current[f])}</p>
                  </div>
                  <div className="diff-new">
                    <span className="small muted">Proposed</span>
                    <p className="pre-wrap">{show(r.proposed[f])}</p>
                  </div>
                </div>
              </div>
            ))}
            <Decision
              busy={busy}
              returnLabel="Reject change"
              onApprove={() => decide(`/admin/reviews/revisions/${r.id}/approve`, 'Change approved and now live.')}
              onReturn={(note) => decide(`/admin/reviews/revisions/${r.id}/reject`, 'Change rejected. The current version stays live.', note)}
            />
          </article>
        );
      })}
    </section>
  );
}
