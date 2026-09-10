# Para retomar — QUÓRUM

> Escrito 2026-09-10 ~14:50. Último commit pusheado: `400d46d`. Versión: **v0.4.0**.
> Estado detallado de cada decisión: `BITACORA.md`. Reglas: `CLAUDE.md` de cada app.

## Arrancá por acá (5 minutos)

```bash
cd /Users/dev-hyper-rf/Documents/PROYECTOS/RF/HACK/focus/proyectos/QURUM

# 1. ¿Sigue todo verde?
cd apps/server && npx tsc --noEmit && npm test   # esperado: 31/31, exit 0
cd ../mobile  && npx tsc --noEmit                # esperado: exit 0

# 2. ¿Los 10 archivos compartidos siguen idénticos?
cd ../..
for f in core/contracts.ts core/ids.ts trust/normalize.ts trust/similarity.ts \
         trust/entity.ts trust/reconcile.ts trust/score.ts policy/engine.ts \
         context/spotlight.ts export/philips.ts; do
  diff -q "apps/server/src/$f" "apps/mobile/src/$f" >/dev/null || echo "DIFIERE: $f"
done
```

**Nunca uses pipe para leer un exit code.** `npx tsc --noEmit | head -5; echo $?` devuelve el exit de `head`, siempre 0. Me comí ese error y rompí el build sin enterarme.

## Qué funciona hoy

