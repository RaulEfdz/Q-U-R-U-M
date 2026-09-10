import { transcribe } from '@qvac/sdk';
import type { RecordingOptions } from 'expo-audio';
import { obtener, liberar } from '../qvac/pool.ts';

/**
 * Fase 11 · dictado por voz. Audio → texto, ENTERAMENTE en el dispositivo.
 *
 * ★ NUNCA la Web Speech API del navegador: manda el audio a un servidor del
 * proveedor y es la restricción más fácil de romper sin darse cuenta. Acá la
 * transcripción la hace whisper.cpp vía `@qvac/sdk`, con el modelo cargado en
 * el mismo pool que el portero y el extractor.
 *
 * `expo-audio`, no `expo-av`: el segundo fue removido en Expo SDK 54
 * (corrección obligatoria #4 de `CLAUDE.md`).
 */

/**
 * Whisper quiere 16 kHz mono. Android NO ofrece PCM/WAV en `expo-audio` — sus
 * formatos son 3gp/mpeg4/amr/aac/webm y los encoders amr/aac — así que se
 * graba AAC dentro de MP4, que es el más estándar del set, ya a la frecuencia
 * y los canales que el modelo espera para no re-muestrear después.
 *
 * El SDK acepta audio comprimido: la UI de escritorio le pasa `.webm` de
 * `MediaRecorder` por la misma vía y transcribe bien.
 */
export const OPCIONES_GRABACION: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 64_000,
  android: {
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
    extension: '.m4a',
    sampleRate: 16_000,
  },
  /*
   * `RecordingOptions` exige los tres bloques de plataforma. El proyecto es
   * Android-only (CLAUDE.md §Stack: «Android 12+, arm64, solo dispositivo
   * físico»), así que `ios` y `web` van mínimos y no se mantienen: el que
   * importa es `android`. Sus tipos además no aceptan `numberOfChannels` ni
   * `bitRate`, que ya están declarados arriba.
   */
  ios: { extension: '.m4a', audioQuality: 96, sampleRate: 16_000 },
  web: { mimeType: 'audio/webm', bitsPerSecond: 64_000 },
};

/**
 * Techo de espera para un dictado. Whisper on-device sobre una nota de voz
 * normal tarda segundos; si a los dos minutos no volvió, algo se trabó —
 * típicamente un audio de duración cero por un toque accidental del micrófono,
 * que deja al modelo esperando muestras que nunca llegan.
 *
 * Sin este techo la pantalla de captura queda muerta: `transcribiendo` no se
 * apaga nunca y con él quedan deshabilitados el campo de texto, el micrófono y
 * «Interpretar». Un toque de más obligaba a matar la app, que en una app cuya
 * premisa es no perder datos es el peor final posible.
 */
export const TIMEOUT_TRANSCRIPCION_MS = 120_000;

/**
 * Corre `tarea` con un techo de tiempo.
 *
 * Ojo con lo que esto NO hace: el SDK no expone cancelación, así que la
 * inferencia colgada sigue corriendo abajo hasta que termine sola. Lo que se
 * recupera es la interfaz, no el hilo. Por eso `transcribirLocal` libera el
 * modelo en su `finally` pase lo que pase — si el ASR se quedó tomado, el
 * extractor, que es el que hace falta a continuación, se queda sin RAM.
 */
async function conTecho<T>(tarea: Promise<T>, ms: number, mensaje: string): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const techo = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error(mensaje)), ms);
  });
  try {
    return await Promise.race([tarea, techo]);
  } finally {
    if (temporizador !== undefined) clearTimeout(temporizador);
  }
}

/** Lo que el modelo devolvió, más de dónde salió. */
export interface Transcripcion {
  texto: string;
  /** Duración de la transcripción en ms, para el chip de ruta de inferencia. */
  tardoMs: number;
}

/**
 * Transcribe un archivo de audio local.
 *
 * `liberarAsr` (por defecto `true`): whisper se descarga del pool en cuanto
 * termina. Es la política que ya declara `qvac/pool.ts` — el ASR es el
 * primero en la fila de eviction porque no se vuelve a usar hasta el próximo
 * dictado, y en un teléfono de 6 GB los tres modelos juntos no entran. Sin
 * esto, dictar dos veces seguidas puede dejar sin RAM al extractor, que es el
 * que de verdad hace falta a continuación.
 */
export async function transcribirLocal(
  uriAudio: string,
  {
    liberarAsr = true,
    timeoutMs = TIMEOUT_TRANSCRIPCION_MS,
  }: { liberarAsr?: boolean; timeoutMs?: number } = {},
): Promise<Transcripcion> {
  const arranque = Date.now();
  try {
    // El techo cubre la carga del modelo además de la inferencia: `obtener`
    // puede tardar tanto como `transcribe` la primera vez, y colgarse ahí deja
    // la pantalla igual de muerta.
    return await conTecho(
      (async () => {
        const modelId = await obtener('asr');
        // `audioChunk` acepta una ruta de archivo o un buffer. La uri de
        // `expo-audio` viene como `file:///...`; el SDK espera una ruta del
        // sistema, así que se le quita el esquema.
        const ruta = uriAudio.startsWith('file://') ? uriAudio.slice('file://'.length) : uriAudio;
        const texto = await transcribe({ modelId, audioChunk: ruta });
        return { texto: String(texto ?? '').trim(), tardoMs: Date.now() - arranque };
      })(),
      timeoutMs,
      'La transcripción tardó demasiado y se canceló. Probá de nuevo, o escribí la nota a mano — no se perdió lo que ya tenías.',
    );
  } finally {
    // En el `finally`: si la transcripción falla, el modelo igual se libera.
    // Un error de audio no puede dejar 78 MB tomados y al extractor sin RAM.
    if (liberarAsr) {
      try { await liberar('asr'); } catch { /* liberar es best-effort */ }
    }
  }
}
