/**
 * comofunciona.js — pantalla 5. Los estados y el flujo, explicados con
 * diagramas.
 *
 * Por qué existe: las otras cuatro pantallas MUESTRAN el resultado del modelo
 * de confianza (un badge ▲, un bloque de versiones en conflicto), pero ninguna
 * explica la máquina que lo produce. En una demo de siete minutos, el jurado
 * ve `Sin quórum` y tiene que deducir la regla; acá la regla está dibujada.
 *
 * ★ Es la ÚNICA pantalla de la app sin un solo dato de la API. Todo lo que
 * dice está escrito acá, en texto literal — no hay nada de un peer, nada de
 * una nota dictada, nada que pueda venir de un atacante. Eso no la exime de
 * la regla dura de `dom.js` (nunca marcado crudo, todo por `textContent`),
 * pero sí explica por qué no hace `fetch` ni recibe parámetros.
 *
 * Los diagramas son SVG dibujado a mano, en este archivo. No hay Mermaid ni
 * D3 ni ninguna librería de diagramas, por la misma razón que el resto del
 * proyecto no tiene dependencias de front: cargar una desde un CDN haría que
 * un recurso salga de este equipo, y la CSP del servidor
 * (`default-src 'self'`) la bloquearía sin decir una palabra. La versión en
 * Mermaid de estos mismos diagramas vive en `docs/ESTADOS_Y_FLUJO.md`, que es
 * el documento hermano de esta pantalla — si cambia una regla, hay que tocar
 * los dos.
 *
 * Colores: se usan los tokens de la rampa de confianza y NADA más, igual que
 * el resto de la interfaz. Un diagrama que introdujera color propio rompería
 * el invariante de que el color codifica confianza y nada más.
 */
import { h, pintar } from './dom.js';
import { insignia } from './estados.js';

/* ═══════════════════════════ Mini-constructor de SVG ═══════════════════════════ */

const NS = 'http://www.w3.org/2000/svg';

/**
 * `s('rect', { x: 10, width: 100, clase: 'nodo' }, ...hijos)`.
 *
 * El equivalente de `h()` de `dom.js` para SVG. Hace falta uno aparte porque
 * `document.createElement('rect')` crea un elemento HTML llamado "rect" que
 * no renderiza nada: los nodos SVG exigen `createElementNS`.
 *
 * Mismas dos reglas que `h()`: `clase` en vez de `class` (consistencia con el
 * resto de la UI) y el texto entra por `textContent`, nunca por marcado.
 */
function s(tag, props, ...hijos) {
  const el = document.createElementNS(NS, tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'clase') el.setAttribute('class', String(v));
      else if (k === 'texto') el.textContent = String(v);
      else el.setAttribute(k, String(v));
    }
  }
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    el.append(hijo);
  }
  return el;
}

/**
 * Lienzo. `viewBox` + `width:100%` para que escale, con el alto real
 * declarado en `preserveAspectRatio` por defecto.
 *
 * `role="img"` + `<title>` + `<desc>`: un diagrama sin nombre accesible es
 * invisible para un lector de pantalla, y esta pantalla existe justamente
 * para explicar. El texto de `<desc>` no repite el diagrama, dice lo que el
 * diagrama demuestra — que es lo que le sirve a quien no lo ve.
 */
function lienzo(ancho, alto, titulo, descripcion, ...hijos) {
  return s('svg', {
    clase: 'diagrama', viewBox: `0 0 ${ancho} ${alto}`,
    role: 'img', 'aria-label': titulo,
  },
  s('title', { texto: titulo }),
  s('desc', { texto: descripcion }),
  defs(),
  ...hijos);
}

/** Punta de flecha, definida una vez y referenciada por `marker-end`. */
function defs() {
  return s('defs', null,
    s('marker', {
      id: 'punta', viewBox: '0 0 10 10', refX: '9', refY: '5',
      markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse',
    }, s('path', { clase: 'punta', d: 'M 0 0 L 10 5 L 0 10 z' })),
    s('marker', {
      id: 'punta-deny', viewBox: '0 0 10 10', refX: '9', refY: '5',
      markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse',
    }, s('path', { clase: 'punta-deny', d: 'M 0 0 L 10 5 L 0 10 z' })));
}

