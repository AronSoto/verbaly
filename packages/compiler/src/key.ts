import { createHash } from 'node:crypto';

export function stableKey(message: string): string {
  return createHash('sha256').update(message).digest('base64url').slice(0, 8);
}
