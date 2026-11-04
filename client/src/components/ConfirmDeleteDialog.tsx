import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FormField } from './FormField';

interface Props {
  title: string;
  error?: string;
  busy: boolean;
  onConfirm: (typedTitle: string) => void;
  onCancel: () => void;
}

/** FR04: deletion needs explicit confirmation, made deliberate by typing the project title. */
export function ConfirmDeleteDialog({ title, error, busy, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    onConfirm(typed);
  }

  return (
    <dialog ref={ref} className="dialog card" onCancel={onCancel} aria-labelledby="delete-title">
      <form className="form" onSubmit={submit}>
        <h2 id="delete-title">Delete “{title}”?</h2>
        <p className="muted">
          This permanently removes the project content, screenshots, progress, milestones and team. It disappears from Explore
          and search and can no longer receive contact requests. This cannot be undone. If you only want to take it offline for a
          while, hide it instead.
        </p>
        <FormField label="Type the project title to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} error={error} autoComplete="off" />
        <div className="row">
          <button type="submit" className="btn btn-danger" disabled={busy || typed.trim() !== title}>
            {busy ? 'Deleting…' : 'Delete project'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
