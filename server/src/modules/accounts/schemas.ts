import { z } from 'zod';

const email = z
  .string({ required_error: 'Email is required.' })
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(254, 'Email is too long.');

/**
 * New accounts only: a plain local part, a dot-separated domain and a letters-only TLD of 2+.
 * Sign-in and forgot-password keep the looser check, so older addresses still work there.
 */
const STANDARD_EMAIL = /^[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const newEmail = email.refine((v) => STANDARD_EMAIL.test(v) && !v.includes('..'), 'Enter a valid email address, like name@example.com.');

/**
 * New passwords only. Sign-in does not apply these rules, so accounts made before them still work.
 * The client shows the same list, see client/src/passwordRules.ts.
 */
export const PASSWORD_RULES: { test: RegExp; message: string }[] = [
  { test: /[a-z]/, message: 'Password must include a lowercase letter.' },
  { test: /[A-Z]/, message: 'Password must include an uppercase letter.' },
  { test: /[0-9]/, message: 'Password must include a digit.' },
  { test: /[^A-Za-z0-9]/, message: 'Password must include a symbol, such as ! @ # or $.' },
];

const newPassword = PASSWORD_RULES.reduce(
  (schema, rule) => schema.regex(rule.test, rule.message),
  z
    .string({ required_error: 'Password is required.' })
    .min(8, 'Password must be at least 8 characters.')
    .max(128, 'Password must be at most 128 characters.'),
);

/** Letters from any alphabet, as words joined by single spaces, hyphens, apostrophes or a period ("Md. Rakibul"). */
const NAME = /^\p{L}[\p{L}\p{M}]*\.?(?:[ '-]\p{L}[\p{L}\p{M}]*\.?)*$/u;

const token = z.string({ required_error: 'Token is missing.' }).min(10, 'Token is invalid.').max(200);

// Unknown keys such as `role` are stripped by zod, so clients cannot choose their own role (FR01/FR15).
export const registerSchema = z.object({
  name: z
    .string({ required_error: 'Name is required.' })
    .trim()
    .min(2, 'Name must be at least 2 characters.')
    .max(80, 'Name must be at most 80 characters.')
    .regex(NAME, 'Name may contain only letters, spaces, hyphens, apostrophes and periods.'),
  email: newEmail,
  password: newPassword,
});

export const loginSchema = z.object({
  email,
  password: z.string({ required_error: 'Password is required.' }).min(1, 'Password is required.').max(128),
});

export const emailOnlySchema = z.object({ email });

export const googleSchema = z.object({
  credential: z.string({ required_error: 'Google credential is missing.' }).min(20).max(4096),
});

export const resetPasswordSchema = z.object({ token, password: newPassword });
