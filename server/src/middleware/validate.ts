import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import { HttpError } from '../lib/errors.js';

/** Validates and normalises req.body; responds 400 with per-field messages on failure. */
export function validateBody(schema: ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const fields: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || 'form';
        fields[key] ??= issue.message;
      }
      throw new HttpError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', fields);
    }
    req.body = result.data;
    next();
  };
}