/** Caja con título y, opcionalmente, una línea de detalle abajo. */
function caja(x, y, ancho, alto, titulo, { detalle, clase = '', glifo } = {}) {
  const centroX = x + ancho / 2;
  const conDetalle = Boolean(detalle);
  return s('g', { clase: `nodo ${clase}` },
    s('rect', { x, y, width: ancho, height: alto, rx: 2 }),
    glifo
      ? s('text', { clase: 'glifo-svg', x: x + 12, y: y + alto / 2 + 5, texto: glifo })
      : null,
    s('text', {
      clase: 'nodo-titulo', x: centroX, y: conDetalle ? y + alto / 2 - 3 : y + alto / 2 + 4,
      'text-anchor': 'middle', texto: titulo,
    }),
    conDetalle
      ? s('text', {
          clase: 'nodo-detalle', x: centroX, y: y + alto / 2 + 13,
          'text-anchor': 'middle', texto: detalle,
        })
      : null);
}

/** Rombo de decisión. Se distingue de una caja por la forma, no por el color. */
function decision(cx, cy, ancho, alto, lineas, { clase = '' } = {}) {
  const mitadX = ancho / 2, mitadY = alto / 2;
  const textos = Array.isArray(lineas) ? lineas : [lineas];
  const base = cy - ((textos.length - 1) * 6);
  return s('g', { clase: `nodo decision ${clase}` },
    s('polygon', {
      points: `${cx},${cy - mitadY} ${cx + mitadX},${cy} ${cx},${cy + mitadY} ${cx - mitadX},${cy}`,
    }),
    textos.map((t, i) => s('text', {
      clase: 'nodo-detalle', x: cx, y: base + i * 12 + 4,
      'text-anchor': 'middle', texto: t,
    })));
}

/** Flecha recta con etiqueta opcional. `tipo: 'deny'` la pinta de conflicto. */
function flecha(x1, y1, x2, y2, { etiqueta, tipo, desvio = 0, anclaje = 'middle', etiquetaX, etiquetaY } = {}) {
  const clase = tipo === 'deny' ? 'arista deny' : 'arista';
  const marcador = tipo === 'deny' ? 'url(#punta-deny)' : 'url(#punta)';
  const d = desvio
    ? `M ${x1} ${y1} Q ${(x1 + x2) / 2} ${(y1 + y2) / 2 + desvio} ${x2} ${y2}`
    : `M ${x1} ${y1} L ${x2} ${y2}`;
  return s('g', null,
    s('path', { clase, d, 'marker-end': marcador, fill: 'none' }),
    etiqueta
      ? s('text', {
          clase: `arista-etiqueta ${tipo === 'deny' ? 'deny' : ''}`,
          // Por defecto la etiqueta va sobre el medio de la flecha, pero en
          // una fila de cajas con poco aire eso la mete ADENTRO de la caja
          // vecina. `etiquetaX`/`etiquetaY` permiten sacarla a donde haya
          // espacio sin mover la flecha, que es lo que describe la relación.
          x: etiquetaX ?? (x1 + x2) / 2,
          y: etiquetaY ?? (y1 + y2) / 2 + (desvio ? desvio / 2 : 0) - 5,
          'text-anchor': anclaje, texto: etiqueta,
        })
      : null);
}

/** Carril horizontal con su etiqueta de actor: quién decide en esa banda. */
function carril(x, y, ancho, alto, etiqueta, clase) {
  return s('g', { clase: `carril ${clase}` },
    s('rect', { x, y, width: ancho, height: alto, rx: 2 }),
    s('text', { clase: 'carril-etiqueta', x: x + 8, y: y + 15, texto: etiqueta }));
}

/* ═══════════════════════════ Diagrama 1 · los dos ejes ═══════════════════════════ */

/**
 * Los ejes son DOS (más frescura, que es un tercero independiente), y
 * confundirlos es el error de diseño más fácil de cometer en este producto.
 * El diagrama existe para que se vea que uno describe UN testimonio y el otro
 * describe UN CAMPO después de cruzar todos los testimonios.
 */
