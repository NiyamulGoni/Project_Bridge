import { z } from 'zod';
import { MILESTONE_STATUSES, PROJECT_STAGES } from '../../domain.js';

export const LIMITS = { title: 120, summary: 200, problem: 2000, overview: 5000, tags: 8, tag: 30, url: 500 };

const title = z
  .string({ required_error: 'Title is required.' })
  .trim()
  .min(3, 'Title must be at least 3 characters.')
  .max(LIMITS.title, `Title must be at most ${LIMITS.title} characters.`);

const tag = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(LIMITS.tag, `Tags must be at most ${LIMITS.tag} characters.`)
  .regex(/^[a-z0-9][a-z0-9 +#.-]*$/, 'Tags may use letters, numbers, spaces and - + # . only.');

const tags = z
  .array(tag)
  .max(LIMITS.tags, `Use at most ${LIMITS.tags} tags.`)
  .transform((list) => [...new Set(list)]);

/** FR02: the demonstration link must be HTTPS. Empty clears it. */
export const httpsUrl = z
  .string()
  .trim()
  .max(LIMITS.url, 'Link is too long.')
  .refine((v) => {
    try {
      return new URL(v).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Enter a full link starting with https://');

const optionalUrl = z.union([z.literal('').transform(() => null), z.null(), httpsUrl]);

const content = {
  title,
  summary: z.string().trim().max(LIMITS.summary, `Summary must be at most ${LIMITS.summary} characters.`),
  problem: z.string().trim().max(LIMITS.problem, `Problem must be at most ${LIMITS.problem} characters.`),
  overview: z.string().trim().max(LIMITS.overview, `Overview must be at most ${LIMITS.overview} characters.`),
  tags,
  stage: z.enum(PROJECT_STAGES, { errorMap: () => ({ message: 'Choose a stage.' }) }),
  demoUrl: optionalUrl,
  publicDemo: z.boolean(),
};

/** Drafts may be saved incomplete; only the title is required (FR02). */
export const createProjectSchema = z.object(content).partial().required({ title: true });
export const updateProjectSchema = z.object(content).partial();
export type ProjectInput = z.infer<typeof updateProjectSchema>;

/** Everything a project needs before it can be reviewed or stay live. */
export const completeProjectSchema = z.object({
  title,
  summary: z.string().trim().min(10, 'Add a short summary (at least 10 characters).').max(LIMITS.summary),
  problem: z.string().trim().min(20, 'Describe the problem (at least 20 characters).').max(LIMITS.problem),
  overview: z.string().trim().min(50, 'Describe the solution (at least 50 characters).').max(LIMITS.overview),
  tags: z.array(z.string()).min(1, 'Add at least one tag.').max(LIMITS.tags),
  stage: content.stage,
  demoUrl: z.string({ required_error: 'An HTTPS demonstration link is required.', invalid_type_error: 'An HTTPS demonstration link is required.' }).pipe(httpsUrl),
});

export const submitSchema = z.object({
  ownershipDeclared: z.literal(true, {
    errorMap: () => ({ message: 'Confirm that you own this work or have the right to share it.' }),
  }),
});

export const deleteSchema = z.object({
  confirmTitle: z.string({ required_error: 'Type the project title to confirm.' }),
});

export const inviteSchema = z.object({
  email: z.string({ required_error: 'Email is required.' }).trim().toLowerCase().email('Enter a valid email address.'),
});

export const progressSchema = z.object({
  body: z.string({ required_error: 'Write an update.' }).trim().min(1, 'Write an update.').max(2000, 'Updates must be at most 2000 characters.'),
});

const milestoneFields = {
  title: z.string({ required_error: 'Milestone title is required.' }).trim().min(1, 'Milestone title is required.').max(120),
  status: z.enum(MILESTONE_STATUSES),
  dueDate: z.union([z.literal('').transform(() => null), z.null(), z.coerce.date()]),
};
export const milestoneSchema = z.object(milestoneFields).partial().required({ title: true });
export const milestoneUpdateSchema = z.object(milestoneFields).partial();

export const reviewNoteSchema = z.object({
  note: z.string({ required_error: 'Explain what needs to change.' }).trim().min(3, 'Explain what needs to change.').max(1000),
});
