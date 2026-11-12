/**
 * Instant feedback for the account forms. The server enforces the same rules
 * (server/src/modules/accounts/schemas.ts) and has the final say.
 */
export const PASSWORD_RULES: { label: string; test: (value: string) => boolean }[] = [
  { label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { label: 'An uppercase letter (A–Z)', test: (v) => /[A-Z]/.test(v) },
  { label: 'A lowercase letter (a–z)', test: (v) => /[a-z]/.test(v) },
  { label: 'A digit (0–9)', test: (v) => /[0-9]/.test(v) },
  { label: 'A symbol, such as ! @ # or $', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export function passwordProblem(value: string): string | undefined {
  const missing = PASSWORD_RULES.filter((r) => !r.test(value));
  return missing.length ? `Your password still needs: ${missing.map((r) => r.label.toLowerCase()).join(', ')}.` : undefined;
}

const NAME = /^\p{L}[\p{L}\p{M}]*\.?(?:[ '-]\p{L}[\p{L}\p{M}]*\.?)*$/u;

export function nameProblem(value: string): string | undefined {
  const name = value.trim();
  if (name.length < 2) return 'Name must be at least 2 characters.';
  if (name.length > 80) return 'Name must be at most 80 characters.';
  if (!NAME.test(name)) return 'Name may contain only letters, spaces, hyphens, apostrophes and periods.';
  return undefined;
}

const EMAIL = /^[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

export function emailProblem(value: string): string | undefined {
  const email = value.trim().toLowerCase();
  if (!email) return 'Email is required.';
  if (!EMAIL.test(email) || email.includes('..')) return 'Enter a valid email address, like name@example.com.';
  return undefined;
}
