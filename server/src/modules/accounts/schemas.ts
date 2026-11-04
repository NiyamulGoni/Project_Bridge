import { z } from 'zod';

const email = z
  .string({ required_error: 'Email is required.' })
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(254, 'Email is too long.');

const newPassword = z
  .string({ required_error: 'Password is required.' })
  .min(8, 'Password must be at least 8 characters.')
  .max(128, 'Password must be at most 128 characters.');

const token = z.string({ required_error: 'Token is missing.' }).min(10, 'Token is invalid.').max(200);

// Unknown keys such as `role` are stripped by zod, so clients cannot choose their own role (FR01/FR15).
export const registerSchema = z.object({
  name: z
    .string({ required_error: 'Name is required.' })
    .trim()
    .min(2, 'Name must be at least 2 characters.')
    .max(80, 'Name must be at most 80 characters.'),
  email,
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
