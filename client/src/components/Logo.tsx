import { Link } from 'react-router';

/** Bridge mark: two pillars joined by an arch, in the brand teal. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="#0f766e" />
      <path d="M5 21c3.5-7 18.5-7 22 0" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M5 23h22" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M10 23v-4.6M16 23v-6M22 23v-4.6" stroke="#9fe0d8" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="ProjectBridge home">
      <LogoMark />
      <span className="logo-text" aria-hidden="true">
        Project<span>Bridge</span>
      </span>
    </Link>
  );
}
