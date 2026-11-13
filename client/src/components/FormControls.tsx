import { useId, useState, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

/** Shared label/hint/error wiring so every control is announced the same way (NFR-U2). */
function useDescribedBy(hint?: string, error?: string) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return { id, hintId, errorId, describedBy: [hintId, errorId].filter(Boolean).join(' ') || undefined };
}

function Messages({ hint, hintId, error, errorId }: { hint?: string; hintId?: string; error?: string; errorId?: string }) {
  return (
    <>
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </>
  );
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: string;
}

/** Labelled textarea with a live character count when maxLength is set. */
export function TextAreaField({ label, error, hint, maxLength, value, ...rest }: TextAreaProps) {
  const { id, hintId, errorId, describedBy } = useDescribedBy(hint, error);
  const length = typeof value === 'string' ? value.length : 0;
  return (
    <div className="field">
      <div className="field-label-row">
        <label htmlFor={id}>{label}</label>
        {maxLength && (
          <span className={`field-count${length > maxLength * 0.9 ? ' near' : ''}`} aria-hidden="true">
            {length}/{maxLength}
          </span>
        )}
      </div>
      <textarea
        id={id}
        className="input textarea"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        maxLength={maxLength}
        value={value}
        {...rest}
      />
      <Messages hint={hint} hintId={hintId} error={error} errorId={errorId} />
    </div>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}

export function SelectField({ label, error, hint, children, ...rest }: SelectProps) {
  const { id, hintId, errorId, describedBy } = useDescribedBy(hint, error);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="input" aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest}>
        {children}
      </select>
      <Messages hint={hint} hintId={hintId} error={error} errorId={errorId} />
    </div>
  );
}

interface CheckboxProps {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
  hint?: string;
  disabled?: boolean;
}

export function CheckboxField({ label, checked, onChange, error, hint, disabled }: CheckboxProps) {
  const { id, hintId, errorId, describedBy } = useDescribedBy(hint, error);
  return (
    <div className="field">
      <div className="checkbox-row">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        <label htmlFor={id}>{label}</label>
      </div>
      <Messages hint={hint} hintId={hintId} error={error} errorId={errorId} />
    </div>
  );
}

interface TagInputProps {
  label: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  max?: number;
  error?: string;
  hint?: string;
  disabled?: boolean;
}

/** Type a tag and press Enter or comma; tags are lowercase and unique. */
export function TagInput({ label, tags, onChange, max = 8, error, hint: customHint, disabled }: TagInputProps) {
  const hint = customHint ?? `Press Enter after each tag. Up to ${max}.`;
  const { id, hintId, errorId, describedBy } = useDescribedBy(hint, error);
  const [draft, setDraft] = useState('');

  function commit() {
    const tag = draft.trim().toLowerCase().replace(/^#/, '');
    if (tag && !tags.includes(tag) && tags.length < max) onChange([...tags, tag]);
    setDraft('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !draft && tags.length) {
      onChange(tags.slice(0, -1));
    }
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={`tag-input input${error ? ' invalid' : ''}`}>
        {tags.map((tag) => (
          <span key={tag} className="chip chip-removable">
            {tag}
            {!disabled && (
              <button type="button" aria-label={`Remove tag ${tag}`} onClick={() => onChange(tags.filter((t) => t !== tag))}>
                ×
              </button>
            )}
          </span>
        ))}
        {!disabled && tags.length < max && (
          <input
            id={id}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={commit}
            maxLength={30}
            placeholder={tags.length ? '' : 'e.g. iot, health'}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
          />
        )}
      </div>
      <Messages hint={hint} hintId={hintId} error={error} errorId={errorId} />
    </div>
  );
}
