import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Alert } from './Alert';
import { TextAreaField } from './FormControls';

interface Props {
  title: string;
  intro?: ReactNode;
  label: string;
  submitLabel: string;
  minLength?: number;
  maxLength: number;
  busy: boolean;
  error?: string;
  /** Shown instead of the form once the action has succeeded. */
  done?: ReactNode;
  onSubmit: (text: string) => void;
  onClose: () => void;
}

/** A modal with one text box, for reports, contact requests and Admin decision notes. */
export function TextDialog({ title, intro, label, submitLabel, minLength = 1, maxLength, busy, error, done, onSubmit, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit(text.trim());
  }

  return (
    <dialog ref={ref} className="dialog card" onCancel={onClose} aria-labelledby="text-dialog-title">
      <div className="form">
        <h2 id="text-dialog-title">{title}</h2>
        {done ? (
          <>
            <Alert tone="success">{done}</Alert>
            <button type="button" className="btn btn-primary" onClick={onClose} style={{ alignSelf: 'flex-start' }}>
              Close
            </button>
          </>
        ) : (
          <form className="form" onSubmit={submit}>
            {intro && <p className="muted">{intro}</p>}
            {error && <Alert tone="error">{error}</Alert>}
            <TextAreaField
              label={label}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={maxLength}
              rows={4}
              disabled={busy}
              hint={minLength > 1 ? `At least ${minLength} characters.` : undefined}
              autoFocus
            />
            <div className="row">
              <button type="submit" className="btn btn-primary" disabled={busy || text.trim().length < minLength}>
                {busy ? 'Sending…' : submitLabel}
              </button>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