function diagramaEjes() {
  return lienzo(880, 300,
    'Los tres ejes de confianza',
    'El eje de Naturaleza clasifica cada testimonio por cómo se observó. El eje de Quórum clasifica cada campo según cuánta corroboración independiente tiene. La frescura es un tercer eje, independiente de los dos, que mide cuándo se verificó por última vez.',
    // Eje 1
    s('g', null,
      s('rect', { clase: 'panel', x: 10, y: 10, width: 250, height: 280, rx: 2 }),
      s('text', { clase: 'panel-titulo', x: 24, y: 34, texto: 'EJE 1 · Naturaleza' }),
      s('text', { clase: 'panel-sub', x: 24, y: 50, texto: 'por TESTIMONIO · lo infiere código' }),
      caja(24, 66, 222, 40, 'Directo', { detalle: 'lo vi yo  →  Confirmed' }),
      caja(24, 114, 222, 40, 'Referido', { detalle: '«me dijeron»  →  Reported' }),
      caja(24, 162, 222, 40, 'Estimado', { detalle: '«creo que»  →  Estimated' }),
      caja(24, 210, 222, 40, 'Desconocido', { detalle: 'nada lo produce hoy', clase: 'inerte' }),
      s('text', { clase: 'panel-pie', x: 24, y: 272, texto: '→ columna Status del CSV' })),

    flecha(268, 150, 316, 150, { etiqueta: 'se cruzan', anclaje: 'middle' }),
    s('text', { clase: 'arista-etiqueta', x: 292, y: 168, 'text-anchor': 'middle', texto: 'N testimonios' }),

    // Eje 2
    s('g', null,
      s('rect', { clase: 'panel', x: 324, y: 10, width: 280, height: 280, rx: 2 }),
      s('text', { clase: 'panel-titulo', x: 338, y: 34, texto: 'EJE 2 · Quórum' }),
      s('text', { clase: 'panel-sub', x: 338, y: 50, texto: 'por CAMPO · lo resuelve el motor' }),
      caja(338, 66, 252, 30, 'Sin datos', { clase: 'e-nulo', glifo: '·' }),
      caja(338, 106, 252, 30, 'Estimado', { clase: 'e-bajo', glifo: '○' }),
      caja(338, 146, 252, 30, 'Reportado', { clase: 'e-medio', glifo: '◐' }),
      caja(338, 186, 252, 30, 'Quórum', { clase: 'e-ok', glifo: '●' }),
      flecha(590, 81, 604, 81, { desvio: 0 }),
      caja(338, 236, 252, 38, 'Sin quórum', {
        detalle: 'categoría aparte, no un escalón', clase: 'e-sinquorum', glifo: '▲',
      }),
      // La escalera, dibujada al costado para que se lea como escalera.
      s('path', { clase: 'escalera', d: 'M 596 81 L 610 81 L 610 201 L 596 201', fill: 'none' }),
      s('text', { clase: 'panel-pie', x: 338, y: 288, texto: 'la escalera sube; ▲ está fuera de ella' })),

    // Eje 3
    s('g', null,
      s('rect', { clase: 'panel', x: 620, y: 10, width: 250, height: 280, rx: 2 }),
      s('text', { clase: 'panel-titulo', x: 634, y: 34, texto: 'EJE 3 · Frescura' }),
      s('text', { clase: 'panel-sub', x: 634, y: 50, texto: 'por CAMPO · independiente' }),
      caja(634, 76, 222, 44, 'fresco', { detalle: 'última visita ≤ 180 días', clase: 'frescura-nodo', glifo: '◷' }),
      caja(634, 130, 222, 44, 'sin verificar', { detalle: 'última visita > 180 días', clase: 'frescura-nodo', glifo: '◷' }),
      s('text', { clase: 'panel-pie', x: 634, y: 200, texto: 'NO recibe color de la rampa:' }),
      s('text', { clase: 'panel-pie', x: 634, y: 216, texto: 'pintarla de ámbar la haría' }),
      s('text', { clase: 'panel-pie', x: 634, y: 232, texto: 'leerse como «Reportado» y' }),
      s('text', { clase: 'panel-pie', x: 634, y: 248, texto: 'fusionaría dos ejes distintos.' }),
      s('text', { clase: 'panel-pie', x: 634, y: 272, texto: 'RD-6: se mide desde visitadoEn' })));
}

/* ═══════════════════════ Diagrama 2 · la máquina de estados ═══════════════════════ */

/**
 * Esto es `resolverCampo()` de `trust/reconcile.ts`, dibujado. Un VOTO es la
 * posición de un observador sobre un campo — su testimonio más reciente, uno
 * por persona (RD-3).
 */
