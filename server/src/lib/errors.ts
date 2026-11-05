import type { ErrorRequestHandler } from 'express';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/** Every API error has the shape { error: { code, message, fields? } }. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  // The response has started, so Express must close the connection instead.
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, fields: err.fields } });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON.' } });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } });
    return;
  }
  // Body-parser errors carry a type and a 4xx status; a malformed URL arrives as URIError.
  const isBodyError = typeof err?.type === 'string' && err.status >= 400 && err.status < 500;
  if (isBodyError || err instanceof URIError) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'The request could not be read.' } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' } });
};
