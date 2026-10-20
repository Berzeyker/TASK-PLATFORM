import { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const asyncHandler = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

// Async middleware that continues the chain when it resolves
export const asyncGuard = (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => { fn(req, res).then(() => next(), next); };

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) return res.status(400).json({ error: 'Validation failed', issues: err.issues });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof multer.MulterError)
    return res.status(400).json({ error: 'Invalid file format or file size exceeds 10MB limit.' });
  console.error(err); // never leak stack traces to clients
  res.status(500).json({ error: 'Internal server error' });
}
