// export/philips.ts — CSV en el esquema EXACTO de su workbook (19 columnas).
import { A_STATUS_PHILIPS, type Observacion } from '../core/contracts.ts';
import { reconciliar } from '../trust/reconcile.ts';
import { claveGrupo } from '../trust/entity.ts';

const COLUMNAS = [
  'Observation ID', 'Country', 'City', 'Customer / Hospital', 'Observer', 'Visit Date',
  'Modality', 'Quantity', 'Dummy Brand', 'Dummy Model', 'Approx. Age (Years)',
  'Estimated Installation Year', 'Confidence', 'Status', 'Source',
  'Voice Input Example', 'Agent Follow-up Question', 'Follow-up Answer', 'Notes',
] as const;

const esc = (v: unknown): string => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Confidence High/Medium/Low derivado del puntaje del grupo. */
function confianza(puntaje: number): 'High' | 'Medium' | 'Low' {
  return puntaje >= 75 ? 'High' : puntaje >= 45 ? 'Medium' : 'Low';
}

export function exportarCSV(obs: Observacion[], ahora = new Date()): string {
  const grupos = new Map(reconciliar(obs, ahora).map((g) => [g.clave, g]));

  const filas = obs.map((o) => {
    const g = grupos.get(claveGrupo(o));
    const e = o.lote.edadAnios;
    const edad = e === undefined ? '' : Array.isArray(e) ? `${e[0]}-${e[1]}` : e;
    const anio = e === undefined ? ''
      : new Date(o.visitadoEn).getUTCFullYear() - (Array.isArray(e) ? e[1] : e);
    const s = o.seguimiento[0];

    return [
      // `o.id`, no un contador de fila: el CSV es lo que ve el cliente, y su
      // `Observation ID` tiene que poder cruzarse contra `store/audit.ts` y
      // contra la observación real. Un `i+1` cambia según qué filas se
      // exporten y no identifica nada — rompe la trazabilidad que promete
      // TRAZABILIDAD.md.
      o.id, o.cliente.pais, o.cliente.ciudad, o.cliente.nombre, o.observadorId,
      o.visitadoEn.slice(0, 10), o.lote.modalidad, o.lote.cantidad,
      o.lote.marca ?? 'Unknown', o.lote.modelo ?? '', edad, anio,
      confianza(g?.puntaje.total ?? 0),
      A_STATUS_PHILIPS[o.naturaleza],                 // ← su vocabulario exacto
      o.fuente === 'voz' ? 'Voice' : o.fuente === 'foto' ? 'Photo' : 'Text',
      o.textoOriginal, s?.pregunta ?? '', s?.respuesta ?? '', o.notas ?? '',
    ].map(esc).join(',');
  });

  return [COLUMNAS.join(','), ...filas].join('\n');
}
