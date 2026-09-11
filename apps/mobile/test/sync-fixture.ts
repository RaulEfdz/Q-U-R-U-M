import type { Observacion } from '../src/core/contracts.ts';
import type { ObservacionConfirmada } from '../src/store/expo-store.ts';
import type { EntradaSync } from '../src/sync/queue-state.ts';

export function observacion(id: string): ObservacionConfirmada {
  return {
    id, sesionId: 'sesion-mobile-0001', observadorId: 'persona-1', dispositivoId: 'pixel-7',
    visitadoEn: '2026-09-11T10:00:00.000Z', capturadaEn: '2026-09-11T10:01:00.000Z',
    fuente: 'texto', naturaleza: 'Directo', origen: 'local',
    cliente: { nombre: 'Hospital DemoCare Pacific', ciudad: 'Panamá', pais: 'Panamá' },
    lote: { modalidad: 'MR', marca: 'NovaMed', cantidad: 2, edadAnios: 8 },
    hedging: false, evidencia: 'dos MR NovaMed', seguimiento: [],
    textoOriginal: 'Tienen dos MR NovaMed de ocho años.',
    provenance: { hash: `hash-${id}`, delegado: false },
  } as Observacion as ObservacionConfirmada;
}

export function entrada(id: string, estado: EntradaSync['estado'] = 'pendiente-local', actualizadaEn = '2026-09-11T10:02:00.000Z'): EntradaSync {
  return { observacion: observacion(id), estado, intentos: 0, actualizadaEn };
}