function diagramaMaquina() {
  return lienzo(900, 340,
    'Máquina de estados de un campo',
    'Sin votos el campo queda Sin datos y nunca se rellena. Con un voto queda Estimado si venía hedgeado o Reportado si era asertivo, nunca Quórum. Con dos o más votos compatibles asciende a Quórum solo si al menos dos son directos y asertivos. Un voto incompatible manda el campo a Sin quórum desde cualquier estado.',
    caja(20, 40, 150, 46, 'Sin datos', { detalle: 'nadie lo reportó', clase: 'e-nulo', glifo: '·' }),
    caja(250, 40, 150, 46, 'Estimado', { detalle: '1 voto, hedgeado', clase: 'e-bajo', glifo: '○' }),
    caja(480, 40, 150, 46, 'Reportado', { detalle: 'dicho, sin corroborar', clase: 'e-medio', glifo: '◐' }),
    caja(710, 40, 170, 46, 'Quórum', { detalle: '≥2 directos asertivos', clase: 'e-ok', glifo: '●' }),
    caja(415, 250, 220, 50, 'Sin quórum', { detalle: 'los votos discrepan · RD-2', clase: 'e-sinquorum', glifo: '▲' }),

    flecha(170, 63, 250, 63, { etiqueta: '1er voto, hedgeado', etiquetaY: 106, etiquetaX: 210 }),
    flecha(400, 63, 480, 63, { etiqueta: '2º voto compatible', etiquetaY: 106, etiquetaX: 440 }),
    flecha(630, 63, 710, 63, { etiqueta: '≥2 pueden darlo', etiquetaY: 106, etiquetaX: 670 }),
    // Sin datos → Reportado, por arriba: el primer voto asertivo salta Estimado.
    s('path', { clase: 'arista', d: 'M 95 40 L 95 16 L 555 16 L 555 40', fill: 'none', 'marker-end': 'url(#punta)' }),
    s('text', { clase: 'arista-etiqueta', x: 325, y: 12, 'text-anchor': 'middle', texto: '1er voto asertivo (salta Estimado)' }),
    // Estimado → Quórum, por arriba también.
    s('path', { clase: 'arista', d: 'M 325 40 L 325 30 L 795 30 L 795 40', fill: 'none', 'marker-end': 'url(#punta)' }),
    s('text', { clase: 'arista-etiqueta', x: 560, y: 26, 'text-anchor': 'middle', texto: 'un hedgeado más dos directos: también asciende' }),

    // Las tres caídas a Sin quórum.
    flecha(325, 86, 470, 250, { etiqueta: 'voto INCOMPATIBLE', tipo: 'deny', anclaje: 'end' }),
    flecha(555, 86, 545, 250, { tipo: 'deny' }),
    flecha(795, 86, 610, 250, { etiqueta: 'voto INCOMPATIBLE', tipo: 'deny', anclaje: 'start' }),

    // Y la salida: un voto nuevo puede resolver la disputa.
    s('path', { clase: 'arista', d: 'M 635 275 L 880 275 L 880 100', fill: 'none', 'marker-end': 'url(#punta)' }),
    s('text', { clase: 'arista-etiqueta', x: 760, y: 291, 'text-anchor': 'middle', texto: 'un voto nuevo deja un solo clúster' }),

    s('text', { clase: 'nota-svg', x: 20, y: 150, texto: 'RD-0 · un campo sin datos NUNCA se rellena.' }),
    s('text', { clase: 'nota-svg', x: 20, y: 168, texto: 'RD-1 · un observador no da quórum.' }),
    s('text', { clase: 'nota-svg', x: 20, y: 186, texto: 'RD-5 · si todos hedgean, el techo es ◐.' }),
    s('text', { clase: 'nota-svg', x: 20, y: 204, texto: 'RD-7 · solo Directo y asertivo puede darlo.' }),
    s('text', { clase: 'nota-svg', x: 20, y: 228, texto: '«compatible» no es igualdad literal: la edad' }),
    s('text', { clase: 'nota-svg', x: 20, y: 246, texto: 'tolera ±2 años, la marca se normaliza.' }));
}

/* ═════════════════════════ Diagrama 3 · el flujo de una nota ═════════════════════════ */

/**
 * Carriles horizontales por ACTOR, y no un flujo lineal, porque el punto del
 * diagrama es justamente la alternancia: modelo → código → modelo → código →
 * humano. Es el principio del proyecto hecho dibujo.
 */
