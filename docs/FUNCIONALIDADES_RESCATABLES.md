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

**Dónde vive:** `apps/server/ui/capturar.js`, función `alternarDictado()` —
`cortarFragmento()`, `transcribirFragmento()` y el `setInterval` de
`DURACION_FRAGMENTO_MS` (20 s). Un fragmento que falla no corta la grabación
(se avisa con `estado()` y se sigue); el único punto que sí usa la caja de
falla completa (`fallar()`) es si el ÚLTIMO fragmento, el de `stop()`, no
vuelve. Mismo endpoint `/api/transcribir` de siempre, sin cambios de
contrato — el chunking es enteramente del lado del navegador.

**Pendiente si se lleva al video/demo:**
- Mismo patrón no está aplicado en `apps/mobile` (el pipeline Android graba
  entero antes de pasar a whisper) — evaluar si portarlo, o si el móvil ya
  resuelve esto distinto por su propio pipeline de 3 modelos.
- Con fragmentos de 20 s, una palabra partida justo en el corte puede perder
  una sílaba en el fragmento — tradeoff aceptado a cambio de no esperar; no
  medido todavía cuánto pesa esto en WER real.
