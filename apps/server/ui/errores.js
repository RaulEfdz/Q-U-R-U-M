/**
 * errores.js — traduce fallas técnicas a algo que se pueda leer y actuar.
 *
 * Antes, cualquier problema aparecía como «No se pudo leer del servidor» más
 * el mensaje crudo: `TypeError: Failed to fetch`, `/api/observar devolvió 500`,
 * `Failed to load model: Model with ID "QWEN3_1_7B_INST_Q4"…`. Nada de eso le
 * dice a nadie qué pasó ni qué hacer, y en una demo suena a que el sistema se
 * rompió cuando en realidad el server está apagado.
 *
 * Cada entrada devuelve tres cosas:
 *   titulo      — qué pasó, en una línea, sin dramatismo
 *   explicacion — por qué, en términos del producto y no de la implementación
 *   pasos       — qué hacer, en orden, concreto
 *
 * Criterio de tono: la mayoría de estas situaciones NO son errores del
 * usuario ni fallas del producto — son estados normales (el server no está
 * levantado, el modelo se está descargando, no hay micrófono). Se redactan
 * como estados, no como alarmas. El rojo se reserva para lo que de verdad
 * pide una decisión.
 */

/** `grave: false` = estado esperado, no una falla. Cambia el tratamiento visual. */
const CATALOGO = [
  {
    // `fetch` que no llega a destino. El caso más frecuente de todos.
    coincide: (m) => /failed to fetch|networkerror|load failed|fetch failed/i.test(m),
    grave: false,
    titulo: 'El servidor de QUÓRUM no está respondiendo',
    explicacion:
      'La interfaz corre en el navegador y pide los datos al servidor local, ' +
      'que está apagado o todavía arrancando. No se perdió nada: los datos ' +
      'viven en disco, no en esta pestaña.',
    pasos: [
      'Abrí una terminal en la carpeta apps/server del proyecto.',
      'Corré: npm start',
      'Esperá la línea «QUÓRUM en http://127.0.0.1:3000».',
      'Volvé acá y recargá la página.',
    ],
  },
  {
    // El modelo no está en el registro local todavía.
    coincide: (m) => /failed to load model|model with id|available models/i.test(m),
    grave: false,
    titulo: 'El modelo todavía no está en este equipo',
    explicacion:
      'La inferencia corre entera acá, sin nube, así que el modelo tiene que ' +
      'estar descargado antes de la primera nota. La primera descarga es de ' +
      'alrededor de 1 GB y necesita conexión; después ya no.',
    pasos: [
      'Verificá que tengas conexión para esta primera vez.',
      'Volvé a pedir la interpretación: la descarga arranca sola.',
      'Si el disco está lleno, liberá unos GB — el modelo no puede descomprimirse sin espacio.',
    ],
  },
  {
    coincide: (m) => /no produjo una extracción utilizable|validation_error/i.test(m),
    grave: false,
    titulo: 'El modelo no pudo estructurar la nota',
    explicacion:
      'Entendió el texto pero no logró separarlo en equipos con su cantidad y ' +
      'edad. La nota NO se perdió: se puede guardar igual y quedar pendiente ' +
      'de revisión.',
    pasos: [
      'Probá nombrar el tipo de equipo y la cantidad de forma directa: «dos MR NovaMed de siete años».',
      'Si son de edades distintas, decilo separado: «dos viejos y uno nuevo».',
      'O guardá la nota como está: nada se descarta.',
    ],
  },
  {
    coincide: (m) => /permiso de micrófono|notallowederror|permission denied/i.test(m),
    grave: false,
    titulo: 'Sin permiso de micrófono',
    explicacion:
      'El navegador bloqueó el acceso al micrófono. El dictado transcribe en ' +
      'este equipo y el audio no sale de acá, pero el permiso lo da el ' +
      'navegador, no la aplicación.',
    pasos: [
      'Tocá el candado en la barra de direcciones y permití el micrófono para este sitio.',
      'Recargá la página.',
      'Mientras tanto, podés escribir la nota a mano: es el mismo pipeline.',
    ],
  },
  {
    coincide: (m) => /policydenied|policy_denied|denegad/i.test(m),
    grave: true,
    titulo: 'Acción denegada por política',
    explicacion:
      'Algo intentó una operación que la política del sistema no permite. ' +
      'Esto NO es una falla: es la defensa funcionando, y quedó registrado en ' +
      'la cadena de auditoría con su motivo.',
    pasos: [
      'Abrí la pestaña Auditoría para ver el registro y el motivo exacto.',
      'Si la acción la pediste vos y esperabas que pasara, revisá desde dónde la iniciaste: el export lo tiene que pedir una persona, no el modelo.',
    ],
  },
  {
    coincide: (m) => /413|demasiado grande|payload too large/i.test(m),
    grave: false,
    titulo: 'El contenido es demasiado grande',
    explicacion: 'La nota o el audio superan el tope que acepta el servidor local.',
    pasos: ['Dividí la nota en dos capturas.', 'Si era un dictado, grabá tramos más cortos.'],
  },
  {
    coincide: (m) => /\b404\b|no encontrad/i.test(m),
    grave: false,
    titulo: 'Eso ya no está disponible',
    explicacion:
      'El borrador que se quiso confirmar no existe: o ya se guardó, o se ' +
      'descartó, o el servidor se reinició (los borradores viven en memoria ' +
      'hasta que los confirmás — es lo que hace que nada se persista sin tu OK).',
    pasos: ['Recargá la página.', 'Volvé a capturar la nota.'],
  },
  {
    coincide: (m) => /\b5\d\d\b/.test(m),
    grave: true,
    titulo: 'El servidor falló procesando el pedido',
    explicacion: 'Llegó el pedido pero algo se rompió del lado del servidor.',
    pasos: [
      'Mirá la terminal donde corre npm start: el detalle está ahí.',
      'La pestaña Auditoría suele tener el registro del fallo.',
      'Reintentá: si vuelve a pasar, el error de la terminal es el dato que hace falta.',
    ],
  },
];

const GENERICO = {
  grave: true,
  titulo: 'Algo no funcionó',
  explicacion: 'No se pudo completar la operación.',
  pasos: [
    'Reintentá.',
    'Si sigue, mirá la terminal donde corre npm start y la pestaña Auditoría.',
  ],
};

/**
 * Traduce un `Error` (o un texto) a algo accionable. Devuelve siempre un
 * objeto: nunca `null`, para que quien lo llame no tenga que decidir.
 *
 * Conserva `tecnico`: el mensaje original no se tira. Un desarrollador lo
 * necesita, y esconderlo del todo es el otro extremo del mismo problema.
 */
export function explicar(e) {
  const tecnico = e instanceof Error ? e.message : String(e ?? '');
  const entrada = CATALOGO.find((c) => c.coincide(tecnico)) ?? GENERICO;
  return {
    titulo: entrada.titulo,
    explicacion: entrada.explicacion,
    pasos: entrada.pasos,
    grave: entrada.grave,
    tecnico,
  };
}
