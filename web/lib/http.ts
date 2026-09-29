import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export function json(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === 'number' ? { status: init } : init);
}

/** Wraps a route handler: converts thrown errors into JSON responses and adds CORS for the extension. */
export function route<A extends any[]>(fn: (req: Request, ...args: A) => Promise<Response>) {
  return async (req: Request, ...args: A): Promise<Response> => {
    let res: Response;
    try {
      res = await fn(req, ...args);
    } catch (e: any) {
      if (e instanceof HttpError) res = json({ error: e.message, code: e.code }, e.status);
      else if (e instanceof ZodError) res = json({ error: 'Invalid request', issues: e.issues }, 400);
      else {
        console.error('[api error]', e);
        res = json({ error: 'Internal server error' }, 500);
      }
    }
    return withCors(req, res);
  };
}

export function allowedExtensionOrigin(origin: string | null): string | null {
  if (!origin || !origin.startsWith('chrome-extension://')) return null;
  const list = (process.env.EXTENSION_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length && !list.includes(origin)) return null;
  return origin;
}

export function withCors(req: Request, res: Response) {
  const origin = allowedExtensionOrigin(req.headers.get('origin'));
  if (origin) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Vary', 'Origin');
    res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  }
  return res;
}

export function preflight(req: Request) {
  return withCors(req, new Response(null, { status: 204 }));
}