function diagramaFlujo() {
  return lienzo(1180, 430,
    'De la voz al CSV: quién decide en cada paso',
    'El colaborador dicta. El navegador arma el WAV. Whisper transcribe on-device. El código decide y verifica la ruta de inferencia antes de tocar el modelo. El extractor produce estructura. El código valida cada lote y comprueba que la cita literal exista de verdad. El resultado es un borrador en memoria que nadie persiste hasta que el humano confirma. Solo entonces se escribe al store append-only, se reconcilia y se exporta.',
    carril(10, 10, 1160, 108, 'HUMANO — confirma', 'c-humano'),
    carril(10, 126, 1160, 108, 'MODELO — entiende, on-device', 'c-modelo'),
    carril(10, 242, 1160, 178, 'CÓDIGO — decide', 'c-codigo'),

    // Carril humano
    caja(30, 52, 130, 44, 'dicta la nota', { detalle: 'o la escribe' }),
    caja(700, 52, 150, 44, 'BORRADOR', { detalle: 'en memoria · TTL 30 min' }),
    caja(880, 52, 160, 44, 'confirma / corrige', { detalle: 'o descarta' }),

    // Carril modelo
    caja(190, 158, 140, 44, 'whisper.cpp', { detalle: 'es · translate:false' }),
    caja(520, 158, 150, 44, 'Qwen3 1.7B', { detalle: 'tool calling' }),

    // Carril código
    caja(30, 290, 130, 40, 'WAV PCM 16k', { detalle: 'el navegador solo graba' }),
    decision(255, 270, 150, 46, ['¿alucinación?', 'frase repetida']),
    caja(360, 282, 140, 56, 'decidirRuta()', { detalle: '¿identifica cliente?' }),
    caja(360, 348, 140, 40, 'asegurarRuta()', { detalle: 'fail-closed' }),
    caja(520, 290, 150, 40, 'Zod por LOTE', { detalle: 'degrada el lote, no la nota' }),
    decision(755, 310, 170, 52, ['¿la cita literal', 'existe en la nota?']),
    caja(880, 348, 160, 40, 'detectarHedging()', { detalle: 'código, no modelo' }),
    caja(1055, 290, 105, 40, 'store', { detalle: 'append-only' }),
    caja(1055, 348, 105, 40, 'reconciliar', { detalle: '→ CSV 19 col.' }),

    // Recorrido
    flecha(160, 74, 190, 74, {}),
    flecha(230, 158, 200, 250, {}),
    flecha(255, 293, 255, 282, {}),
    flecha(330, 270, 360, 290, {}),
    flecha(430, 338, 430, 348, {}),
    flecha(500, 368, 560, 202, {}),
    flecha(595, 202, 595, 290, {}),
    flecha(670, 310, 755, 310, {}),
    flecha(840, 320, 880, 348, {}),
    // Verificada la evidencia y clasificado el testimonio, el resultado sube
    // al carril del humano: es el único camino hacia el borrador.
    s('path', {
      clase: 'arista', fill: 'none', 'marker-end': 'url(#punta)',
      d: 'M 960 348 L 960 330 L 775 330 L 775 96',
    }),
    flecha(850, 74, 880, 74, {}),
    flecha(1040, 74, 1107, 290, { etiqueta: 'confirmar' }),
    flecha(1107, 330, 1107, 348, {}),

    // Las dos salidas que NO persisten nada.
    flecha(880, 96, 700, 118, {
      etiqueta: 'descartar: nada se guardó', tipo: 'deny', anclaje: 'middle',
      // En el aire entre los dos carriles: sobre la flecha caía dentro de la
      // caja BORRADOR.
      etiquetaX: 790, etiquetaY: 114,
    }),
    flecha(755, 336, 700, 400, { etiqueta: 'cita fabricada: lote fuera', tipo: 'deny', anclaje: 'start' }),
    s('text', { clase: 'nota-svg deny', x: 20, y: 412, texto: '▲ ninguna flecha roja escribe en el store: /api/confirmar es el único endpoint que persiste evidencia.' }));
}

/* ══════════════════ Diagrama 4 · multidispositivo ══════════════════ */

/**
 * El escenario real del reto, y su trampa: confundir DISPOSITIVO con
 * OBSERVADOR. Dos teléfonos no son dos testigos si detrás hay una sola
 * persona — un sistema que cuente aparatos se auto-corrobora.
 */
function diagramaMultidispositivo() {
  const panel = (x, titulo, clase, filas, resultado, resultadoClase, glifo) =>
    s('g', null,
      s('rect', { clase: `panel ${clase}`, x, y: 10, width: 370, height: 250, rx: 2 }),
      s('text', { clase: 'panel-titulo', x: x + 14, y: 34, texto: titulo }),
      filas.map((f, i) => s('g', null,
        s('text', { clase: 'nodo-titulo izq', x: x + 14, y: 62 + i * 40, texto: f[0] }),
        s('text', { clase: 'nodo-detalle izq', x: x + 14, y: 77 + i * 40, texto: f[1] }))),
      caja(x + 14, 186, 342, 56, resultado[0], { detalle: resultado[1], clase: resultadoClase, glifo }));

  return lienzo(1160, 280,
    'Multidispositivo: por qué dos teléfonos no son dos testigos',
    'Dos dispositivos de dos personas distintas producen quórum. Los mismos dos dispositivos en manos de una sola persona no: el quórum lo dan observadores independientes, no aparatos, y el motor indexa los votos por observador. Cuando tres personas reportan y una discrepa, el campo en conflicto queda Sin quórum con las dos versiones visibles.',
    panel(10, '✓ CONSOLIDA · dos personas', 'ok-suave', [
      ['Field User 01', 'pixel-a · 2 MR · 7 años'],
      ['Sales User 14', 'pixel-b · 2 MR · 7 años'],
      ['', 'dos votos independientes'],
    ], ['Quórum', 'corroboración 0.6'], 'e-ok', '●'),

    panel(395, '✗ NO CONSOLIDA · una persona', 'alerta-suave', [
      ['Field User 01', 'pixel-personal · 2 MR · 7 años'],
      ['Field User 01', 'tablet-empresa · 2 MR · 7 años'],
      ['', 'un solo observador (RD-3)'],
    ], ['Reportado', 'corroboración 0'], 'e-medio', '◐'),

    panel(780, '▲ DISPUTA · tres, una discrepa', 'conflicto-suave', [
      ['Field User 01 · Sales User 14', '7 años'],
      ['Field User 15', '12 años'],
      ['', 'el disidente no se borra'],
    ], ['total ● Quórum · edad ▲ Sin quórum', 'el grupo entero queda ▲'], 'e-sinquorum', '▲'));
}

