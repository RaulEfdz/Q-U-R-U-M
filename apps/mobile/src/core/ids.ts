import { randomBytes } from 'node:crypto';
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function nuevoId(): string {
  let t = Date.now(), ts = '';
  for (let i = 0; i < 10; i++) { ts = B32[t % 32]! + ts; t = Math.floor(t / 32); }
  let rand = '';
  for (const b of randomBytes(10)) rand += B32[b % 32]!;
  return ts + rand;                        // 20 chars, ordenable por tiempo
}
