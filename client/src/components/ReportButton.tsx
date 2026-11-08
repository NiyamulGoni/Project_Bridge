import { useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth/AuthContext';
import { TextDialog } from './TextDialog';

type Target = 'PROJECT' | 'COMMENT' | 'USER' | 'OFFER' | 'CONVERSATION';

/** FR13: any signed-in Uploader or Professional, Restricted ones included, can report. Admins act on reports instead. */
export function ReportButton({ targetType, targetId, label = 'Report', className = 'btn btn-ghost btn-sm' }: { targetType: Target; targetId: string; label?: string; className?: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  if (!user || user.role === 'ADMIN') return null;

  async function send(reason: string) {
    setBusy(true);
    setError('');
    try {
      await api('/reports', { body: { targetType, targetId, reason } });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the report.');
    } finally {
      setBusy(false);
    }
  }

  const close = () => {
    setOpen(false);
    setError('');
    setDone(false);
  };

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <TextDialog
          title={`Report this ${targetType.toLowerCase()}`}
          intro="Tell the Admins what is wrong, for example copied work or abuse. A report changes nothing until an Admin reviews it."
          label="What is wrong?"
          submitLabel="Send report"
          minLength={10}
          maxLength={1000}
          busy={busy}
          error={error}
          done={done ? 'Thank you. The Admins will review your report, and you will get a notification when it is closed.' : undefined}
          onSubmit={send}
          onClose={close}
        />
      )}
    </>
  );
}
