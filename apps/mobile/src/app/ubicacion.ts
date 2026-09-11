import * as Location from 'expo-location';
import type { UbicacionCaptura } from '../core/contracts.ts';

/**
 * GPS del dispositivo al momento de capturar la nota (contracts.ts
 * `Observacion.ubicacionCaptura`). Sigue el mismo principio que el resto de
 * la captura: nunca bloquea ni descarta la nota. Si el usuario no dio
 * permiso, si el teléfono no tiene señal (adentro de un hospital es el caso
 * típico) o si `getCurrentPositionAsync` tarda de más, esto devuelve
 * `undefined` y `interpretar()` en `CapturarScreen.tsx` sigue igual, sin
 * ubicación — jamás un `throw` que corte la interpretación de la nota.
 *
 * `TIMEOUT_MS`: un GPS frío adentro de un edificio puede tardar mucho más
 * que lo que alguien está dispuesto a esperar antes de "Interpretar". Se
 * corre una carrera contra el propio pipeline en vez de dejar que
 * `getCurrentPositionAsync` decida cuánto tarda la captura completa.
 */
const TIMEOUT_MS = 8000;

function conTimeout<T>(promesa: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('tiempo de espera agotado')), ms);
    promesa.then(
      (v) => { clearTimeout(id); resolve(v); },
      (e) => { clearTimeout(id); reject(e); },
    );
  });
}

/**
 * No pide el permiso "always", solo "cuando se usa la app" — coherente con
 * que la app no hace tracking en segundo plano, solo registra dónde estaba
 * el teléfono en el instante de cada captura.
 */
export async function obtenerUbicacionCaptura(): Promise<UbicacionCaptura | undefined> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    let concedido = status === 'granted';
    if (!concedido) {
      const pedido = await Location.requestForegroundPermissionsAsync();
      concedido = pedido.status === 'granted';
    }
    if (!concedido) return undefined;

    const pos = await conTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      TIMEOUT_MS,
    );
    return {
      latitud: pos.coords.latitude,
      longitud: pos.coords.longitude,
      precisionMetros: pos.coords.accuracy ?? undefined,
    };
  } catch {
    // Sin permiso denegado explícitamente pero igual sin resultado (GPS
    // apagado, timeout de arriba, servicio de ubicación no disponible):
    // mismo criterio que el resto de la app — se sigue sin el dato, nunca
    // se bloquea ni se descarta la nota por esto.
    return undefined;
  }
}
