import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { Modalidad } from '../../core/contracts.ts';

/**
 * Set de iconos de la app. **Los mismos trazos que la UI de escritorio**
 * (`apps/server/ui/index.html`, sprite `<symbol>`): viewBox 24×24, trazo 1.6
 * uniforme, sin relleno, extremos redondeados. Que las dos superficies
 * compartan el set es el punto — un ingeniero que usa el teléfono en la
 * visita y el escritorio a la vuelta tiene que reconocer las mismas formas.
 *
 * `color` se hereda del contexto y por defecto es `currentColor`: un icono
 * nunca introduce color propio, porque en este producto el color codifica
 * confianza y nada más.
 *
 * ★ Lo que NO está acá, a propósito: los cinco glifos de estado
 * (`● ◐ ○ · ▲`). Los fija §II.20 del doc maestro y son el portador de
 * significado no-cromático del eje de quórum; siguen siendo TIPOGRÁFICOS en
 * las dos superficies. Pasarlos a SVG los convertiría en un detalle de
 * implementación de esta pantalla en vez de una decisión del producto — y
 * además dejarían de escalar con el tamaño de texto del sistema.
 */

export type NombreIcono =
  | 'mr' | 'ct' | 'ultrasound' | 'xray' | 'monitoring' | 'therapy'
  | 'capturar' | 'cliente' | 'microfono' | 'detener' | 'chequeo' | 'renovacion';

interface Props {
  nombre: NombreIcono;
  /** Tamaño en px. Por defecto 20, que es el del texto de cuerpo + 4. */
  tamano?: number;
  color?: string;
  /** Para un icono que va SOLO, sin texto al lado que diga lo mismo. */
  etiqueta?: string;
}

export function Icono({ nombre, tamano = 20, color = 'currentColor', etiqueta }: Props) {
  return (
    <Svg
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorativo por defecto: en esta app el icono siempre acompaña a un
      // texto que ya dice lo mismo, y anunciarlo dos veces con lector de
      // pantalla es ruido.
      accessibilityRole={etiqueta ? 'image' : undefined}
      accessibilityLabel={etiqueta}
      accessibilityElementsHidden={!etiqueta}
      importantForAccessibility={etiqueta ? 'yes' : 'no-hide-descendants'}
    >
      {TRAZOS[nombre]}
    </Svg>
  );
}

const TRAZOS: Record<NombreIcono, React.ReactNode> = {
  /* ── Modalidades: la forma se reconoce antes que el texto ── */
  mr: <>
    <Rect x={3} y={6} width={18} height={12} rx={3} />
    <Circle cx={12} cy={12} r={3.2} />
    <Path d="M3.5 18.5h17" />
  </>,
  ct: <>
    <Circle cx={12} cy={10.5} r={7} />
    <Circle cx={12} cy={10.5} r={2.8} />
    <Path d="M6 20.5h12" />
  </>,
  ultrasound: <>
    <Rect x={10} y={3} width={4} height={4.5} rx={1} />
    <Path d="M7 11.5c1.6-1.2 3.3-1.8 5-1.8s3.4.6 5 1.8" />
    <Path d="M5.5 15.5c2.1-1.7 4.3-2.5 6.5-2.5s4.4.8 6.5 2.5" />
    <Path d="M4 19.5c2.6-2.2 5.3-3.3 8-3.3s5.4 1.1 8 3.3" />
  </>,
  xray: <>
    <Path d="M12 3v2.5" />
    <Path d="M12 5.5 6 18" />
    <Path d="m12 5.5 6 12.5" />
    <Path d="M12 5.5V18" />
    <Path d="M4 20.5h16" />
  </>,
  monitoring: <>
    <Rect x={3} y={4.5} width={18} height={12} rx={2} />
    <Path d="M6.5 10.5h2.2l1.4-2.8 2 5.6 1.3-2.8h3.1" />
    <Path d="M12 16.5v4" />
    <Path d="M9 20.5h6" />
  </>,
  therapy: <>
    <Path d="M16.5 4.5a8 8 0 1 0 0 15" />
    <Rect x={14} y={2.5} width={5.5} height={4} rx={1} />
    <Rect x={14} y={17.5} width={5.5} height={4} rx={1} />
  </>,

  /* ── Navegación ── */
  capturar: <>
    <Path d="M4 20h4L20 8l-4-4L4 16z" />
    <Path d="m14.5 5.5 4 4" />
  </>,
  cliente: <>
    <Path d="M4 20.5V8.5L12 3l8 5.5v12" />
    <Path d="M12 11.5v4.5" />
    <Path d="M9.75 13.75h4.5" />
    <Path d="M3 20.5h18" />
  </>,

  /* ── Acciones y confirmación ── */
  microfono: <>
    <Rect x={9.25} y={2.5} width={5.5} height={10} rx={2.75} />
    <Path d="M6 11a6 6 0 0 0 12 0" />
    <Path d="M12 17v4" />
    <Path d="M9 21h6" />
  </>,
  detener: <Rect x={6} y={6} width={12} height={12} rx={2} />,
  chequeo: <Path d="m4.5 12.5 5 5 10-11" />,
  renovacion: <>
    <Path d="M20 12a8 8 0 1 1-2.3-5.6" />
    <Path d="M20 3.5V7h-3.5" />
  </>,
};

/**
 * Icono de una modalidad del vocabulario controlado (`MODALIDADES` en
 * `core/contracts.ts`). Devuelve `null` para lo que no reconoce, en vez de un
 * icono genérico: un icono equivocado sobre un dato clínico es peor que
 * ninguno.
 */
const POR_MODALIDAD: Record<Modalidad, NombreIcono> = {
  MR: 'mr', CT: 'ct', Ultrasound: 'ultrasound', XRay: 'xray',
  PatientMonitoring: 'monitoring', ImageGuidedTherapy: 'therapy',
};

export function IconoModalidad(
  { modalidad, tamano, color }: { modalidad?: unknown; tamano?: number; color?: string },
) {
  const nombre = POR_MODALIDAD[modalidad as Modalidad];
  if (!nombre) return null;
  return <Icono nombre={nombre} {...(tamano !== undefined ? { tamano } : {})} {...(color !== undefined ? { color } : {})} />;
}
