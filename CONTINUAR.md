# Para retomar — QUÓRUM

> Escrito 2026-09-10 ~12:30. Último commit pusheado: `c728968`. Versión: **v0.4.0**.
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

## Qué falta

| Qué | Dónde | Notas |
|---|---|---|
| **★ EL EXTRACTOR NO EXTRAE** | las dos apps | **El bloqueante del proyecto.** Ya está diagnosticado, ver §El extractor abajo. Sin esto no hay captura ni consulta: el server responde "El modelo no produjo una extracción utilizable" y el teléfono muestra "Sin equipo estructurado". |
| Probar la UI de escritorio contra QVAC real | `apps/server/ui/` | Las cuatro pantallas se recorrieron con datos del seed, pero `/api/transcribir` y `/api/observar` con los modelos cargados no tienen evidencia. Depende del extractor. |
| **Build de release de mobile** | `apps/mobile` | Nunca se probó. Hoy corre en debug con el JS servido por Metro: si se apaga el WiFi y la app se reinicia, NO arranca — y no por la nube, sino porque no encuentra el bundle. La demo con WiFi apagado lo necesita: `expo run:android --variant release`. |
| **Audio** | `apps/mobile` | Fase 11. `expo-audio`, NUNCA `expo-av` (removido en SDK 54). |
| Medir tiempos reales de inferencia | las dos | En la Mac, cargar el extractor y responder tardó del orden de quince minutos. Hay que medirlo en el teléfono antes de grabar, y decidir si la demo se graba sobre móvil o escritorio. |

## ★ El extractor — dónde quedó

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
- **Cliente 360 no tiene tests automáticos.** Importa React Native y no corre bajo el runner de Node del server. Su lógica pura (`app/testigos.ts`, el motor de quórum) sí está cubierta; el render está verificado a mano en el dispositivo.
- **Las métricas del pitch son hipótesis, no resultados.** No hay corrida sobre las 300 notas ciegas. Decir "esperamos", nunca "logramos".
- **Prioridad escritorio vs. móvil sigue sin decidir** (`ARCHITECTURE.md` §9). Hoy el móvil está más avanzado y ya demostró que el modelo corre en el teléfono, lo cual es el argumento más fuerte del proyecto.
