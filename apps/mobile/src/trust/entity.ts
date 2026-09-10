import type { Observacion } from '../core/contracts.ts';
import { normalizarCliente, normalizarMarca } from './normalize.ts';
import { jaroWinkler, UMBRAL_CANDIDATO } from './similarity.ts';

/** Clave del grupo: cliente + ubicación + modalidad + marca.
 *  NO incluye edad: las edades distintas son COHORTES dentro del grupo (H-02). */
export function claveGrupo(o: Observacion): string {
  return [
    normalizarCliente(o.cliente.nombre),
    (o.cliente.ciudad ?? '').toLowerCase().trim(),
    (o.cliente.pais ?? '').toLowerCase().trim(),
    o.lote.modalidad,
    normalizarMarca(o.lote.marca),
  ].join('|');
}

export interface CandidatoFusion {
  claveA: string; claveB: string;
  clienteA: string; clienteB: string; similitud: number;
}

/** Paso 2 de su lógica: "use location to disambiguate customers with similar names".
 *  Detecta candidatos. NO fusiona.
 *  Preferimos un duplicado visible a una fusión silenciosa e incorrecta:
 *  el duplicado se arregla; la fusión errónea corrompe el dataset en silencio. */
export function candidatosFusion(
  grupos: Map<string, { cliente: { nombre: string } }>,
): CandidatoFusion[] {
  const out: CandidatoFusion[] = [];
  const e = [...grupos.entries()];
  for (let i = 0; i < e.length; i++) {
    for (let j = i + 1; j < e.length; j++) {
      const [kA, gA] = e[i]!, [kB, gB] = e[j]!;
      const [cA, ciA, paA, moA] = kA.split('|');
      const [cB, ciB, paB, moB] = kB.split('|');
      if (moA !== moB || ciA !== ciB || paA !== paB || cA === cB) continue;
      const s = jaroWinkler(cA!, cB!);
      if (s >= UMBRAL_CANDIDATO) {
        out.push({ claveA: kA, claveB: kB, clienteA: gA.cliente.nombre,
                   clienteB: gB.cliente.nombre, similitud: s });
      }
    }
  }
  return out.sort((a, b) => b.similitud - a.similitud);
}
