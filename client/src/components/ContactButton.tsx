import { useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../api';
import { useAuth } from '../auth/AuthContext';
import { TextDialog } from './TextDialog';

/**
 * FR10: send a contact request about a project (it reaches the owner), an offer (its author) or to a person.
 * Only active Uploaders and Professionals may; the server checks everything again.
 */
export function ContactButton({ projectId, userId, offerId, name, label, className = 'btn btn-secondary' }: { projectId?: string; userId?: string; offerId?: string; name: string; label: string; className?: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  if (!user || user.role === 'ADMIN' || user.status !== 'ACTIVE' || userId === user.id) return null;

  async function send(introduction: string) {
    setBusy(true);
    setError('');
    try {
      await api('/messaging/requests', { body: { ...(offerId ? { offerId } : projectId ? { projectId } : { userId }), introduction } });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the request.');
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
          title={`Contact ${name}`}
          intro="Introduce yourself and say why you want to talk. Your email is never shared; if they accept, a private conversation opens."
          label="Introduction"
          submitLabel="Send request"
          minLength={10}
          maxLength={1000}
          busy={busy}
          error={error}
          done={
            done ? (
              <>
                Request sent. You can follow it on <Link to="/requests">Requests</Link>.
              </>
            ) : undefined
          }
          onSubmit={send}
          onClose={close}
        />
      )}
    </>
  );
}