- **El modelo corre on-device en el Pixel 7.** Qwen3.5 0.8B (533 MB) descarga, carga y responde. Cero inferencia en la nube. Este era el gate del proyecto.
- Núcleo compartido completo y congelado: contratos, motor de quórum (RD-0..RD-7), puntaje, policy, spotlighting, export CSV.
- `apps/mobile`: pipeline completo (precheck → portero → extractor → verificador → cruzar), pool de modelos, store, y las pantallas Capturar, confirmación editable del borrador y **Cliente 360**.
- **Cliente 360 verificada corriendo en el Pixel 7**, con evidencia en pantalla de las cuatro cosas que tiene que demostrar: confianza por campo, `Sin quórum` con ambas versiones y quién dijo cada una (sin promediar), cohortes de edad como composición y no contradicción, y frescura como eje separado del estado. Los datos se siembran con `apps/mobile/dev/sembrar-demo.ts`.
- La app **arranca en el dispositivo**. Hasta esta mañana no lo hacía: cuatro archivos importaban `node:crypto`, que no existe en React Native (ver trampa #6).
- `apps/server`: Fases 1-9 completas. El servidor **arranca y responde** en `127.0.0.1:3000` con las nueve rutas, y sirve las cuatro pantallas de escritorio (Capturar, Cliente 360, Panorama, Auditoría). Verificado en un navegador real con los 23 registros del seed.
- **`npm run verify:no-cloud` → 7/7 controles en verde.** Es la prueba de cumplimiento que se corre en vivo en el video.
- `data/seed.json` con 23 observaciones válidas que producen los cuatro estados de quórum.
- **El pipeline de tres modelos corrió de punta a punta en el Pixel 7** (2026-09-10 11:37): precheck → portero → extractor → verificador → borrador → pantalla de confirmación humana. Degradó como promete el diseño cuando el extractor no produjo lotes: mostró la nota completa con una pregunta, sin perder el dato.
- 31 tests, todos verdes. Typecheck verde en las dos apps.
- Contraste WCAG AA verificado en la rampa de confianza de las dos superficies.
- **El extractor extrae.** Dos lotes correctos de una nota real, en 7-14 s.
- **El dictado por voz existe en las dos superficies** (Fase 11): en el móvil con `expo-audio` + whisper on-device, en escritorio con WebAudio → WAV PCM 16 kHz. Nunca Web Speech API.
- **El momento del ataque se puede reproducir en vivo**: el modelo intenta `exportar_dataset` y el PEP lo deniega, con el motivo visible y auditado.
- **50 tests verdes** (eran 31): se agregaron `policy.test.ts` e `injection.test.ts`, que cubren lo que el proyecto presenta como su diferenciador y antes no tenía ni un test.
- Iconografía propia (15 iconos SVG) compartida entre las dos superficies, sin emojis y sin librerías.
- Diccionario de errores en la UI: cada falla dice qué pasó y qué hacer, con el comando exacto cuando aplica.
- Capturas de las cuatro pantallas de escritorio y del móvil en `docs/capturas/`.

## Qué falta

| Qué | Dónde | Notas |
|---|---|---|
| **Dictado con voz REAL** | las dos apps | Lo más importante que queda. El flujo funciona de punta a punta y transcribe en menos de 8 s, pero solo se probó grabando SILENCIO — y ahí whisper alucinaba (ver §El dictado abajo). Falta que una persona dicte una nota de verdad y comprobar que el texto sirve. |
| **Build de release de mobile** | `apps/mobile` | Nunca funcionó. El primer intento falló por disco lleno en la Mac. Es lo que hace falta para la demo sin WiFi: hoy corre en debug con el JS servido por Metro. |
| **Build de release de mobile** | `apps/mobile` | Nunca se probó. Hoy corre en debug con el JS servido por Metro: si se apaga el WiFi y la app se reinicia, NO arranca — y no por la nube, sino porque no encuentra el bundle. La demo con WiFi apagado lo necesita: `expo run:android --variant release`. |
| **Audio** | `apps/mobile` | Fase 11. `expo-audio`, NUNCA `expo-av` (removido en SDK 54). |
| Medir tiempos reales de inferencia | las dos | En la Mac, cargar el extractor y responder tardó del orden de quince minutos. Hay que medirlo en el teléfono antes de grabar, y decidir si la demo se graba sobre móvil o escritorio. |

## ✅ El extractor — RESUELTO

Era el bloqueante del proyecto y ya no lo es. **Causa:** Qwen3 arrancaba en
modo *thinking* y gastaba el presupuesto de tokens razonando en prosa, sin
llegar a emitir el tool call — que con tool calling nativo es la única vía por
la que el modelo devuelve estructura.

**Fix:** `reasoning_budget: 0` en `generationParams`. Y en mobile hacía falta
una segunda corrección: `predict: 80` es el valor del PORTERO (responde un
sí/no); el extractor necesita devolver un array de lotes con cita literal, así
que pasa a 512.

**Verificado:** `POST /api/observar` devuelve dos lotes correctos
(`{MR, NovaMed, NM-MR 700, cantidad 3, edad 8}` y `{CT, HelixCare}`) con
`delegado: false`. Y la inferencia en la Mac tarda **7 a 14 segundos**, no los
quince minutos que decía este archivo: esos quince minutos eran el síntoma de
tener el disco al 100%.

## ★ El dictado — dónde quedó

**Funciona, pero solo se probó con silencio.** El flujo completo corre:
permiso, grabación, whisper on-device, texto en el campo de la nota, en menos
de 8 segundos (la primera vez tarda más porque descarga el modelo de 78 MB).

**El problema que apareció:** grabando sin hablar, whisper devolvió
*"You remind me of the one who is on the other side."* quince veces, en
inglés, dentro del campo que la persona después confirma como propio.

Dos defensas ya aplicadas en las dos superficies:

1. **`prompt` inicial en castellano** con el vocabulario del dominio. El SDK no
   expone parámetro de idioma (`transcribeParamsSchema` solo acepta `modelId`,
   `prompt`, `metadata`, `audioChunk`), y sin pista whisper autodetecta.
2. **Filtro de alucinación determinista**: si una misma frase ocupa la mayor
   parte de la salida, no es una transcripción. Se descarta y se avisa que no
   se escuchó voz.

**Lo que falta:** que alguien dicte de verdad. Yo no pude hablarle al teléfono,
así que la calidad de la transcripción con voz real sigue sin medir. Es lo
primero que hay que hacer antes de grabar el video.

## Notas de diagnóstico que costaron tiempo hoy

- **El APK instalado no es debuggable**, así que `run-as` falla y todo lo que
  se consulte del sandbox de la app devuelve datos falsos (un listado de
  modelos vacío me hizo creer que whisper no estaba descargado). Si hace falta
  inspeccionar el sandbox, reinstalar un build debug.
- **Los bounds de los controles se mueven** cuando crece el campo de texto: el
  botón de dictado pasó de y=2041 a y=1900. Hay que leerlos del `uiautomator
  dump` en cada paso, nunca reusar una coordenada.
- **Una demora larga en el primer uso de un modelo es una DESCARGA**, no un
  cuelgue. Se confirma en el log de la app:
  `[QVACRegistryClient] Blob download complete`.

## (histórico) El extractor — el diagnóstico

**Síntoma:** el pipeline corre completo pero no produce ni un lote.

**Causa, ya diagnosticada** instrumentando la respuesta cruda del modelo:

```
toolCalls: []
texto: "<think>\nOkay, let me try to figure out how to approach this..."
```

**Qwen3 arranca en modo *thinking*.** Gasta el presupuesto de tokens razonando en prosa y nunca llega a emitir el tool call. El modelo entiende la nota perfectamente: su razonamiento identifica el hospital, los dos MR NovaMed de siete años y el CT HelixCare nuevo. No es un problema del pipeline, ni del prompt, ni de la declaración de la tool (el bug #4 ya estaba corregido: se declara como JSON-schema plano, no como Zod).

**Fix en verificación:** el SDK acepta `reasoning_budget` dentro de `generationParams`, junto a `temp`, `seed` y `predict` (ver `node_modules/@qvac/sdk/dist/schemas/completion-stream.d.ts`; el schema es `$strict`, así que solo entran esas claves). Con `reasoning_budget: 0` debería no razonar y emitir la llamada directo.

Si funciona, aplicarlo en **los dos** lados:
- `apps/server/src/qvac/gateway.ts:178` — `generationParams: { temp: 0, seed: 42, predict: ... }`
- el equivalente en el pipeline de `apps/mobile`

Y después volver a correr el end-to-end en el teléfono, que es lo que cierra el argumento del proyecto.

## Cómo levantar la app en el teléfono

```bash
cd apps/mobile
JAVA_HOME=/opt/homebrew/opt/openjdk@17 \
ANDROID_HOME=/Users/dev-hyper-rf/Library/Android/sdk \
npx expo run:android
```

`JAVA_HOME` hay que pasarlo siempre: el JDK quedó keg-only sin symlink al sistema.

Para ver la pantalla:
```bash
adb shell cmd statusbar collapse        # si no, la captura sale negra
adb exec-out screencap -p > /tmp/x.png
sips -Z 700 /tmp/x.png --out /tmp/xs.png
```

## Trampas que ya nos costaron tiempo (no repetirlas)

1. **`react-native-bare-kit` está pineado a `0.14.5` y NO se puede subir.** La 0.15.0 linkea `libbare-kit.so` contra `libnativehelper.so`, interno de la ART APEX y bloqueado para apps desde Android 10 — tumba el registro entero de TurboModules y RN muere con un error engañoso (`PlatformConstants could not be found`, que es colateral, no la causa). Es el issue upstream `holepunchto/react-native-bare-kit#48`, cerrado "not planned". Un `npm update` sin `--save-exact` reintroduce el crash.

2. **Después de cambiar dependencias nativas hay que correr `expo prebuild --clean`.** `expo run:android` NO vuelve a correr prebuild si `android/` ya existe, y el worker bundle de QVAC queda atado a la versión anterior → "Could not load bundle".

3. **`zObservacion.parse()` acepta `unknown`, así que el compilador no valida el literal que le pasás.** Cuando agregamos el campo `evidencia`, `tsc` siguió verde en las dos apps mientras en runtime *toda* observación habría fallado el parse y se habría descartado en silencio. Si construís una `Observacion`, tipá la variable explícito (`const x: Observacion = {...}`) antes de parsear.

4. **Nada de discrepancia en `modalidad` o `marca`.** `claveGrupo` las incluye, así que dentro de un grupo son idénticas por construcción y nunca pueden quedar en `Sin quórum`. Cualquier test o lógica que intente forzar conflicto por ahí está probando otra cosa. La discrepancia real vive en `cantidad`, `edad` y `modelo`. Esto ya causó que la corrección #11 fuera un no-op durante un tiempo.

6. **`node:crypto` no existe en React Native, y `tsc --noEmit` no te lo va a decir.** Cuatro archivos lo importaban (`core/ids.ts` y `context/spotlight.ts` con `randomBytes`; `pipeline/extractor.ts` y `audit/trace.ts` con `createHash`) y el typecheck estuvo verde todo el tiempo, porque `@types/node` está en el `tsconfig`. Metro sí falla, con `UnableToResolveError`, y la app **no arranca**: pantalla roja al abrir. Hoy se resuelve así — la aleatoriedad sale de `globalThis.crypto.getRandomValues` (Web Crypto, la única API que existe en Node y en Hermes) con el polyfill de `expo-crypto` instalado en `src/platform/webcrypto.ts`, y los hashes de `@noble/hashes` (JS puro, SHA-256 verificado idéntico al de `node:crypto`). **No vuelvas a importar un builtin de Node en `apps/mobile`, ni en los archivos compartidos.**

7. **Un `import` de ES module se hoistea: no podés poner código "antes" de un import.** El polyfill de Web Crypto escrito como bloque arriba de `import App from './App'` corre DESPUÉS de que App y todo su árbol se evaluaron. Si necesitás un efecto antes que otro módulo, ponelo en su propio archivo e importalo primero — los módulos sí se evalúan en el orden de los imports.

8. **La app corre edge-to-edge y `SafeAreaView` de React Native está deprecado.** Sin insets, la barra de estado del sistema se dibuja encima del título y las pestañas quedan bajo la barra de gestos. Se usa `react-native-safe-area-context@5.7.0` (la versión del SDK 57, no la última), con los insets aplicados a mano en cada barra: envolver todo en un `SafeAreaView` deja una franja del color del fondo detrás de la barra de estado.

9. **El typecheck verde no es evidencia de que la UI funcione.** Esta sesión dio dos bugs que solo aparecieron mirando la pantalla: un "Testigo B" sin "Testigo A" (la numeración se salteaba el lugar de "Vos"), y la fila `Edad` mostrando "13 · Quórum" en un parque de 4 equipos de 3 años y 2 de 13. Después de tocar render, mirá la pantalla.

10. **No pegues código fuente dentro de un prompt para un agente.** Los caracteres unicode invisibles (combinantes, zero-width) se corrompen en el traslado y terminan literales dentro de un regex. Pasó tres veces. Decile al agente que lea el archivo con la tool Read.

## Restricciones que no se negocian

Cero inferencia en la nube · nada de Vercel (ni `@qvac/ai-sdk-provider` ni el Vercel AI SDK) · nunca Web Speech API · `ignore-scripts=true` en los dos `.npmrc`, verificar cada paquete antes de instalar · marcas solo del vocabulario ficticio (NovaMed, Aurelia Health, BluePeak Medical, Orion Imaging, HelixCare, Zenith MedTech) · `core/contracts.ts` congelado, cambiarlo requiere replicar a las dos apps.

## Riesgos abiertos

- ~~Espacio en el Pixel 7~~ **resuelto**: se liberaron 18 GB y el extractor ya está descargado en el dispositivo. QVAC deja un **pico de disco de cerca del doble** durante la descarga: el modelo pasa por `files/.qvac/registry-corestore` antes de materializarse en `files/.qvac/models`. En reposo NO hay copia duplicada — medido en el Pixel, `models` son 1.4 GB y el corestore 7.1 MB (es una base RocksDB, no un segundo GGUF). Presupuestar el doble del tamaño del modelo para la descarga, y el tamaño real para el reposo. La tabla de `apps/mobile/CLAUDE.md` es de RAM, no sirve como presupuesto de disco.
- **La Mac se queda sin disco.** Tenía 209 MB libres y eso hacía fallar cualquier build (`No space left on device` al descomprimir el AAR de React Native) y probablemente enlentecía la inferencia por falta de swap. Se liberaron ~9 GB (artefactos de build, caché de Gradle y tres modelos que el proyecto no usa). Vigilarlo antes de cada build: `df -h /System/Volumes/Data`.
- **10 vulnerabilidades npm moderadas** en `apps/mobile`, todas transitivas de Expo (`uuid` vía `xcode` → `@expo/config-plugins`). Riesgo aceptado: es tooling de build de iOS y el proyecto es Android-only. Revisar si algún día se agrega iOS. `apps/server` tiene 0.
- **`aleatoriedadDebil()` no está visible en la UI.** Hoy devuelve `false` en el teléfono porque el polyfill está instalado, pero si ese import se reordena o se rompe, la app sigue corriendo con `Math.random()` sin avisar — y de ahí sale el delimitador anti-inyección de `context/spotlight.ts`. Falta un indicador, como el aviso de líneas corruptas que ya tiene Cliente 360.
- **Trabajo en paralelo en el repo.** Hoy hubo otra sesión commiteando: creó la rama `feat/apk-v0.1-timeout-dictado`, la mergeó a `main` por PR #1 y la borró, y esta sesión estuvo commiteando sobre esa rama sin notarlo. Nada se perdió, pero antes de empezar conviene `git fetch` y `git branch -vv` para saber en qué rama estás.
- **La paridad de los 10 archivos compartidos se rompió una vez hoy** y no se detectó hasta después de un merge: se endureció `policy/engine.ts` en el server y no se replicó, así que el móvil quedó con una política más débil. Correr el chequeo de paridad DESPUÉS de tocar cualquiera de los diez, no solo al arrancar la sesión.
- **La demo del ataque muestra `tool-fuera-de-allowlist`, no `intencion-originada-en-modelo`.** Es correcto — la allowlist del agente es la primera capa y ataja antes — pero si el guion del video cuenta la segunda razón, hay que ajustar el guion, no la política. Las dos capas están cubiertas por `test/policy.test.ts`.
- **Cliente 360 no tiene tests automáticos.** Importa React Native y no corre bajo el runner de Node del server. Su lógica pura (`app/testigos.ts`, el motor de quórum) sí está cubierta; el render está verificado a mano en el dispositivo.
- **Las métricas del pitch son hipótesis, no resultados.** No hay corrida sobre las 300 notas ciegas. Decir "esperamos", nunca "logramos".
- **Prioridad escritorio vs. móvil sigue sin decidir** (`ARCHITECTURE.md` §9). Hoy el móvil está más avanzado y ya demostró que el modelo corre en el teléfono, lo cual es el argumento más fuerte del proyecto.
