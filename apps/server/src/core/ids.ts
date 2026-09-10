const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * ★ `node:crypto` NO existe en React Native. Este archivo es uno de los 10
 * compartidos byte a byte entre `apps/server` y `apps/mobile`, así que la
 * fuente de aleatoriedad se resuelve en RUNTIME y no con un import que solo
 * existe en una de las dos plataformas: `import { randomBytes } from
 * 'node:crypto'` hacía fallar el bundling de Metro con
 * `UnableToResolveError`, y con él el arranque entero de la app.
 *
 * Web Crypto (`globalThis.crypto.getRandomValues`) es la única API presente
 * en las dos plataformas:
 *   - Node la trae como global desde la 18 (aleatoriedad criptográfica).
 *   - Hermes NO la trae; `apps/mobile/index.ts` la instala con `expo-crypto`
 *     antes de cargar la app. El polyfill vive en el entrypoint de mobile y
 *     no acá, justamente para que este archivo siga siendo idéntico en las
 *     dos apps.
 *
 * La lectura del global es diferida (no se captura al importar el módulo):
 * si se resolviera en tiempo de import, el orden de evaluación podría
 * dejar cacheado el estado previo al polyfill.
 */
type FuenteWebCrypto = { getRandomValues?: (a: Uint8Array) => Uint8Array };

function fuente(): FuenteWebCrypto | undefined {
  return (globalThis as { crypto?: FuenteWebCrypto }).crypto;
}

/**
 * `true` cuando el runtime NO ofrece Web Crypto y los bytes salen de
 * `Math.random()`. En ese estado los valores son PREDECIBLES: no sirven
 * como secreto, ni como material de clave, ni como delimitador
 * anti-inyección (ver `context/spotlight.ts`).
 *
 * Se expone como función y no como constante para que refleje el estado
 * real en el momento de consultarla, después de que el entrypoint haya
 * instalado el polyfill.
 *
 * Es una función exportada en vez de un `console.warn`: la pérdida
 * silenciosa de una garantía es el patrón que el proyecto ya corrigió una
 * vez (corrección #9, `store/expo-store.ts`).
 */
export function aleatoriedadDebil(): boolean {
  return typeof fuente()?.getRandomValues !== 'function';
}

/**
 * Bytes aleatorios. Criptográficos cuando hay Web Crypto; si no, degradados
 * a `Math.random()` — consultá `aleatoriedadDebil()` antes de usarlos para
 * algo que dependa de que un tercero no pueda predecirlos.
 */
export function bytesAleatorios(n: number): Uint8Array {
  const b = new Uint8Array(n);
  const c = fuente();
  if (typeof c?.getRandomValues === 'function') return c.getRandomValues(b);
  for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
}

/** Hex en minúscula, equivalente a `Buffer.toString('hex')` — que tampoco
 *  existe en React Native. */
export function aHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function nuevoId(): string {
  let t = Date.now(), ts = '';
  for (let i = 0; i < 10; i++) { ts = B32[t % 32]! + ts; t = Math.floor(t / 32); }
  let rand = '';
  for (const b of bytesAleatorios(10)) rand += B32[b % 32]!;
  return ts + rand;                        // 20 chars, ordenable por tiempo
}