/* ══════════════════ Diagrama 5 · la política ══════════════════ */

/**
 * La misma herramienta se permite o se deniega según QUIÉN originó los
 * argumentos. Esa línea (`origenArgumentos`) es la que detiene la inyección
 * indirecta, y es lo que este diagrama tiene que dejar obvio.
 */
function diagramaPolitica() {
  return lienzo(1000, 330,
    'La misma herramienta, dos destinos: el origen del argumento decide',
    'La consulta en lenguaje natural le ofrece al modelo las dos herramientas, incluida la peligrosa, a propósito. Cuando el modelo pide exportar el dataset, el punto de aplicación de políticas lo deniega porque el argumento se originó en la salida del modelo, y la denegación queda en la cadena de auditoría y viaja por SSE hasta la banda roja de la interfaz. El mismo export pedido por una persona, con destino local, se permite.',
    caja(20, 30, 170, 48, 'texto de un peer', { detalle: 'UNTRUSTED' }),
    caja(20, 100, 170, 48, 'spotlighting', { detalle: 'delimitador aleatorio' }),
    caja(230, 65, 150, 48, 'modelo local', { detalle: 've las 2 tools' }),
    caja(20, 230, 170, 48, 'HUMANO', { detalle: 'clic en Exportar' }),

    caja(430, 20, 200, 44, 'filtrar_base_instalada', { detalle: 'riesgo bajo' }),
    caja(430, 88, 200, 44, 'exportar_dataset', { detalle: 'riesgo CRÍTICO' }),
    caja(430, 230, 200, 44, 'exportar_dataset', { detalle: 'origen: usuario · local' }),

    caja(690, 20, 140, 44, 'PEP', { detalle: 'aplicar()' }),
    caja(690, 88, 140, 44, 'PEP', { detalle: 'aplicar()' }),
    caja(690, 230, 140, 44, 'PEP', { detalle: 'aplicar()' }),

    caja(870, 20, 120, 44, 'ALLOW', { detalle: 'lo ejecuta código', clase: 'e-ok' }),
    caja(870, 88, 120, 60, 'DENY', { detalle: 'intención del modelo', clase: 'e-sinquorum' }),
    caja(870, 230, 120, 44, 'ALLOW', { detalle: 'CSV al disco', clase: 'e-ok' }),

    flecha(105, 78, 105, 100, {}),
    flecha(190, 124, 230, 100, {}),
    flecha(380, 78, 430, 42, {}),
    flecha(380, 89, 430, 110, {}),
    flecha(190, 254, 430, 252, {}),
    flecha(630, 42, 690, 42, {}),
    flecha(630, 110, 690, 110, { tipo: 'deny' }),
    flecha(630, 252, 690, 252, {}),
    flecha(830, 42, 870, 42, {}),
    flecha(830, 110, 870, 110, { tipo: 'deny' }),
    flecha(830, 252, 870, 252, {}),

    flecha(930, 148, 930, 180, { tipo: 'deny' }),
    caja(800, 180, 190, 36, 'audit.jsonl + banda roja', { detalle: '', clase: 'e-sinquorum' }),

    s('text', { clase: 'nota-svg', x: 20, y: 300, texto: 'Y si ninguna regla autoriza explícitamente: deny-by-default.' }),
    s('text', { clase: 'nota-svg', x: 20, y: 318, texto: 'La allowlist de egress está vacía: ningún destino que no sea «local» pasa.' }));
}

/* ═══════════════════════════ Piezas de texto ═══════════════════════════ */

