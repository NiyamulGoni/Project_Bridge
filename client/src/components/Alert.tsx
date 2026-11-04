import type { ReactNode } from 'react';

type Tone = 'info' | 'success' | 'error';

/** Status messages use an icon and text as well as colour, not colour alone (NFR-U2). */
export function Alert({ tone, children }: { tone: Tone; children: ReactNode }) {
  const icon = tone === 'success' ? '✓' : tone === 'error' ? '!' : 'i';
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span className="alert-icon" aria-hidden="true">
        {icon}
      </span>
      <div>{children}</div>
    </div>
  );
}
