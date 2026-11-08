import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError, type AdminReport } from '../api';
import { Alert } from './Alert';
import { TextDialog } from './TextDialog';

type Status = AdminReport['status'];

/** FR13: the Admin report queue. Dismissing closes a report with no action on its target. */
export function ReportQueue() {
  const [status, setStatus] = useState<Status>('OPEN');
  const [items, setItems] = useState<AdminReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dismissing, setDismissing] = useState<AdminReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');

  const load = useCallback(async (s: Status) => {
    setLoading(true);
    setError('');
    try {
      const res = await api<{ items: AdminReport[] }>(`/admin/reports?status=${s}`);
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load reports.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(status);
  }, [status, load]);

  async function dismiss(note: string) {
    if (!dismissing) return;
    setBusy(true);
    setDialogError('');
    try {
      await api(`/admin/reports/${dismissing.id}/dismiss`, { body: { note } });
      setDismissing(null);
      await load(status);
    } catch (err) {
      setDialogError(err instanceof ApiError ? err.message : 'Could not dismiss the report.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack" aria-labelledby="reports-title">
      <div className="row space-between">
        <h2 id="reports-title">Reports</h2>
        <div className="row" role="tablist" aria-label="Report status">
          {(['OPEN', 'DISMISSED'] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={status === s} className={`btn btn-sm ${status === s ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStatus(s)}>
              {s === 'OPEN' ? 'Open' : 'Dismissed'}
            </button>
          ))}
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {loading && (
        <p className="muted" role="status">
          Loading reports…
        </p>
      )}
      {!loading && items.length === 0 && (
        <div className="card empty">
          <p className="muted">{status === 'OPEN' ? 'No open reports.' : 'No dismissed reports.'}</p>
        </div>
      )}

      {!loading &&
        items.map((r) => (
          <article key={r.id} className="card card-pad stack">
            <div className="row space-between">
              <div className="row">
                <span className="badge badge-navy">{r.targetType}</span>
                {r.targetType === 'PROJECT' ? (
                  <Link to={`/projects/${r.targetId}`}>Open the reported project</Link>
                ) : (
                  <span className="muted small">id {r.targetId}</span>
                )}
              </div>
              <time className="muted small" dateTime={r.createdAt}>
                {new Date(r.createdAt).toLocaleString()}
              </time>
            </div>
            <p className="comment-body">{r.reason ?? <span className="muted">The reason cannot be decrypted with the current key.</span>}</p>
            <p className="small muted">Reported by {r.reporter.name}</p>
            {r.decisionNote && <p className="small">Decision note: {r.decisionNote}</p>}
            {r.status === 'OPEN' && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDismissing(r)} style={{ alignSelf: 'flex-start' }}>
                Dismiss
              </button>
            )}
          </article>
        ))}

      {dismissing && (
        <TextDialog
          title="Dismiss this report"
          intro="The report is closed with no action on its target, and the reporter is notified."
          label="Reason for the decision"
          submitLabel="Dismiss report"
          minLength={3}
          maxLength={1000}
          busy={busy}
          error={dialogError}
          onSubmit={dismiss}
          onClose={() => {
            setDismissing(null);
            setDialogError('');
          }}
        />
      )}
    </section>
  );
}
