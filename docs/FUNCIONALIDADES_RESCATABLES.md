# Funcionalidades rescatables para el pitch

> Registro de técnicas/funcionalidades que salieron como efecto secundario de un
> arreglo o de una sesión de trabajo, y que valen como punto propio del pitch —
> no solo como "bug fix". Cada entrada: qué es, por qué importa para el reto, y
> dónde vive en el código. Se resume/prioriza después; acá se va anotando en
> caliente.

---

## 1. Dictado por fragmentos (chunking) — transcripción continua, no bloqueante

**Qué es:** el dictado ya no graba todo y recién transcribe al final. Mientras
la persona sigue hablando, el audio se corta cada 20 segundos, cada corte se
manda a whisper on-device apenas se corta, y el texto entra al campo de la
nota en cuanto vuelve — sin que la grabación se detenga ni se espere nada.
Al tocar «Detener», casi toda la nota ya está transcrita; solo falta
transcribir el último pedacito (unos segundos de audio, no minutos).

**Por qué importa para el reto:** el caso real de un ingeniero de campo no es
dictar 15 segundos — es caminar una instalación grande y describir varios
equipos seguidos, que fácil son varios minutos de habla. Con el modelo
esperando a que la persona termine de hablar para recién empezar a procesar,
una visita larga se siente como "grabé 8 minutos y ahora esperá 8 minutos
más" — no es solo lento, contradice la promesa central de "procesamiento
local, sin fricción". El chunking hace visible en vivo lo que "todo corre
on-device, sin nube" realmente permite: procesar MIENTRAS se genera el dato,
no después. Es una demostración más fuerte de edge inference que "también
funciona sin wifi" — funciona MIENTRAS estás hablando.

**Cómo se explica en el pitch, una frase:** *"No esperamos a que termines de
hablar para empezar a pensar: el modelo va transcribiendo en fragmentos de 20
segundos mientras seguís grabando, así que grabar 10 minutos no significa
esperar 10 minutos después."*

**Dónde vive:** `apps/server/ui/capture.js`, función `alternarDictado()` —
`cortarFragmento()`, `transcribirFragmento()` y el `setInterval` de
`DURACION_FRAGMENTO_MS` (20 s). Un fragmento que falla no corta la grabación
(se avisa con `estado()` y se sigue); el único punto que sí usa la caja de
falla completa (`fallar()`) es si el ÚLTIMO fragmento, el de `stop()`, no
vuelve. Mismo endpoint `/api/transcribir` de siempre, sin cambios de
contrato — el chunking es enteramente del lado del navegador.

**Pendiente si se lleva al video/demo:**
- Con fragmentos de 20 s, una palabra partida justo en el corte puede perder
  una sílaba en el fragmento — tradeoff aceptado a cambio de no esperar; no
  medido todavía cuánto pesa esto en WER real.

### Cómo portarlo a `apps/mobile` — para Eric

Hoy el móvil graba TODO con `useAudioRecorder` (expo-audio) y recién llama a
`transcribirLocal()` una vez, al final, en `CapturarScreen.tsx` (función
`alternarDictado`, líneas ~40-87). Es el mismo problema que tenía el
escritorio: con una visita de varios minutos, la pantalla queda en
«Transcribiendo…» todo ese tiempo después de grabar todo ese tiempo.

**La idea NO se copia literal — la API de audio es distinta.** En el
escritorio el chunking corta el mismo buffer en memoria (WebAudio expone las
muestras crudas via `ScriptProcessor`). `expo-audio` no da ese nivel de
acceso: el grabador escribe directo a un archivo `.m4a` y no hay forma de
"cortar" ese archivo mientras se graba. La forma equivalente en mobile es
**grabación por segmentos, no por buffer**:

1. Grabar un segmento de ~15-20 s con el `grabadora` de siempre
   (`grabadora.record()`).
2. Al cumplirse el intervalo (un `setInterval`/`setTimeout` normal, igual que
   `DURACION_FRAGMENTO_MS` en el escritorio): `await grabadora.stop()`, tomar
   ese `uri`, y **sin esperar el resultado**, arrancar
   `transcribirLocal(uri, { liberarAsr: false })` en paralelo mientras YA se
   llama de nuevo a `grabadora.prepareToRecordAsync()` + `grabadora.record()`
   para el segmento siguiente. La persona nunca ve un corte — sigue
   grabando en el segmento nuevo mientras el segmento anterior se transcribe
   en background.
3. Cuando cada `transcribirLocal()` de un segmento vuelve, agregar su
   `texto` a `nota` con el mismo patrón que ya existe hoy en la línea 66
   (`setNota((previa) => ...)`) — ESO YA ESTÁ ESCRITO, no hay que tocarlo,
   solo llamarlo una vez por segmento en vez de una vez al final.
4. Al tocar «Detener»: parar el intervalo, hacer el mismo `stop()` +
   `transcribirLocal()` de siempre para el ÚLTIMO segmento (el que quedó
   grabando), y ahí sí esperar el resultado antes de soltar el botón —
   igual que hace el escritorio con el último fragmento en `stop()`.

**El detalle que NO es igual al escritorio y hay que resolver con cuidado:
`liberarAsr`.** `transcribirLocal()` en `dictar.ts` (línea 164) libera el
modelo ASR del pool por defecto en su `finally` (`liberarAsr = true`) — está
pensado para cuando se transcribe UNA vez. Si se llama así por cada segmento
de 15-20 s, cada llamada recarga whisper desde cero (el pool lo descargó al
terminar la anterior), y esa carga puede pesar más que el fragmento mismo —
el chunking dejaría de ganar tiempo. Hay que pasar `liberarAsr: false` en
todos los segmentos intermedios, y liberar recién en el ÚLTIMO segmento (el
de `stop()`), para que el modelo se quede cargado durante TODA la sesión de
dictado y solo se libere cuando termina de verdad. Esto es exactamente lo
que ya hace `qvac/pool.ts` — solo hay que decirle cuándo soltar, no cambiar
la política de pool.

