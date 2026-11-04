import type { ReactNode } from 'react';
import { LogoMark } from './Logo';

/** Centred card shared by the sign-in, register and password pages. */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="auth-shell">
      <div className="auth-card card">
        <div className="auth-head">
          <LogoMark size={40} />
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {children}
        {footer && <div className="auth-footer">{footer}</div>}
      </div>
    </main>
  );
}
