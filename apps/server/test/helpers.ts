import type { Observacion } from '../src/core/contracts.ts';

let idCounter = 0;

export function armarObservacion(overrides?: Partial<Observacion>): Observacion {
  const id = String(1000 + idCounter++).padStart(10, '0');
  const ahora = new Date();
  const base: Observacion = {
    id,
    sesionId: 'sesion' + id,
    observadorId: 'obs-' + String(Math.random()).slice(2, 8),
    dispositivoId: 'dev-' + String(Math.random()).slice(2, 8),
    visitadoEn: ahora.toISOString(),
    capturadaEn: ahora.toISOString(),
    fuente: 'voz',
    naturaleza: 'Directo',
    origen: 'local',
    cliente: {
      nombre: 'Hospital Ejemplo',
      ciudad: 'Panamá',
      pais: 'PA',
      sitio: 'Planta 2',
    },
    lote: {
      modalidad: 'MR',
      marca: 'NovaMed',
      modelo: 'Model-X',
      cantidad: 1,
      edadAnios: 5,
    },
    hedging: false,
    evidencia: 'tenemos un equipo MR nuevo de NovaMed',
    notas: undefined,
    seguimiento: [],
    textoOriginal: 'tenemos un equipo MR nuevo de NovaMed en la sala de resonancia',
    provenance: {
      hash: 'hash-' + id,
      modeloSha256: undefined,
      delegado: false,
    },
  };

  return { ...base, ...overrides };
}

export function hacerObservaciones(
  count: number,
  baseOverrides?: Partial<Observacion>,
  perObsOverrides?: ((i: number) => Partial<Observacion>)[],
): Observacion[] {
  const out: Observacion[] = [];
  for (let i = 0; i < count; i++) {
    const obs = perObsOverrides?.[i]
      ? armarObservacion({ ...baseOverrides, ...perObsOverrides[i]!(i) })
      : armarObservacion(baseOverrides);
    out.push(obs);
  }
  return out;
}
