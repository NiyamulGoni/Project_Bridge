import { useId, type InputHTMLAttributes } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

/** Labelled input whose hint and error are announced by screen readers (NFR-U2). */
export function FormField({ label, error, hint, ...input }: Props) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      <input
        id={id}
        className="input"
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        {...input}
      />
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
