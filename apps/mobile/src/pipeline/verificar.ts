/**
 * Verificador de evidencia — determinista, sin modelo.
 *
 * Por qué existe: el extractor (LLM 1.7B) devuelve, por cada lote, una cita
 * literal de la nota que lo justifica. Este módulo comprueba —solo con
 * comparación de strings, sin heurística difusa ni modelo— que esa cita
 * realmente aparece en la nota. Si no aparece, el lote está fabricado.
 *
 * Por qué NO alcanza con cruzar dos LLM: portero y extractor comparten
 * familia, tokenizador, cuantización e input, así que sus errores pueden
 * estar correlacionados. La comparación de strings es independiente por
 * construcción — por eso esta función tiene que quedar determinista, sin
 * umbrales difusos y sin ningún modelo adentro.
 *
 * Regla exacta (docs/QUORUM_pipeline_android.md §3.6, corregida — ver
 * apps/mobile/CLAUDE.md bug #11):
 *   1. Normalizar ambos lados (minúsculas, sin acentos, espacios colapsados).
 *   2. Válida si la cita normalizada aparece como subcadena de la nota
 *      normalizada (cubre también diferencias de tildes/mayúsculas, que la
 *      normalización ya absorbió).
 *   3. Si no, para citas de 3+ palabras: exigir que TODAS las palabras de la
 *      cita estén presentes en la nota como PALABRAS COMPLETAS (no como
 *      subcadena — "dos" no puede validar contra "todos") Y que al menos una
 *      secuencia de 3 palabras consecutivas de la cita aparezca igual en la
 *      nota.
 *   4. Citas de 1-2 palabras: no hay secuencia de 3 palabras posible, así que
 *      la única evidencia de que "aparecen tal cual" ya se probó en el paso 2
 *      (subcadena exacta tras normalizar). Si llegaron hasta acá es porque
 *      ese paso falló, así que se rechazan sin aplicar la tolerancia por
 *      palabra: una cita de 1-2 palabras es evidencia demasiado débil para
 *      relajar el criterio, y permitir coincidencia por palabra suelta sin
 *      exigir orden ni adyacencia dejaría pasar fabricaciones triviales
 *      (ej. cita "resonadores viejos" validando contra "los resonadores
 *      Aurelia no son viejos", donde no se afirma lo mismo).
 */

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Verificacion {
  valida: boolean;
  razon?: string;
}

export function verificarEvidencia(nota: string, evidencia: string): Verificacion {
  const n = norm(nota);
  const e = norm(evidencia);

  if (e.length < 3) {
    return { valida: false, razon: 'evidencia vacia o trivial' };
  }

  // Subcadena exacta tras normalizar: cubre cita literal y diferencias de
  // tildes/mayúsculas/espacios (ej. "resonancia magnética" vs "resonancia magnetica").
  if (n.includes(e)) {
    return { valida: true };
  }

  const palabrasEvidencia = e.split(' ').filter(Boolean);
  const palabrasNota = new Set(n.split(' ').filter(Boolean));

  // Comparación POR PALABRA COMPLETA, no por subcadena — "dos" no debe
  // validar contra una nota que solo contiene "todos" (bug #11).
  const todasPresentes = palabrasEvidencia.every((p) => palabrasNota.has(p));
  if (!todasPresentes) {
    return { valida: false, razon: 'la cita contiene palabras ausentes en la nota' };
  }

  // Citas de 1-2 palabras: ya no queda tolerancia posible (no hay secuencia
  // de 3 palabras que probar) y la subcadena exacta ya falló arriba. Se
  // rechazan explícitamente en vez de caer en un bucle que nunca ejecuta.
  if (palabrasEvidencia.length < 3) {
    return {
      valida: false,
      razon:
        'la cita tiene menos de 3 palabras y no aparece tal cual (con esa longitud no se acepta coincidencia parcial, es evidencia demasiado débil)',
    };
  }

  for (let i = 0; i + 3 <= palabrasEvidencia.length; i++) {
    const secuencia = palabrasEvidencia.slice(i, i + 3).join(' ');
    if (n.includes(secuencia)) {
      return { valida: true };
    }
  }

  return { valida: false, razon: 'la cita no aparece como secuencia en la nota' };
}
