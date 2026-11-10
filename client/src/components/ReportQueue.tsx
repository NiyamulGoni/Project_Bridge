import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError, type AdminReport } from '../api';
import { Alert } from './Alert';
import { TextDialog } from './TextDialog';

type Status = AdminReport['status'];

/**
 * FR13, FR14: the Admin report queue. Dismissing or confirming a report changes nothing about its target;
 * a confirmed report about a project is what allows that project to be removed.
 */
export function ReportQueue() {
  const [status, setStatus] = useState<Status>('OPEN');
  const [items, setItems] = useState<AdminReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dismissing, setDismissing] = useState<{ report: AdminReport; action: 'dismiss' | 'confirm' | 'remove' } | null>(null);
  const [evidence, setEvidence] = useState<{ reportId: string; items: Array<{ id: string; body: string | null; sender: { name: string }; createdAt: string }> } | null>(null);
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
      const { report, action } = dismissing;
      if (action === 'remove') await api(`/admin/projects/${report.targetId}/remove`, { body: { reason: note, reportId: report.id } });
      else await api(`/admin/reports/${report.id}/${action}`, { body: { note } });
      setDismissing(null);
      await load(status);
    } catch (err) {
      setDialogError(err instanceof ApiError ? err.message : 'Could not save the decision.');
    } finally {
      setBusy(false);
    }
  }

  // Each read is written to the audit log by the server.
  const readConversation = (reportId: string) =>
    api<{ items: Array<{ id: string; body: string | null; sender: { name: string }; createdAt: string }> }>(`/admin/reports/${reportId}/conversation`)
      .then((res) => setEvidence({ reportId, items: res.items }))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the conversation.'));

  const DIALOG = {
    dismiss: { title: 'Dismiss this report', intro: 'The report is closed with no action on its target, and the reporter is notified.', submit: 'Dismiss report' },
    confirm: { title: 'Confirm this report', intro: 'This records that the report is correct. It changes nothing by itself; a confirmed report about a project lets you remove that project.', submit: 'Confirm report' },
    remove: { title: 'Remove the reported project', intro: 'The project disappears from Explore, search and direct links, and the owner is told why. Their account is not affected.', submit: 'Remove project' },
  };

  return (
    <section className="stack" aria-labelledby="reports-title">
      <div className="row space-between">
        <h2 id="reports-title">Reports</h2>
        <div className="row" role="tablist" aria-label="Report status">
          {(['OPEN', 'CONFIRMED', 'DISMISSED'] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={status === s} className={`btn btn-sm ${status === s ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStatus(s)}>
              {s.charAt(0) + s.slice(1).toLowerCase()}
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
          <p className="muted">No {status.toLowerCase()} reports.</p>
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
            <div className="row">
              {r.status === 'OPEN' && (
                <>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setDismissing({ report: r, action: 'confirm' })}>
                    Confirm
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDismissing({ report: r, action: 'dismiss' })}>
                    Dismiss
                  </button>
                </>
              )}
              {r.status === 'OPEN' && r.targetType === 'CONVERSATION' && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => (evidence?.reportId === r.id ? setEvidence(null) : readConversation(r.id))}>
                  {evidence?.reportId === r.id ? 'Hide messages' : 'Read the conversation (audited)'}
                </button>
              )}
              {r.status === 'CONFIRMED' && r.targetType === 'PROJECT' && (
                <button type="button" className="btn btn-danger btn-sm" onClick={() => setDismissing({ report: r, action: 'remove' })}>
                  Remove project
                </button>
              )}
            </div>
            {evidence?.reportId === r.id && (
              <ul className="audit-list">
                {evidence.items.length === 0 && <li className="muted small">No messages.</li>}
                {evidence.items.map((m) => (
                  <li key={m.id} className="small">
                    <strong>{m.sender.name}</strong>{' '}
                    <time className="muted" dateTime={m.createdAt}>
                      {new Date(m.createdAt).toLocaleString()}
                    </time>
                    <p className="comment-body">{m.body ?? 'This message cannot be shown.'}</p>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}

      {dismissing && (
        <TextDialog
          title={DIALOG[dismissing.action].title}
          intro={DIALOG[dismissing.action].intro}
          label="Reason for the decision"
          submitLabel={DIALOG[dismissing.action].submit}
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
