import { z } from 'zod';

/** Plain text. It is stored and returned exactly as typed; the browser shows it as text, never as HTML. */
export const commentSchema = z.object({
  body: z
    .string({ required_error: 'Write a comment.' })
    .trim()
    .min(1, 'Write a comment.')
    .max(500, 'Comments can be at most 500 characters.'),
});
