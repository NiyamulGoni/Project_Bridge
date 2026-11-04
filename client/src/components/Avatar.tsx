// Dark enough for white initials to meet WCAG AA contrast.
const COLORS = ['#0f766e', '#1d4ed8', '#7c3aed', '#b45309', '#be123c', '#1b3352', '#047857', '#4338ca'];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

export function colorFor(text: string): string {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.4, background: colorFor(name) }}
    >
      {initials(name)}
    </span>
  );
}
