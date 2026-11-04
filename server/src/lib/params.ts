import type { Request } from 'express';

/** A named route parameter as a single string (Express 5 types params as string | string[]). */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value.join('/') : String(value ?? '');
}
