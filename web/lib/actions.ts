import 'server-only';
import { one } from './db';
import { HttpError } from './http';
import type { User } from './auth';

export async function requireAction(u: User, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'Action not found');
  const a = await one('select a.*, m.created_by from action_items a join meetings m on m.id = a.meeting_id where a.id = $1', [id]);
  if (!a || (a.created_by !== u.id && u.role !== 'admin')) throw new HttpError(404, 'Action not found');
  return a;
}