function bloque(titulo, ...hijos) {
  return h('section', { clase: 'bloque explica' },
    h('h4', { texto: titulo }), ...hijos);
}

function conDiagrama(svg, pie) {
  return h('div', { clase: 'diagrama-caja' },
    h('div', { clase: 'diagrama-scroll' }, svg),
    pie ? h('p', { clase: 'diagrama-pie', texto: pie }) : null);
}

function tabla(cabeceras, filas) {
  return h('div', { clase: 'diagrama-scroll' },
    h('table', { clase: 'resultados' },
      h('thead', null, h('tr', null,
        cabeceras.map((t) => h('th', { scope: 'col', texto: t })))),
      h('tbody', null, filas.map((f) => h('tr', null,
        f.map((celda) => h('td', null, celda)))))));
}

/* ═══════════════════════════ La pantalla ═══════════════════════════ */

export function pintarComoFunciona(seccion) {
  // Se pinta una sola vez: no depende de datos, así que repintarla en cada
  // refresco sería trabajo puro sin cambio de resultado — y perdería la
  // posición de scroll de quien está leyendo.
  if (seccion.dataset.pintada === 'si') return;

  pintar(seccion,
    h('p', { clase: 'leyenda' },
      h('span', { texto: 'El LLM entiende. El código decide. El humano confirma. ' }),
      h('span', { clase: 'small', texto: 'Los tres verbos son distintos a propósito, y casi todos los estados de este sistema existen para marcar cuál de los tres actuó.' })),

    bloque('Qué problema del reto resuelve QUÓRUM',
      h('p', { clase: 'nota', texto: 'El reto no pide solo extraer equipos: pide transformar notas incompletas y contradictorias en una base instalada útil sin sacar información sensible del dispositivo. Esta es la cadena completa entre cada problema y la evidencia que la responde.' }),
      tabla(['Problema de campo', 'Respuesta de QUÓRUM', 'Qué puede verificar el jurado'], [
        ['La visita termina en memoria, mensajes o notas inconsistentes.',
          'Una nota por voz o texto se vuelve un borrador estructurado: cliente, ubicación, modalidad, cantidad, marca, modelo y edad solo cuando aparecen en la evidencia.',
          'Capturar una nota incompleta, corregirla y confirmar el borrador.'],
        ['Una persona sabe algo; dos personas pueden contradecirse.',
          'El sistema separa cada campo, cuenta observadores independientes y conserva el desacuerdo como Sin quórum. Nunca promedia.',
          'Mostrar dos testimonios que coinciden y un tercero que discrepa.'],
        ['El dato del cliente es sensible y la conectividad es incierta.',
          'La inferencia corre localmente. Si una nota identifica al cliente, la política obliga la ruta local; no hay proveedor cloud permitido.',
          'Apagar Wi‑Fi y ejecutar verify:no-cloud; luego capturar una nota.'],
        ['Repetir una observación o usar dos teléfonos no debe fabricar confianza.',
          'El store deduplica por id y el quórum cuenta personas, no dispositivos. Lo recibido por P2P espera revisión humana local.',
          'Reenviar un testimonio y revisar la cola P2P antes de incorporarlo.'],
        ['El analista necesita priorizar, no leer cada nota una por una.',
          'Cliente 360, Panorama, frescura, oportunidad, filtro determinista y CSV convierten evidencia en una decisión explicable.',
          'Filtrar MR antiguos en Brasil y exportar el CSV local de 19 columnas.'],
      ]),
      h('p', { clase: 'nota', texto: 'La diferencia importante: un modelo propone estructura; nunca declara la verdad, suma unidades ni autoriza una salida de datos. Esas decisiones quedan en código y con trazabilidad.' })),

    bloque('Quién decide qué',
      tabla(['Actor', 'Le toca', 'NO le toca'], [
        ['Modelo · on-device',
          'Transcribir. Traducir texto libre a estructura. Traducir una pregunta a un filtro.',
          'Contar. Estimar. Decidir confianza. Ejecutar nada.'],
        ['Código · determinista',
          'Normalizar, agrupar, clusterizar, resolver quórum, puntuar, filtrar, exportar, autorizar.',
          'Inventar un dato que nadie observó.'],
        ['Humano',
          'Confirmar, corregir o descartar. Autorizar el export.',
          '—'],
      ]),
      h('p', { clase: 'nota', texto: 'Ejemplo concreto: el «creo que» de una nota no se le pregunta al modelo, lo detecta código sobre el texto original. Preguntárselo habría puesto una decisión de confianza dentro del LLM y roto el principio en la primera línea.' })),

    bloque('Los tres ejes',
      conDiagrama(diagramaEjes(),
        'La naturaleza describe UN testimonio y sale al CSV como Status. El quórum describe UN CAMPO después de cruzar todos los testimonios. La frescura es otro eje y por eso no toma color de la rampa de confianza.')),

    bloque('La máquina de estados de un campo',
      conDiagrama(diagramaMaquina(),
        'Un voto = la posición de un observador sobre un campo, su testimonio más reciente. Sin quórum no es un escalón intermedio: es una categoría aparte, y significa que el sistema no sabe cuál versión es la buena.'),
      h('div', { clase: 'estados-leyenda' },
        ['Sin datos', 'Estimado', 'Reportado', 'Quórum', 'Sin quórum'].map((e) => insignia(e))),
      h('p', { clase: 'nota', texto: 'Un campo Sin quórum tampoco cuenta como dato presente en el puntaje de calidad: antes un grupo en disputa era el mejor puntuado de todo el dataset, que es exactamente lo contrario de lo que este producto quiere decir.' })),

    bloque('El flujo de una nota, de la voz al CSV',
      conDiagrama(diagramaFlujo(),
        'Los carriles son por actor a propósito: el punto es la alternancia. La transcripción y la extracción corren en este equipo o en un dispositivo autorizado de la red; nunca en la nube.'),
      h('ol', { clase: 'lista-explica' },
        h('li', { texto: 'La transcripción es local. El navegador solo graba; transcribe whisper acá. La API de reconocimiento de voz del navegador está prohibida: manda el audio al servidor del proveedor.' }),
        h('li', { texto: 'La ruta de inferencia se decide antes de tocar el modelo y después se verifica contra el SDK, en vez de confiar en lo que pedimos. Si la nota identifica a un cliente, la inferencia es local obligatoria: un peer delegado vería el prompt en claro.' }),
        h('li', { texto: 'La evidencia se verifica sin modelo. Cada lote trae una cita que tiene que aparecer literalmente en la nota. Una cita bien formada pero inventada se descarta igual que una mal formada.' }),
        h('li', { texto: 'Nada se persiste sin confirmación humana. El borrador vive en memoria y no tiene función de escritura a disco.' }),
        h('li', { texto: 'La nota con una pregunta sin responder se guarda igual y queda pendiente de revisión. Descartarla sería castigar al colaborador por no saber un dato.' }))),

    bloque('Multidispositivo: la trampa del reto',
      conDiagrama(diagramaMultidispositivo(),
        'El quórum lo dan observadores, no aparatos. Un peer puede transportar testimonios, pero quedan en Revisión P2P pendiente hasta que una persona local los confirma; recién entonces entran a la base instalada.')),

    bloque('Cuando el modelo intenta algo que no le corresponde',
      conDiagrama(diagramaPolitica(),
        'La consulta le ofrece al modelo las dos herramientas, incluida la peligrosa. Ofrecerla no abre un agujero: es lo que prueba que la defensa existe.')),

    bloque('Las ocho reglas duras, y dónde vive cada una',
      tabla(['Regla', 'Qué dice', 'Dónde se hace cumplir'], [
        ['RD-0', 'Un campo sin datos nunca se rellena', h('code', { texto: "resolverCampo() → 'Sin datos', sin valor" })],
        ['RD-1', 'Un observador no da quórum', h('code', { texto: 'resolverCampo() → rama de un voto' })],
        ['RD-2', 'Discrepancia es Sin quórum, nunca promedio', h('code', { texto: 'clusters, y valor queda undefined' })],
        ['RD-3', 'Un observador cuenta una vez: el más reciente', h('code', { texto: 'votos() → Map por observadorId' })],
        ['RD-4', 'La confianza es por campo, no por registro', h('code', { texto: 'cada campo se resuelve aparte' })],
        ['RD-5', 'Si todos hedgean, el techo es Reportado', h('code', { texto: 'puedeDarQuorum exige !hedging' })],
        ['RD-6', 'La frescura se mide desde visitadoEn', h('code', { texto: 'resolverCampo() y puntuar()' })],
        ['RD-7', 'Solo un testimonio Directo y asertivo da quórum', h('code', { texto: "naturaleza === 'Directo' && !hedging" })],
      ]),
      h('p', { clase: 'nota', texto: 'Están cubiertas una por una en test/reconcile.test.ts, y en conjunto en test/multidispositivo.test.ts. La versión larga de esta pantalla, con los mismos diagramas en Mermaid, está en docs/ESTADOS_Y_FLUJO.md.' })));

  seccion.dataset.pintada = 'si';
}