**Qué mantener igual, porque ya sirve tal cual:**
- El manejo de alucinaciones (`pareceAlucinacion`, `esFraseBasura`) corre
  igual por segmento — un segmento sin voz se descarta solo, no arrastra
  nada al siguiente.
- `TIMEOUT_TRANSCRIPCION_MS` (2 min) por llamada sigue siendo el techo
  correcto para UN segmento corto.
- El patrón de `setNota((previa) => previa.trim() ? ... : texto)` para
  concatenar sin pisar es exactamente lo que hace falta por segmento —
  cero cambios ahí.

**Qué agregar, nuevo:**
- Un estado por segmento para mostrarlo en pantalla (algo como
  `type EstadoSegmento = 'transcribiendo' | 'transcrito' | 'sin-voz' |
  'error'`), y una lista chica de chips debajo del botón de Dictar — mismo
  espíritu que los chips `#fragmentos-dictado` del escritorio
  (`apps/server/ui/capture.js` + `apps/server/ui/style.css`): sin esto, en
  el teléfono tampoco queda ninguna prueba visible de que el chunking está
  procesando de a poco.
- Una guarda tipo `subiendoSegmento` para que si un segmento tarda más que
  el intervalo, no se disparen dos `transcribirLocal()` en paralelo
  (mismo problema que `subiendoFragmento` resuelve en el escritorio).

**Referencia exacta a mirar:** `apps/server/ui/capture.js`,
`alternarDictado()` — las funciones `cortarFragmento()` y
`transcribirFragmento()`, y el `setInterval` de `DURACION_FRAGMENTO_MS`.
La lógica de "no dos subidas en paralelo, el último fragmento sí bloquea y
sí puede fallar fuerte" es el patrón a repetir; el código de bajo nivel
(WAV, WebAudio) no aplica al teléfono.

---

## 2. Intelligence Layer — de testimonios a prioridades explicables

**Qué es:** la plataforma central ya no expone solo una lista de equipos o un
dashboard de conteos. A partir de los testimonios confirmados y reconciliados,
calcula una proyección de inteligencia con cuatro tipos de trabajo accionable:

- posible renovación por antigüedad;
- dato que requiere verificación por frescura;
- base instalada en disputa;
- información crítica faltante.

Cada resultado conserva cliente, equipo, estado de quórum, confianza,
frescura, observadores, IDs de evidencia, razones, siguiente acción y un
puntaje desglosado. No se persiste una conclusión como si fuera un hecho: se
recalcula desde la evidencia cada vez que entra un nuevo testimonio.

**Por qué importa para el reto:** el brief no pide una colección de notas ni
gráficas bonitas; pide convertir conocimiento de visitas en inteligencia
accionable. Esta capa completa el recorrido después de sincronización:

```text
testimonio confirmado → quórum / conflicto / frescura
                      → prioridad explicable
                      → próxima acción humana
```

El diferencial no es afirmar “oportunidad detectada”, sino poder responder
por qué aparece, qué evidencia la sostiene, qué tan actual está y qué debe
hacer la persona antes de iniciar una conversación comercial.

**Cómo se explica en el pitch, una frase:** *“El teléfono captura evidencia;
QUÓRUM central la convierte en una cola explicable de decisiones. No predice
una venta: muestra qué verificar, por qué y con qué testimonios.”*

**Puntaje explicable:**

```text
Puntaje de oportunidad =
  señal de edad       0–30
  calidad del dato    0–25
  evidencia           0–20
  frescura            0–10
  relevancia negocio  0–15
```

La relevancia comercial queda en `0` hasta que exista una política humana
explícita. No se inventa una prioridad de negocio con un modelo ni con una
heurística opaca. Confianza, status Philips y quórum siguen siendo conceptos
separados.

**Qué se ve en la interfaz:** la antigua pantalla **Panorama** pasa a ser
**Inteligencia**. Muestra primero prioridades, razones, evidencia, score y
acción; después calidad de datos y un árbol país → ciudad → customer →
equipo. Las barras por país y modalidad quedan como contexto, y la consulta
en lenguaje natural sigue usando el modelo solo para traducir la pregunta a
un filtro determinista.

**Dónde vive:**

- Motor: `apps/server/src/intelligence/central.ts`.
- API: `apps/server/src/index.ts`, dentro de `proyeccion()` y
  `GET /api/base-instalada` como `inteligencia`.
- Interfaz: `apps/server/ui/overview.js` y `apps/server/ui/style.css`.
- Pruebas: `apps/server/test/intelligence.test.ts`.

**Qué está probado:** renovación con evidencia y score, conflicto sin total
inventado, y separación entre información faltante y dato stale. La suite del
servidor pasó con **113 tests**, typecheck y los siete controles de seguridad
sin nube.

**Límite declarado, no oculto:** `Observacion` contiene `sitio`, pero la clave
actual de reconciliación compartida entre servidor y móvil todavía no lo
incluye. La interfaz muestra “sitios observados” y no atribuye equipo a un
site como si estuviera reconciliado. Para llegar a
`country → city → customer → site → installed equipment` de manera correcta,
hay que decidir un cambio de contrato y replicarlo byte a byte en ambas apps;
no se debe resolver con una inferencia silenciosa solo del servidor.
