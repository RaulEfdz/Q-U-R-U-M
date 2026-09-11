import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioStream, requestRecordingPermissionsAsync } from 'expo-audio';
import {
  ActivityIndicator, Animated, BackHandler, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import type { EstadoRevision, Observacion } from '../core/contracts.ts';
import { procesarNota, type SalidaPipeline } from '../pipeline/cruzar.ts';
import { abrirSesionDictado, type SesionDictado } from '../pipeline/dictar.ts';
import type { ContextoExtraccion } from '../pipeline/extractor.ts';
import { estaListo, MODELOS } from '../qvac/pool.ts';
import { obtenerIdentidad } from './identidad.ts';
import { obtenerUbicacionCaptura } from './ubicacion.ts';
import { ConfirmacionBorrador } from './ConfirmacionBorrador.tsx';
import { Icono, ICONO_MODALIDAD } from './components/Icono.tsx';
import { color, elevacion, espacio, radio, tap, tipografia } from './theme.ts';

type Vista =
  | { paso: 'capturar' }
  | { paso: 'procesando' }
  | { paso: 'revision'; salida: SalidaPipeline; nota: string }
  | {
      paso: 'confirmado';
      estadoRevision: EstadoRevision;
      guardadas: number;
      observaciones: Observacion[];
    };

function etiquetaFecha(diasAtras: number): string {
  if (diasAtras === 0) return 'Hoy';
  if (diasAtras === 1) return 'Ayer';
  const f = new Date(Date.now() - diasAtras * 86_400_000);
  return f.toLocaleDateString('es-PA', { day: 'numeric', month: 'short' });
}

/** La fecha completa bajo la etiqueta: "Hoy" solo no dice qué día es, y la
 *  visita puede haber sido hace una semana. */
function fechaLarga(diasAtras: number): string {
  const f = new Date(Date.now() - diasAtras * 86_400_000);
  return f.toLocaleDateString('es-PA', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** ms → "840 ms" / "12.3 s". Para las etapas ya terminadas. */
function formatoDuracion(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** bytes → "78 MB" / "1.0 GB". Mismo criterio que `mb()` en pipeline/cruzar.ts
 *  (no compartido: es una línea, no vale la pena un módulo por eso). */
function mb(bytes: number): string {
  const m = bytes / (1024 * 1024);
  return m >= 1024 ? `${(m / 1024).toFixed(1)} GB` : `${Math.round(m)} MB`;
}

function contarPalabras(texto: string): number {
  const limpio = texto.trim();
  return limpio ? limpio.split(/\s+/).length : 0;
}

/*
 * Indicador de nivel de voz (esquina de la nota, ver `campoTexto` más abajo):
 * 4 barras que siguen el volumen REAL del micrófono mientras se graba, no un
 * loop decorativo. `onBuffer` de `useAudioStream` entrega PCM int16 crudo a
 * la cadencia del hardware (ver `pipeline/dictar.ts`) — el RMS de cada buffer
 * alimenta directamente `Animated.Value.setValue()`, sin pasar por
 * `setState`: a esa frecuencia, un `setState` por buffer re-renderiza toda la
 * pantalla varias veces por segundo por nada, cuando lo único que cambia es
 * el alto de 4 barras.
 */
const PESO_BARRA_VOZ = [0.55, 1, 0.8, 1.15] as const;   // variedad orgánica: 4 barras idénticas se ven mecánicas
const BARRA_VOZ_MIN = 4, BARRA_VOZ_MAX = 18;             // dp

/**
 * El panel de "corriendo en tu teléfono" es el mismo para interpretar texto
 * y para dictar — mismo componente, misma fila por etapa — así que su forma
 * es más ancha que `EventoPipeline` (que es específica del pipeline de
 * `procesarNota`, con su propia unión de etapas). Un `EventoPipeline` entra
 * acá sin conversión (`etapa: string` es más amplio); lo que NO entraría al
 * revés es una `PasoUI` de dictado (`'grabando'`/`'transcribiendo'`) dentro
 * de un `EventoPipeline[]`.
 */
interface PasoUI {
  etapa: string;
  etiqueta: string;
  estado: 'corriendo' | 'ok' | 'error';
  ms?: number;
  detalle?: string;
  /** Cuándo apareció la etapa. Lo pone `actualizarPaso`, no el pipeline. */
  inicio?: number;
}

/* ── Agrupado del panel de progreso ──────────────────────────────────────
 *
 * El pipeline emite SIETE etapas, y dos de ellas (`portero:carga` y
 * `portero:inferencia`, ídem extractor) son la misma pregunta partida en
 * "cargar el modelo" y "correrlo" — una distinción de implementación que a
 * quien está parado en un pasillo de hospital no le dice nada. El panel las
 * junta por el prefijo de `etapa` y les pone un título en lengua llana; el
 * texto técnico que emite el pipeline (`etiqueta`, con nombre y peso del
 * modelo) baja a la línea de detalle, donde sigue estando para el jurado y
 * para el log. Esto es presentación: el pipeline no cambia.
 */
const ORDEN_GRUPOS = ['precheck', 'portero', 'extractor', 'verificador'] as const;

const TITULO_GRUPO: Record<string, string> = {
  precheck: 'Leyendo la nota',
  portero: '¿Hay equipo en la nota?',
  extractor: 'Extrayendo los datos',
  verificador: 'Verificando las citas',
  atajo: 'Ninguna señal ve equipo',
  dictando: 'Escuchando y transcribiendo',
};

interface GrupoUI {
  clave: string;
  titulo: string;
  estado: 'pendiente' | 'corriendo' | 'ok' | 'error';
  /** Suma de las sub-etapas ya terminadas. */
  ms: number;
  inicio: number | null;
  etiqueta?: string;
  detalle?: string;
}

function agrupar(pasos: PasoUI[], procesando: boolean): GrupoUI[] {
  const orden: string[] = [];
  const mapa = new Map<string, GrupoUI>();

  for (const p of pasos) {
    // `fin` no es una etapa que se vea: el título del panel ya dice "Listo".
    const clave = p.etapa.split(':')[0]!;
    if (clave === 'fin') { mapa.set('fin', { clave: 'fin', titulo: '', estado: 'ok', ms: 0, inicio: null }); continue; }
    let g = mapa.get(clave);
    if (!g) {
      g = { clave, titulo: TITULO_GRUPO[clave] ?? p.etiqueta, estado: 'ok', ms: 0, inicio: null };
      mapa.set(clave, g);
      orden.push(clave);
    }
    g.ms += p.ms ?? 0;
    if (p.inicio !== undefined && (g.inicio === null || p.inicio < g.inicio)) g.inicio = p.inicio;
    if (p.estado === 'error') g.estado = 'error';
    else if (p.estado === 'corriendo' && g.estado !== 'error') g.estado = 'corriendo';
    g.etiqueta = p.etiqueta;
    if (p.detalle) g.detalle = p.detalle;
  }

  const grupos = orden.map((c) => mapa.get(c)!);
  // Mientras corre y todavía no llegó `fin`, las etapas que faltan se dibujan
  // en gris: el panel muestra el plan entero, no solo lo ya hecho — así se ve
  // cuánto falta, no solo cuánto va.
  if (!procesando || mapa.has('fin')) return grupos;
  return [
    ...grupos,
    ...ORDEN_GRUPOS.filter((c) => !mapa.has(c)).map((c): GrupoUI => ({
      clave: c, titulo: TITULO_GRUPO[c]!, estado: 'pendiente', ms: 0, inicio: null,
    })),
  ];
}

/** Una línea para que TalkBack anuncie EN QUÉ va el pipeline. Cambia solo
 *  cuando una etapa arranca o termina — nunca con el contador de segundos,
 *  que si no sería un anuncio por segundo. */
function resumenA11y(pasos: PasoUI[]): string {
  const ult = pasos[pasos.length - 1];
  if (!ult) return 'Interpretando la nota';
  if (ult.estado === 'error') return `Se cortó en: ${ult.etiqueta}`;
  if (ult.estado === 'ok') return `${ult.etiqueta}: ${ult.detalle ?? 'listo'}`;
  return `${ult.etiqueta}…`;
}

/** Segundos transcurridos de la etapa activa. Tiene su propio `setInterval`
 *  para que el tick no re-renderice toda la pantalla — solo este `<Text>`.
 *  Se remonta al cambiar de etapa (la fila lleva `key={g.clave}`). */
function ContadorEtapa({ desde }: { desde: number | null }) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 300);
    return () => clearInterval(id);
  }, []);
  const ms = desde ? ahora - desde : 0;
  return (
    <Text style={[estilos.pasoMs, estilos.pasoMsCorriendo]}>
      {ms >= 900 ? `${Math.round(ms / 1000)} s` : ''}
    </Text>
  );
}

