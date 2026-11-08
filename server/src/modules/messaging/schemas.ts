import { z } from 'zod';

const id = z.string().trim().min(1).max(100);

/** A request is about a project (it goes to the owner) or to a person, never both. */
export const createRequestSchema = z
  .object({
    projectId: id.optional(),
    userId: id.optional(),
    introduction: z
      .string({ required_error: 'Introduce yourself.' })
      .trim()
      .min(10, 'Introduce yourself in at least 10 characters.')
      .max(1000, 'Keep the introduction under 1000 characters.'),
  })
  .refine((body) => (body.projectId === undefined) !== (body.userId === undefined), {
    message: 'Choose either a project or a person to contact.',
  });

export const listRequestsQuery = z.object({
  box: z.enum(['incoming', 'outgoing']).default('incoming'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
