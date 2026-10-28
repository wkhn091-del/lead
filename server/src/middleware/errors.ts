import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z, ZodError } from 'zod';
import { HttpError } from '../lib/http-error.js';
import { ConflictError } from '../stores/types.js';

// Validation messages reach the app, which is in Hebrew
z.config(z.locales.he());

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, `אין כאן כלום: ${req.method} ${req.path}.`));
};

/** Fields by the names the app shows them under, so a validation message says which one to fix */
const FIELD_LABEL: Record<string, string> = {
  name: 'שם העסק',
  contactName: 'איש קשר',
  phone: 'טלפון',
  email: 'אימייל',
  website: 'האתר הנוכחי',
  campaign: 'קמפיין / נישה',
  approach: 'אסטרטגיה',
  method: 'ערוץ מועדף',
  deal: 'העסקה',
  setupFee: 'דמי הקמה',
  monthlyRetainer: 'ריטיינר חודשי',
  hostingYearly: 'דומיין ואחסון',
  currency: 'מטבע',
  body: 'הטקסט',
  notes: 'הערות',
  niche: 'תחום',
  location: 'אזור',
  myResponse: 'התשובה שלי',
};

/** "leads.3.phone" → "ליד 4 · טלפון" */
function fieldName(path: PropertyKey[]): string {
  const parts: string[] = [];
  path.forEach((part, index) => {
    if (typeof part === 'number') {
      if (path[index - 1] === 'leads') parts.push(`ליד ${part + 1}`);
      return;
    }
    if (part === 'leads') return;
    const key = String(part);
    parts.push(FIELD_LABEL[key] ?? key);
  });
  return parts.join(' · ');
}

const bodyParserMessages: Record<string, string> = {
  'entity.parse.failed': 'גוף הבקשה הוא לא JSON תקין.',
  'entity.too.large': 'הבקשה גדולה מדי.',
};

function bodyParserError(error: unknown): { status: number; message: string } | null {
  if (typeof error !== 'object' || error === null || !('type' in error)) return null;
  const { type, status } = error as { type: unknown; status?: unknown };
  const message = typeof type === 'string' ? bodyParserMessages[type] : undefined;
  return message ? { status: typeof status === 'number' ? status : 400, message } : null;
}

/**
 * Every error becomes JSON: { error: { message, issues? } }.
 * Unexpected errors are logged and reported without internal details.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { message: error.message } });
    return;
  }

  if (error instanceof ConflictError) {
    res.status(409).json({ error: { message: error.message } });
    return;
  }

  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
    const message = error.issues
      .map((issue) => {
        const field = fieldName(issue.path);
        return field ? `${field}: ${issue.message}` : issue.message;
      })
      .join('; ');
    res.status(400).json({ error: { message, issues } });
    return;
  }

  const parserError = bodyParserError(error);
  if (parserError) {
    res.status(parserError.status).json({ error: { message: parserError.message } });
    return;
  }

  console.error(`[${req.method} ${req.originalUrl}]`, error);
  res.status(500).json({ error: { message: 'משהו השתבש בשרת. נסו שוב.' } });
};
