/**
 * help.js — explicación breve del módulo visible.
 *
 * No es onboarding ni texto de marketing: responde la pregunta que alguien
 * tiene mientras opera la herramienta. El diálogo no cambia datos ni navega;
 * al cerrarlo, la persona vuelve al mismo punto de trabajo.
 */
import { $, h, icono, pintar } from './dom.js';

const CONTENIDO = {
  capturar: {
    titulo: 'Para qué sirve Capturar',
    proposito: 'Para convertir una visita en evidencia estructurada sin obligarte a completar un formulario largo.',
    pasos: [
      'Escribí o dictá lo que viste como lo contarías normalmente.',
      'La IA local prepara un borrador con cliente, equipo, cantidad, edad y fuente.',
      'Revisás y confirmás: hasta ese momento no se persiste nada.',
    ],
    nota: 'La IA propone; vos confirmás. La inferencia y la transcripción corren localmente.',
  },
  cliente: {
    titulo: 'Para qué sirve Cliente 360',
    proposito: 'Para entender la base instalada de una cuenta y cuánto podés confiar en cada dato.',
    pasos: [
      'Cada grupo reúne testimonios que describen el mismo entorno.',
      'Cantidad, marca, modelo y edad tienen confianza propia; no se asigna una confianza única al registro.',
      'Si hay desacuerdo, se muestran las versiones y sus testigos: nunca se inventa un promedio.',
    ],
    nota: 'Quórum y frescura son distintos: un dato corroborado puede requerir una visita nueva.',
  },
  panorama: {
    titulo: 'Para qué sirve Inteligencia',
    proposito: 'Para transformar muchas visitas en prioridades visibles entre clientes, modalidades y países.',
    pasos: [
      'Revisá distribución, oportunidades de renovación, datos antiguos y conflictos.',
      'Usá filtros deterministas para responder preguntas sobre la base instalada.',
      'Exportá solo cuando vos lo decidís; el modelo no puede iniciar una exportación.',
    ],
    nota: 'Los totales declaran sus límites: los datos desconocidos no se hacen pasar por cero.',
  },
  auditoria: {
    titulo: 'Para qué sirve Auditoría',
    proposito: 'Para comprobar que la evidencia y las decisiones de política siguen siendo verificables.',
    pasos: [
      'Verificá la cadena de hashes de las observaciones persistidas.',
      'Consultá las llamadas de inferencia y si fueron locales o delegadas.',
      'Detectá una alteración o una acción denegada antes de confiar en un resultado.',
    ],
    nota: 'Una garantía útil se puede inspeccionar: no depende de una etiqueta de “seguro”.',
  },
  comofunciona: {
    titulo: 'Para qué sirve Cómo funciona',
    proposito: 'Para recorrer el camino que sigue una observación y entender por qué QUÓRUM no convierte cualquier frase en verdad.',
    pasos: [
      'La conversación se vuelve un borrador con evidencia literal.',
      'El humano confirma antes de persistir y el motor reconcilia por campo.',
      'La vista final conserva fuente, incertidumbre, conflicto y oportunidad de acción.',
    ],
    nota: 'Es la explicación del modelo de confianza, no una pantalla de marketing.',
  },
};

let vista = 'capturar';

/* Una lectura de diez segundos para la ayuda contextual del centro de
 * control. No reemplaza los diagramas de "Cómo funciona": resume solamente
 * el camino que transforma una visita en una prioridad explicable. */
function flujoInteligencia() {
  const paso = (titulo, detalle) => h('li', { clase: 'flujo-ayuda-paso' },
    h('strong', { texto: titulo }),
    h('span', { texto: detalle }));

  return h('section', { clase: 'flujo-ayuda', 'aria-label': 'Del testimonio a la prioridad' },
    h('p', { clase: 'flujo-ayuda-titulo', texto: 'Del testimonio a la decisión' }),
    h('ol', { clase: 'flujo-ayuda-pasos' },
      paso('1. Observación', 'Una visita llega desde móvil o carga local.'),
      paso('2. Evidencia', 'Se preserva fuente, fecha y texto original.'),
      paso('3. Inteligencia', 'El motor cruza quórum, conflicto y frescura.'),
      paso('4. Prioridad', 'Cliente 360 explica qué verificar o actuar.')));
}

function renderizar() {
  const contenido = CONTENIDO[vista] ?? CONTENIDO.capturar;
  pintar($('#ayuda-contenido'),
    h('div', { clase: 'ayuda-cabecera' },
      h('span', { clase: 'ayuda-icono' }, icono('ayuda')),
      h('h2', { id: 'ayuda-titulo', texto: contenido.titulo })),
    h('p', { clase: 'ayuda-proposito', texto: contenido.proposito }),
    h('ol', { clase: 'ayuda-pasos' },
      contenido.pasos.map((paso) => h('li', { texto: paso }))),
    vista === 'panorama' ? flujoInteligencia() : null,
    h('p', { clase: 'ayuda-nota', texto: contenido.nota }));
}

export function actualizarAyuda(siguienteVista) {
  vista = siguienteVista;
}

export function montarAyuda() {
  const dialogo = $('#ayuda-modulo');
  $('#abrir-ayuda').onclick = () => {
    renderizar();
    if (typeof dialogo.showModal === 'function') dialogo.showModal();
    else dialogo.setAttribute('open', '');
  };
}
