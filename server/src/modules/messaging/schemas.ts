import { z } from 'zod';

const id = z.string().trim().min(1).max(100);

/** A request is about a project (it goes to the owner) or to a person, never both. */
export const createRequestSchema = z
  .object({
    projectId: id.optional(),
    userId: id.optional(),
    /** Answering a paid offer: the request goes to the offer's author. */
    offerId: id.optional(),
    introduction: z
      .string({ required_error: 'Introduce yourself.' })
      .trim()
      .min(10, 'Introduce yourself in at least 10 characters.')
      .max(1000, 'Keep the introduction under 1000 characters.'),
  })
  .refine((body) => [body.projectId, body.userId, body.offerId].filter((v) => v !== undefined).length === 1, {
    message: 'Choose one thing to contact about: a project, a person or an offer.',
  });

export const listRequestsQuery = z.object({
  box: z.enum(['incoming', 'outgoing']).default('incoming'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
