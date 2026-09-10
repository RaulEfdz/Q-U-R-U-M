import { getRandomValues } from 'expo-crypto';

/**
 * Instala `globalThis.crypto.getRandomValues` en Hermes, que no lo trae.
 *
 * Vive en su propio módulo con el efecto en el nivel superior, y NO como
 * un bloque de código dentro de `index.ts`: los `import` de ES modules se
 * hoistean, así que un `if (...) {}` escrito arriba de
 * `import App from './App'` correría DESPUÉS de que App y todo su árbol de
 * módulos ya se evaluaron. Importar este archivo primero sí garantiza el
 * orden, porque los módulos se evalúan en el orden en que se importan.
 *
 * Por qué acá y no en `core/ids.ts`: ese archivo es uno de los 10
 * compartidos byte a byte con `apps/server`, donde `expo-crypto` no existe.
 * En Node el global ya viene provisto por la plataforma.
 *
 * Sin esto, `core/ids.ts` cae a `Math.random()`: tolerable para un id de
 * trazabilidad, inaceptable para la marca de `context/spotlight.ts`, cuya
 * defensa anti-inyección depende de que un tercero no pueda predecirla.
 */
const g = globalThis as { crypto?: { getRandomValues?: unknown } };

if (typeof g.crypto?.getRandomValues !== 'function') {
  // `crypto` puede no existir, o existir sin `getRandomValues`: se completa
  // sin pisar lo que ya hubiera.
  const base = g.crypto ?? {};
  try {
    (base as { getRandomValues: unknown }).getRandomValues = getRandomValues;
    if (!g.crypto) {
      Object.defineProperty(globalThis, 'crypto', {
        value: base, configurable: true, writable: true,
      });
    }
  } catch {
    // Global inmutable: no hay nada más que hacer acá. Los consumidores
    // consultan `aleatoriedadDebil()` de `core/ids.ts`, así que el estado
    // degradado queda visible en vez de silencioso.
  }
}