/** El riel del stepper: círculo de estado y, salvo en la última fila, la
 *  línea que baja hasta la siguiente. */
function RielPaso({ estado, ultimo }: { estado: GrupoUI['estado']; ultimo: boolean }) {
  return (
    <View style={estilos.riel}>
      {estado === 'corriendo' ? (
        <View style={[estilos.circulo, estilos.circuloCorriendo]}>
          <ActivityIndicator size="small" color={color.primario} />
        </View>
      ) : estado === 'error' ? (
        <View style={[estilos.circulo, estilos.circuloError]}>
          <Icono nombre="alerta" tamano={13} color={color.textoInvertido} />
        </View>
      ) : estado === 'ok' ? (
        <View style={[estilos.circulo, estilos.circuloHecho]}>
          <Icono nombre="chequeo" tamano={13} color={color.textoInvertido} />
        </View>
      ) : (
        <View style={[estilos.circulo, estilos.circuloPendiente]} />
      )}
      {ultimo ? null : (
        <View style={[estilos.conector, estado === 'ok' && estilos.conectorHecho]} />
      )}
    </View>
  );
}

export default function CapturarScreen() {
  const [nota, setNota] = useState('');
  const [diasAtras, setDiasAtras] = useState(0);
  const [vista, setVista] = useState<Vista>({ paso: 'capturar' });
  const [error, setError] = useState<string | null>(null);
  // ¿El texto de la nota vino del micrófono? Solo cambia la línea de pie de
  // la tarjeta ("Dictado · N palabras" vs "N palabras").
  const [huboDictado, setHuboDictado] = useState(false);

  // Progreso — una fila por etapa, compartido entre interpretar texto
  // (precheck → portero → extractor → verificador, ver `EventoPipeline` en
  // pipeline/cruzar.ts) y dictar (grabando → transcribiendo, más abajo). Se
  // actualiza en su lugar cuando la etapa pasa de 'corriendo' a 'ok'/'error'.
  // El contador de segundos de la etapa activa lo mueve `<ContadorEtapa>`
  // con su propio `setInterval` — así el tick de 300 ms no re-renderiza toda
  // la pantalla ~300 veces por captura, solo ese `<Text>`.
  const [pasos, setPasos] = useState<PasoUI[]>([]);

  function actualizarPaso(e: PasoUI) {
    setPasos((prev) => {
      const i = prev.findIndex((p) => p.etapa === e.etapa);
      if (i === -1) return [...prev, { ...e, inicio: Date.now() }];
      const copia = prev.slice();
      // El `inicio` es el de la PRIMERA vez que apareció la etapa: el
      // contador de la fila mide desde que arrancó, no desde el último
      // evento que la actualizó.
      copia[i] = { ...e, inicio: prev[i]!.inicio };
      return copia;
    });
  }

  // `App.tsx` precarga portero + extractor al abrir. Acá solo sondeamos si
  // ya terminaron, para avisar que la primera nota va a tardar más si no.
  const [modelosListos, setModelosListos] = useState(
    () => estaListo('portero') && estaListo('extractor'),
  );
  useEffect(() => {
    if (modelosListos) return;
    const id = setInterval(() => {
      if (estaListo('portero') && estaListo('extractor')) {
        setModelosListos(true);
        clearInterval(id);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [modelosListos]);

  // El botón/gesto Atrás del sistema no debe cerrar la app —ni perder lo
  // que el modelo extrajo— si estás en una sub-pantalla de la captura:
  //   - procesando: bloquea (la inferencia ya está corriendo).
  //   - confirmado: vuelve a una nota nueva.
  //   - revisión: NO lo toca acá — `ConfirmacionBorrador` registra su propio
  //     handler y, como se monta después, `BackHandler` (LIFO) lo evalúa
  //     primero; ahí está la pregunta de "¿descartar cambios?".
  //   - capturar: deja pasar el evento (App.tsx o el sistema deciden).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (vista.paso === 'procesando') return true;
      if (vista.paso === 'confirmado') { nuevaNota(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [vista.paso]);

  // Guarda contra doble tap: entre el toque y el re-render que deshabilita el
  // botón hay una ventana de un frame.
  const interpretando = useRef(false);

  /* ── Fase 11 · dictado por voz EN VIVO, todo on-device ──
   *
   * `useAudioStream` (distinto de `useAudioRecorder`, que grababa a un
   * archivo .m4a y recién ahí transcribía) entrega audio PCM crudo del
   * micrófono en tiempo real; cada buffer se empuja a la sesión de
   * `abrirSesionDictado` (`pipeline/dictar.ts`), que va devolviendo texto por
   * frase/pausa a medida que el VAD nativo cierra un segmento de habla — el
   * texto aparece por frase, no letra por letra mientras se habla.
   *
   * `grabando`/`transcribiendo` conservan el mismo rol que en el modo
   * archivo (mic activo / cerrando), solo que ahora "transcribiendo" es la
   * cola corta de cerrar la sesión tras tocar "Detener", no de esperar a
   * transcribir un archivo entero — la transcripción ya viene corriendo en
   * paralelo desde que arrancó a grabar.
   */
  const sesionDictadoRef = useRef<SesionDictado | null>(null);
  const [grabando, setGrabando] = useState(false);
  const [transcribiendo, setTranscribiendo] = useState(false);
  const ETIQUETA_DICTADO = `Dictando con whisper en vivo (${mb(MODELOS.asr.expectedSize)})`;

  // Lo que ya había en la nota ANTES de tocar Dictar — el dictado se escribe
  // encima de esto, nunca lo pisa. `onTexto` recibe el texto ACUMULADO de la
  // sesión entera (ver dictar.ts), así que cada actualización reemplaza la
  // nota por "lo de antes + lo acumulado", no lo va concatenando de a poco.
  const notaAntesDeGrabar = useRef('');

  // Ver el comentario de `PESO_BARRA_VOZ` arriba: 4 `Animated.Value` fijos
  // (no recreados por render) más su nivel suavizado en un ref plano — el
  // suavizado vive fuera de React porque lo escribe `onBuffer`, no un evento
  // de UI.
  const barrasVoz = useRef(
    PESO_BARRA_VOZ.map(() => new Animated.Value(BARRA_VOZ_MIN)),
  ).current;
  const suavizadoVoz = useRef([0, 0, 0, 0]);

  const { stream } = useAudioStream({
    sampleRate: 16_000,
    channels: 1,
    encoding: 'int16',
    onBuffer: (buffer) => {
      sesionDictadoRef.current?.escribir(new Uint8Array(buffer.data));

      // RMS del mismo buffer que ya se manda a transcribir — no es una
      // segunda lectura del micrófono. Ataque rápido / caída lenta, igual
      // que el indicador equivalente de `apps/server/ui/capture.js`: separa
      // "reactivo" de "nervioso" y el silencio converge solo a la barra
      // mínima sin necesitar un caso aparte.
      const muestras = new Int16Array(buffer.data);
      let suma = 0;
      for (let i = 0; i < muestras.length; i++) {
        const v = muestras[i]! / 32768;
        suma += v * v;
      }
      const rms = Math.sqrt(suma / muestras.length);
      const suavizado = suavizadoVoz.current;
      for (let i = 0; i < barrasVoz.length; i++) {
        const objetivo = Math.min(1, rms * 7 * PESO_BARRA_VOZ[i]!);
        const alfa = objetivo > suavizado[i]! ? 0.5 : 0.12;
        suavizado[i] = suavizado[i]! + (objetivo - suavizado[i]!) * alfa;
        barrasVoz[i]!.setValue(BARRA_VOZ_MIN + (BARRA_VOZ_MAX - BARRA_VOZ_MIN) * suavizado[i]!);
      }
    },
  });

  /** Vuelve las 4 barras a su alto mínimo — al parar de grabar, no queda
   *  ninguna a mitad de camino. */
  function reiniciarIndicadorVoz() {
    suavizadoVoz.current = [0, 0, 0, 0];
    barrasVoz.forEach((b) => b.setValue(BARRA_VOZ_MIN));
  }

  const alternarDictado = useCallback(async () => {
    setError(null);

    if (grabando) {
      setGrabando(false);
      setTranscribiendo(true);
      stream.stop();
      reiniciarIndicadorVoz();
      const cerrandoDesde = Date.now();
      try {
        const sesion = sesionDictadoRef.current;
        sesionDictadoRef.current = null;
        if (!sesion) throw new Error('la sesión de dictado ya se había cerrado');
        const { texto, descartadaPorAlucinacion, correcciones } = await sesion.terminar();
        const ms = Date.now() - cerrandoDesde;
        if (descartadaPorAlucinacion) {
          // Whisper devolvió una frase repetida — su modo de falla típico con
          // audio sin voz. Se descarta en `dictar.ts` y acá se dice por qué:
          // meter quince frases inventadas en una nota que la persona va a
          // confirmar como propia es peor que no transcribir nada.
          actualizarPaso({
            etapa: 'dictando', etiqueta: ETIQUETA_DICTADO, estado: 'error', ms,
            detalle: 'no se escuchó voz — se descartó, no se inventó texto',
          });
          // `onTexto` ya escribió en la caja lo que fue transcribiendo en vivo
          // (ver abajo): si la sesión entera resultó alucinación, eso tiene
          // que salir de la nota, no quedar como si fuera texto real.
          setNota(notaAntesDeGrabar.current);
          setError('No se escuchó voz en la grabación. Acercá el micrófono y probá de nuevo, o escribí la nota.');
          return;
        }
        if (!texto) {
          actualizarPaso({
            etapa: 'dictando', etiqueta: ETIQUETA_DICTADO, estado: 'error', ms,
            detalle: 'no se entendió nada en el audio',
          });
          setNota(notaAntesDeGrabar.current);
          setError('No se entendió nada en el audio. Probá de nuevo, o escribilo.');
          return;
        }
        // Si el corrector léxico (`pipeline/lexico.ts`) reescribió una sigla o
        // una marca, se dice cuál y por cuál. La nota la confirma la persona
        // como propia: una palabra que cambió el código y ella no vio sería
        // exactamente el tipo de silencio que este producto no se puede
        // permitir. En el caso normal la lista viene vacía y no se muestra nada.
        const cambios = correcciones.length > 0
          ? ` · corregido: ${correcciones.map((c) => `"${c.desde}" → ${c.hasta}`).join(', ')}`
          : '';
        actualizarPaso({
          etapa: 'dictando', etiqueta: ETIQUETA_DICTADO, estado: 'ok', ms,
          detalle: `"${texto.length > 70 ? `${texto.slice(0, 70)}…` : texto}"${cambios}`,
        });
        // La caja ya viene mostrando esto en vivo desde `onTexto` — acá se fija
        // el valor FINAL (la pasada de cierre puede limar algo que el
        // acumulado en vivo todavía no había filtrado) sobre la nota de ANTES
        // de grabar, no sobre `nota` actual: perder lo que había escrito antes
        // de tocar el micrófono sería el peor resultado posible en una app
        // cuya premisa es no perder datos.
        const previa = notaAntesDeGrabar.current;
        setNota(previa ? `${previa} ${texto}` : texto);
        setHuboDictado(true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        actualizarPaso({
          etapa: 'dictando', etiqueta: ETIQUETA_DICTADO, estado: 'error',
          ms: Date.now() - cerrandoDesde, detalle: `se cortó acá: ${msg}`,
        });
        setError(msg);
      } finally {
        setTranscribiendo(false);
      }
      return;
    }

    try {
      const permiso = await requestRecordingPermissionsAsync();
      if (!permiso.granted) {
        setError('Sin permiso de micrófono no se puede dictar. Podés escribir la nota igual.');
        return;
      }
      // Nueva sesión: se limpia la traza de la anterior, igual que
      // `interpretar()` limpia la del texto al arrancar de nuevo. Se abre
      // ANTES de arrancar el stream de audio para no perder los primeros
      // buffers mientras la sesión todavía no existe.
      setPasos([]);
      actualizarPaso({ etapa: 'dictando', etiqueta: ETIQUETA_DICTADO, estado: 'corriendo' });
      // Lo que ya había escrito, para que el dictado se agregue encima y no lo
      // pise (ver el comentario de `notaAntesDeGrabar` más arriba).
      notaAntesDeGrabar.current = nota.trim();
      sesionDictadoRef.current = await abrirSesionDictado({
        // El texto va DIRECTO a la caja a medida que llega — no a un panel
        // aparte: es lo que se está dictando, y el lugar donde se lee y se
        // corrige es la nota, no un registro de progreso.
        onTexto: (acumulado) => {
          const previa = notaAntesDeGrabar.current;
          setNota(previa ? `${previa} ${acumulado}` : acumulado);
        },
      });
      await stream.start();
      setGrabando(true);
    } catch (e) {
      sesionDictadoRef.current = null;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [grabando, nota, stream, ETIQUETA_DICTADO]);

  async function interpretar() {
    const texto = nota.trim();
    if (!texto || interpretando.current) return;
    interpretando.current = true;
    setError(null);
    setPasos([]);
    setVista({ paso: 'procesando' });
    try {
      // GPS del teléfono en el instante de "Interpretar" — no de la visita
      // en sí (`visitadoEn` puede ser un día anterior, ver el selector de
      // fecha de arriba). En paralelo con `obtenerIdentidad` — el GPS puede
      // tardar hasta 8 s (`app/ubicacion.ts`) y no hay motivo para
      // encadenarlo detrás de una lectura de archivo instantánea. Nunca
      // bloquea: sin permiso o sin señal, sigue `undefined` y la nota se
      // interpreta igual.
      const [identidad, ubicacionCaptura] = await Promise.all([
        obtenerIdentidad(), obtenerUbicacionCaptura(),
      ]);
      const visitadoEn = new Date(Date.now() - diasAtras * 86_400_000).toISOString();
      const ctx: ContextoExtraccion = {
        observadorId: identidad.observadorId,
        dispositivoId: identidad.dispositivoId,
        visitadoEn,
        fuente: 'texto',
        ubicacionCaptura,
      };
      const salida = await procesarNota(texto, ctx, actualizarPaso);
      setVista({ paso: 'revision', salida, nota: texto });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // El prefijo va ACÁ, no en el banner de abajo: `error` también lo
      // setea `alternarDictado` con frases ya completas ("No se escuchó voz
      // en la grabación…", "Sin permiso de micrófono…"), y anteponerles
      // "No se pudo interpretar la nota" ahí las vuelve confusas — un
      // problema del micrófono se leía como si fuera del extractor.
      setError(`No se pudo interpretar la nota: ${msg}`);
      // Marcá la etapa que estaba corriendo como cortada, así en pantalla
      // queda claro DÓNDE falló, no solo que falló.
      setPasos((prev) => prev.map((p) =>
        p.estado === 'corriendo' ? { ...p, estado: 'error', detalle: `se cortó acá: ${msg}` } : p));
      setVista({ paso: 'capturar' });
    } finally {
      interpretando.current = false;
    }
  }

  function nuevaNota() {
    setNota('');
    setDiasAtras(0);
    setPasos([]);
    setError(null);
    setHuboDictado(false);
    setVista({ paso: 'capturar' });
  }

  if (vista.paso === 'revision') {
    return (
      <ConfirmacionBorrador
        salida={vista.salida}
        nota={vista.nota}
        // Volver a editar la nota: se limpia la traza del pipeline. Sin esto,
        // Capturar mostraba el panel con la corrida ANTERIOR (que terminó bien,
        // llegó a la revisión) titulado "Se cortó a mitad" — el título de la
        // rama de error. La traza vieja además es de una nota que estás por
        // cambiar. El panel de "Se cortó a mitad" sigue apareciendo cuando la
        // interpretación falla de verdad (el `catch` de `interpretar`).
        onVolver={() => { setPasos([]); setVista({ paso: 'capturar' }); }}
        onConfirmado={(r) => setVista({ paso: 'confirmado', ...r })}
      />
    );
  }

  if (vista.paso === 'confirmado') {
    return <PantallaConfirmado vista={vista} onNuevaNota={nuevaNota} />;
  }

  const procesando = vista.paso === 'procesando';
  // Corriendo: interpretando el texto O dictando (grabando/transcribiendo) —
  // el panel de abajo es el mismo para las dos cosas.
  const corriendo = procesando || grabando || transcribiendo;
  const mostrarPanel = corriendo || pasos.length > 0;
  const huboError = pasos.some((p) => p.estado === 'error');
  const grupos = agrupar(pasos, procesando);
  const palabras = contarPalabras(nota);

  return (
    <KeyboardAvoidingView
      style={estilos.contenedor}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={estilos.scroll} keyboardShouldPersistTaps="handled">
        {procesando ? (
          /* Mientras corre, la nota deja de ser el protagonista: se colapsa a
             dos líneas de contexto para que el panel de progreso —lo único
             que cambia— se quede con la pantalla. */
          <View style={estilos.resumenNota}>
            <View style={estilos.resumenFilete} />
            <View style={estilos.resumenTextos}>
              <Text style={estilos.resumenCita} numberOfLines={2}>{nota.trim()}</Text>
              <Text style={estilos.resumenMeta}>
                {huboDictado ? 'Dictado · ' : ''}{palabras} palabra{palabras === 1 ? '' : 's'} · {etiquetaFecha(diasAtras).toLowerCase()}
              </Text>
            </View>
          </View>
        ) : (
          <>
            <View style={estilos.tarjetaNota}>
              <Text style={estilos.tituloCampo}>¿Qué viste?</Text>
              <View style={estilos.campoTexto}>
                <TextInput
                  style={estilos.textarea}
                  accessibilityLabel="¿Qué viste? Escribí lo que observaste en la visita"
                  multiline
                  value={nota}
                  onChangeText={setNota}
                  editable={!grabando && !transcribiendo}
                  placeholder="Estoy en Hospital DemoCare Pacific, en Panamá. Tienen dos MR y un CT…"
                  placeholderTextColor={color.textoTenue}
                />
                {/* Nivel de voz en vivo, esquina inferior derecha de la caja —
                    decorativo (`importantForAccessibility`): "Escuchando y
                    transcribiendo" ya lo dice el panel de abajo. */}
                {grabando ? (
                  <View style={estilos.indicadorVoz} pointerEvents="none" importantForAccessibility="no">
                    {barrasVoz.map((valor, i) => (
                      <Animated.View key={i} style={[estilos.barraVoz, { height: valor }]} />
                    ))}
                  </View>
                ) : null}
              </View>
              {palabras > 0 ? (
                <View style={estilos.pieNota}>
                  <Icono nombre="microfono" tamano={15} color={color.textoTenue} />
                  <Text style={estilos.pieNotaTexto}>
                    {huboDictado ? 'Dictado · ' : 'Escrito · '}{palabras} palabra{palabras === 1 ? '' : 's'}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={estilos.bloqueFecha}>
              <Text style={estilos.overline}>Fecha de visita</Text>
              <View style={estilos.filaFecha}>
                <Pressable
                  style={estilos.botonFecha}
                  onPress={() => setDiasAtras((d) => d + 1)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Un día antes"
                >
                  <Icono nombre="anterior" tamano={18} color={color.texto} />
                </Pressable>
                <View
                  style={estilos.chipFecha}
                  accessible
                  accessibilityRole="text"
                  accessibilityLabel={`Fecha de visita: ${etiquetaFecha(diasAtras)}, ${fechaLarga(diasAtras)}`}
                >
                  <Text style={estilos.chipFechaDia} numberOfLines={1} importantForAccessibility="no">
                    {etiquetaFecha(diasAtras)}
                  </Text>
                  <Text style={estilos.chipFechaSub} numberOfLines={1} importantForAccessibility="no">
                    {fechaLarga(diasAtras)}
                  </Text>
                </View>
                <Pressable
                  style={[estilos.botonFecha, diasAtras === 0 && estilos.botonFechaInerte]}
                  onPress={() => setDiasAtras((d) => Math.max(0, d - 1))}
                  disabled={diasAtras === 0}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Un día después"
                  accessibilityState={{ disabled: diasAtras === 0 }}
                >
                  <Icono nombre="siguiente" tamano={18} color={color.texto} />
                </Pressable>
              </View>
            </View>
          </>
        )}

        {corriendo && (
          <Text accessibilityLiveRegion="polite" style={estilos.soloLector}>
            {resumenA11y(pasos)}
          </Text>
        )}

        {mostrarPanel && (
          <View style={estilos.panel}>
            <View style={estilos.panelEncabezado}>
              <Text style={estilos.overline}>
                {corriendo
                  ? 'Corriendo en tu teléfono'
                  : huboError ? 'Se cortó a mitad' : 'Listo'}
              </Text>
            </View>

            {grupos.map((g, i) => (
              <View key={g.clave} style={estilos.paso}>
                <RielPaso estado={g.estado} ultimo={i === grupos.length - 1} />
                <View style={[estilos.pasoCuerpo, i === grupos.length - 1 && estilos.pasoCuerpoUltimo]}>
                  <View style={estilos.pasoFila}>
                    <Text
                      style={[
                        estilos.pasoTitulo,
                        g.estado === 'corriendo' && estilos.pasoTituloCorriendo,
                        g.estado === 'pendiente' && estilos.pasoTituloPendiente,
                      ]}
                    >
                      {g.titulo}
                    </Text>
                    {g.estado === 'corriendo' ? (
                      <ContadorEtapa desde={g.inicio} />
                    ) : g.ms > 0 ? (
                      <Text style={estilos.pasoMs}>{formatoDuracion(g.ms)}</Text>
                    ) : null}
                  </View>
                  {g.etiqueta ? <Text style={estilos.pasoCaption}>{g.etiqueta}</Text> : null}
                  {g.detalle ? <Text style={estilos.pasoCaption}>{g.detalle}</Text> : null}
                </View>
              </View>
            ))}

            {procesando && (
              <View style={estilos.panelPie}>
                <Icono nombre="candado" tamano={14} color={color.textoTenue} />
                <Text style={estilos.panelPieTexto}>
                  Ni el audio ni el texto salen del dispositivo. La primera nota
                  carga los modelos a memoria; las siguientes reúsan lo cargado.
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Barra de acción fija al pie: las dos únicas decisiones de esta
          pantalla quedan bajo el pulgar y no se van con el scroll. */}
      <View style={estilos.barraAccion}>
        {error ? (
          <View style={estilos.aviso} accessibilityLiveRegion="polite">
            <Icono nombre="alerta" tamano={14} color={color.peligro} />
            <Text style={[estilos.avisoTexto, estilos.avisoError]}>{error}</Text>
          </View>
        ) : !modelosListos && !corriendo ? (
          <View style={estilos.aviso} accessibilityLiveRegion="polite">
            <Icono nombre="info" tamano={14} color={color.textoTenue} />
            <Text style={estilos.avisoTexto}>
              Preparando los modelos en el teléfono: la primera nota tarda unos
              segundos más.
            </Text>
          </View>
        ) : null}

        <View style={estilos.filaBotones}>
          {/* Dictado por voz con whisper.cpp on-device (`pipeline/dictar.ts`).
              NUNCA Web Speech API: manda el audio a un servidor del
              proveedor, y es la restricción más fácil de romper sin darse
              cuenta. */}
          <Pressable
            style={[
              estilos.botonDictar,
              grabando && estilos.botonGrabando,
              (procesando || transcribiendo) && estilos.botonInerte,
            ]}
            onPress={() => { void alternarDictado(); }}
            disabled={procesando || transcribiendo}
            accessibilityRole="button"
            accessibilityLabel={grabando ? 'Detener y transcribir' : 'Dictar la nota'}
            accessibilityState={{ disabled: procesando || transcribiendo }}
          >
            {transcribiendo ? (
              <ActivityIndicator color={color.textoTenue} />
            ) : (
              <>
                <Icono
                  nombre={grabando ? 'detener' : 'microfono'}
                  tamano={19}
                  color={grabando ? color.peligro : procesando ? color.sinDatosTinta : color.primario}
                />
                <Text
                  style={[
                    estilos.textoBotonDictar,
                    grabando && estilos.textoBotonGrabando,
                    procesando && estilos.textoBotonInerte,
                  ]}
                  numberOfLines={1}
                >
                  {grabando ? 'Detener' : 'Dictar'}
                </Text>
              </>
            )}
          </Pressable>
          <Pressable
            style={[
              estilos.botonPrimario, estilos.botonInterpretar,
              (!nota.trim() || corriendo) && estilos.botonDeshabilitado,
            ]}
            onPress={interpretar}
            disabled={!nota.trim() || corriendo}
            accessibilityRole="button"
            accessibilityState={{ disabled: !nota.trim() || corriendo, busy: procesando }}
            accessibilityLabel={procesando ? 'Interpretando la nota, esperá' : 'Interpretar'}
          >
            {procesando ? (
              <>
                <ActivityIndicator color={color.primarioTexto} />
                <Text style={estilos.textoBotonPrimario}>Interpretando…</Text>
              </>
            ) : (
              <>
                <Text style={estilos.textoBotonPrimario}>Interpretar</Text>
                <Icono nombre="flecha" tamano={18} color={color.primarioTexto} />
              </>
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * Cierre de la captura: qué quedó guardado, dicho como recibo. La pantalla
 * anterior era un glifo y una línea de texto; quien acaba de confirmar
 * cuatro campos a mano necesita ver QUÉ se guardó, no solo que se guardó.
 */
function PantallaConfirmado({
  vista, onNuevaNota,
}: {
  vista: Extract<Vista, { paso: 'confirmado' }>;
  onNuevaNota: () => void;
}) {
  const pendiente = vista.estadoRevision === 'pendiente-de-revision';
  const subtitulo = pendiente
    ? 'Quedó pendiente de revisión — no contestaste la pregunta, y eso está bien: no se perdió nada.'
    : vista.guardadas > 0
      ? `${vista.guardadas} lote${vista.guardadas === 1 ? '' : 's'} confirmado${vista.guardadas === 1 ? '' : 's'}. Nada salió del dispositivo.`
      : 'Visita sin equipo observado. También es un dato, y también se guarda.';

  return (
    <View style={estilos.contenedor}>
      <ScrollView contentContainerStyle={estilos.scrollCentro}>
        <View style={estilos.circuloExito}>
          {/* Antes era el carácter «✓», que en Android se renderiza con la
              fuente de emoji del sistema y aparece en color, saltándose la
              paleta. Ahora es un trazo del set propio. */}
          <Icono nombre="chequeo" tamano={46} color={color.quorum} />
        </View>
        <Text style={estilos.tituloExito} accessibilityLiveRegion="polite">
          Guardado en el teléfono
        </Text>
        <Text style={estilos.subtituloExito}>{subtitulo}</Text>

        {vista.observaciones.length > 0 && (
          <View style={estilos.recibo}>
            {vista.observaciones.map((o, i) => (
              <View key={i} style={estilos.filaEquipo}>
                <View style={estilos.mosaico}>
                  <Icono nombre={ICONO_MODALIDAD[o.lote.modalidad]} tamano={22} color={color.primario} />
                </View>
                <View style={estilos.equipoTextos}>
                  <Text style={estilos.equipoNombre}>
                    {o.lote.cantidad ?? 1} × {o.lote.modalidad}
                  </Text>
                  <Text style={estilos.equipoMeta}>
                    {[
                      o.lote.marca,
                      o.lote.edadAnios === undefined
                        ? 'edad sin dato'
                        : `${Array.isArray(o.lote.edadAnios) ? o.lote.edadAnios.join('–') : o.lote.edadAnios} años`,
                      o.naturaleza,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </View>
            ))}

            <View style={estilos.divisor} />

            {/* Qué pasa DESPUÉS. El nivel de quórum no se calcula en el
                teléfono —la reconciliación vive del lado del server, misma
                `trust/reconcile.ts`— así que acá se dice lo que sí es cierto
                desde acá: el testimonio ya cuenta, y la corroboración llega
                cuando se encuentra con los demás. */}
            <View style={estilos.cierre}>
              <Text style={estilos.cierreGlifo} importantForAccessibility="no">●</Text>
              <Text style={estilos.cierreTexto}>
                Tu testimonio ya cuenta. El nivel de quórum se resuelve cuando
                estas observaciones se encuentren con las de otros visitantes.
              </Text>
            </View>
          </View>
        )}
      </ScrollView>

      <View style={estilos.barraAccion}>
        <Pressable style={estilos.botonPrimario} onPress={onNuevaNota} accessibilityRole="button">
          <Icono nombre="mas" tamano={19} color={color.primarioTexto} />
          <Text style={estilos.textoBotonPrimario}>Nueva nota</Text>
        </Pressable>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: color.fondo },
  // `flexGrow: 1` para que el contenido ocupe el alto de la pantalla en vez de
  // apelotonarse arriba dejando medio teléfono vacío; sigue siendo scroll
  // cuando el teclado sube o la nota es larga.
  scroll: { padding: espacio.lg, gap: espacio.lg, flexGrow: 1 },
  scrollCentro: { padding: espacio.lg, flexGrow: 1, justifyContent: 'center', alignItems: 'center' },

  overline: { ...tipografia.overline, color: color.textoTenue },

  // ── Tarjeta de la nota ────────────────────────────────────────────────
  // La jerarquía la da la sombra, no el borde: la nota es la única
  // superficie levantada de la pantalla, y eso alcanza para que sea lo
  // primero que se mira.
  tarjetaNota: {
    flexGrow: 1, minHeight: 200, backgroundColor: color.superficie,
    borderRadius: radio.xl, borderWidth: 1, borderColor: color.bordeSutil,
    paddingHorizontal: espacio.lg, paddingTop: espacio.lg, paddingBottom: espacio.md,
    ...elevacion.tarjeta,
  },
  tituloCampo: { ...tipografia.subtitulo, fontWeight: '700', color: color.texto },
  // El textarea no puede tener hijos (RN no permite overlays dentro de un
  // `TextInput`), así que el indicador de voz es HERMANO suyo acá adentro,
  // superpuesto con `position: 'absolute'` — mismo truco que `.campo-texto`
  // en `apps/server/ui/style.css`.
  campoTexto: { flex: 1, marginTop: espacio.md, position: 'relative' },
  textarea: {
    ...tipografia.cuerpo, fontSize: 17, lineHeight: 25,
    flex: 1, padding: 0,
    color: color.texto, textAlignVertical: 'top',
  },
  indicadorVoz: {
    position: 'absolute', right: 0, bottom: espacio.sm,
    flexDirection: 'row', alignItems: 'flex-end', gap: 3,
    height: BARRA_VOZ_MAX,
  },
  barraVoz: { width: 3, borderRadius: 999, backgroundColor: color.primario },
  pieNota: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    marginTop: espacio.md, paddingTop: espacio.md,
    borderTopWidth: 1, borderTopColor: color.bordeSutil,
  },
  pieNotaTexto: { ...tipografia.pequeno, color: color.textoTenue, fontVariant: ['tabular-nums'] },

  // ── Nota colapsada mientras corre el pipeline ─────────────────────────
  resumenNota: {
    flexDirection: 'row', alignItems: 'flex-start', gap: espacio.md,
    backgroundColor: color.superficie, borderRadius: radio.lg,
    borderWidth: 1, borderColor: color.bordeSutil,
    padding: espacio.md, ...elevacion.sutil,
  },
  resumenFilete: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: color.borde },
  resumenTextos: { flex: 1, minWidth: 0, gap: 3 },
  resumenCita: { ...tipografia.etiqueta, fontWeight: '400', color: color.textoTenue, lineHeight: 18 },
  resumenMeta: { ...tipografia.pequeno, fontSize: 11, color: color.textoTenue, fontVariant: ['tabular-nums'] },

  // ── Fecha ─────────────────────────────────────────────────────────────
  bloqueFecha: { gap: espacio.sm },
  // `alignItems: 'stretch'`: el chip y las flechas comparten alto aunque la
  // fuente del sistema esté en grande.
  filaFecha: { flexDirection: 'row', alignItems: 'stretch', gap: espacio.sm },
  botonFecha: {
    width: tap.normal, minHeight: tap.normal, borderRadius: radio.lg,
    borderWidth: 1.5, borderColor: color.borde, backgroundColor: color.superficie,
    alignItems: 'center', justifyContent: 'center', ...elevacion.sutil,
  },
  // "Un día después" con la fecha en Hoy: el control sigue en su lugar —el
  // par de flechas no se reacomoda— pero apagado. No se le baja el área
  // táctil, solo la tinta.
  botonFechaInerte: { opacity: 0.34, shadowOpacity: 0, elevation: 0 },
  chipFecha: {
    flex: 1, minHeight: tap.normal, paddingVertical: espacio.xs,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.superficie, borderRadius: radio.lg,
    borderWidth: 1.5, borderColor: color.borde, ...elevacion.sutil,
  },
  chipFechaDia: { fontSize: 16, fontWeight: '700', color: color.texto },
  chipFechaSub: { ...tipografia.pequeno, fontSize: 11, color: color.textoTenue, fontVariant: ['tabular-nums'] },

  // Fuera de la vista pero en el árbol de accesibilidad: TalkBack lo lee, el
  // ojo no. `position: absolute` + offset — `display:'none'` o tamaño 0 lo
  // podarían del árbol.
  soloLector: { position: 'absolute', left: -9999, width: 1, height: 1 },

  // ── Panel de progreso del pipeline ────────────────────────────────────
  panel: {
    padding: espacio.lg, borderRadius: radio.xl,
    borderWidth: 1, borderColor: color.bordeSutil, backgroundColor: color.superficie,
    ...elevacion.tarjeta,
  },
  panelEncabezado: { marginBottom: espacio.lg },
  paso: { flexDirection: 'row', gap: 13 },
  riel: { width: 26, alignItems: 'center', alignSelf: 'stretch' },
  circulo: { width: 26, height: 26, borderRadius: radio.pastilla, alignItems: 'center', justifyContent: 'center' },
  circuloHecho: { backgroundColor: color.quorum },
  circuloError: { backgroundColor: color.peligro },
  circuloCorriendo: {
    backgroundColor: color.superficie, borderWidth: 2, borderColor: color.superficieHundida,
  },
  circuloPendiente: {
    backgroundColor: color.fondo, borderWidth: 2, borderColor: color.superficieHundida,
  },
  conector: { width: 2, flex: 1, minHeight: 16, borderRadius: 1, backgroundColor: color.superficieHundida },
  conectorHecho: { backgroundColor: color.quorum, opacity: 0.35 },
  pasoCuerpo: { flex: 1, minWidth: 0, paddingBottom: espacio.xl },
  pasoCuerpoUltimo: { paddingBottom: 0 },
  pasoFila: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: espacio.sm },
  pasoTitulo: { ...tipografia.subtitulo, flex: 1, color: color.texto },
  pasoTituloCorriendo: { color: color.primario, fontWeight: '700' },
  pasoTituloPendiente: { color: color.sinDatosTinta, fontWeight: '500' },
  // `flexShrink: 0`: la duración no se aplasta cuando el título es largo o
  // la fuente del sistema está en grande.
  pasoMs: {
    ...tipografia.pequeno, fontWeight: '600', color: color.textoTenue,
    fontVariant: ['tabular-nums'], flexShrink: 0,
  },
  pasoMsCorriendo: { color: color.primario },
  pasoCaption: { ...tipografia.pequeno, color: color.textoTenue, lineHeight: 17, marginTop: espacio.xs },
  panelPie: {
    flexDirection: 'row', alignItems: 'flex-start', gap: espacio.sm,
    marginTop: espacio.md, paddingTop: espacio.md,
    borderTopWidth: 1, borderTopColor: color.bordeSutil,
  },
  panelPieTexto: { ...tipografia.pequeno, flex: 1, color: color.textoTenue, lineHeight: 16 },

  // ── Barra de acción fija ──────────────────────────────────────────────
  barraAccion: {
    paddingHorizontal: espacio.lg, paddingTop: espacio.md, paddingBottom: espacio.xl,
    backgroundColor: color.fondo,
    borderTopWidth: 1, borderTopColor: color.bordeSutil,
    gap: espacio.md,
  },
  aviso: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingHorizontal: 2 },
  avisoTexto: { ...tipografia.pequeno, flex: 1, color: color.textoTenue, lineHeight: 16 },
  avisoError: { color: color.peligro },
  filaBotones: { flexDirection: 'row', gap: espacio.md },
  botonDictar: {
    flex: 1, minHeight: tap.grande, borderRadius: radio.pastilla, borderWidth: 1.5,
    borderColor: color.primario, backgroundColor: color.superficie,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: espacio.sm,
    ...elevacion.sutil,
  },
  textoBotonDictar: { fontSize: 16, fontWeight: '700', color: color.primario },
  // Grabando: el borde y el texto toman el color de peligro, que en esta app
  // NO es de la rampa de quórum — es un estado de la interfaz, no un nivel de
  // confianza sobre un dato.
  botonGrabando: { borderColor: color.peligro, backgroundColor: color.peligroFondo },
  textoBotonGrabando: { color: color.peligro },
  // Inerte ≠ deshabilitado a media opacidad: el botón sigue ahí, en gris
  // pleno, para que no parezca que la interfaz se apagó mientras el modelo
  // corre. El `accessibilityState` es el que dice que no se puede tocar.
  botonInerte: {
    borderColor: color.borde, backgroundColor: color.superficieHundida,
    shadowOpacity: 0, elevation: 0,
  },
  textoBotonInerte: { color: color.sinDatosTinta },
  botonInterpretar: { flex: 2 },
  botonPrimario: {
    minHeight: tap.grande, borderRadius: radio.pastilla, backgroundColor: color.primario,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    paddingHorizontal: espacio.xl, ...elevacion.primaria,
  },
  botonDeshabilitado: { opacity: 0.45, shadowOpacity: 0, elevation: 0 },
  textoBotonPrimario: { ...tipografia.accion, color: color.primarioTexto, letterSpacing: 0.2 },

  // ── Confirmado ────────────────────────────────────────────────────────
  circuloExito: {
    width: 92, height: 92, borderRadius: radio.pastilla, backgroundColor: '#e6f3ee',
    alignItems: 'center', justifyContent: 'center', marginBottom: espacio.lg,
    shadowColor: color.quorum, shadowOpacity: 0.4, shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 }, elevation: 4,
  },
  tituloExito: { ...tipografia.titulo, color: color.texto, textAlign: 'center' },
  subtituloExito: {
    ...tipografia.cuerpo, fontSize: 15, lineHeight: 21, color: color.textoTenue,
    textAlign: 'center', marginTop: espacio.xs,
  },
  recibo: {
    alignSelf: 'stretch', marginTop: espacio.xl, backgroundColor: color.superficie,
    borderRadius: radio.xl, borderWidth: 1, borderColor: color.bordeSutil,
    paddingHorizontal: espacio.lg, paddingVertical: espacio.md, ...elevacion.tarjeta,
  },
  filaEquipo: { flexDirection: 'row', alignItems: 'center', gap: espacio.md, paddingVertical: espacio.sm },
  mosaico: {
    width: 40, height: 40, borderRadius: radio.md, backgroundColor: color.primarioTinte,
    alignItems: 'center', justifyContent: 'center',
  },
  equipoTextos: { flex: 1, minWidth: 0, gap: 1 },
  equipoNombre: { fontSize: 16, fontWeight: '700', color: color.texto, fontVariant: ['tabular-nums'] },
  equipoMeta: { ...tipografia.pequeno, color: color.textoTenue, lineHeight: 16 },
  divisor: { height: 1, backgroundColor: color.bordeSutil, marginVertical: espacio.sm },
  cierre: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingTop: espacio.sm },
  cierreGlifo: { fontSize: 13, lineHeight: 18, color: color.quorumTinta },
  cierreTexto: { ...tipografia.etiqueta, fontWeight: '400', flex: 1, color: color.texto, lineHeight: 18 },
});
