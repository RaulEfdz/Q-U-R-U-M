# Para retomar — QUÓRUM

> Escrito 2026-09-10 ~03:00. Último commit pusheado: `0ff9c57`.
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
- `apps/mobile`: pipeline completo (precheck → portero → extractor → verificador → cruzar), pool de modelos, store, y las pantallas Capturar + confirmación editable del borrador.
- `apps/server`: Fases 1-7 (contratos, trust, QVAC, policy+PEP, tools, store, sync).
- 31 tests, todos verdes.

## Qué falta

| Qué | Dónde | Notas |
|---|---|---|
| **Cliente 360** | `apps/mobile/src/app/` | Lo más importante que queda de UI. La vista de reconciliación: los dos ejes de confianza, y `Sin quórum` mostrando ambas versiones con quién dijo cada una, nunca un promedio. |
| Probar la UI en el teléfono | — | `CapturarScreen` y `ConfirmacionBorrador` compilan pero **nunca se vieron corriendo en el Pixel**. Primera tarea: levantarla y sacar screenshots. |
| **Audio** | `apps/mobile` | Fase 10. `expo-audio`, NUNCA `expo-av` (removido en SDK 54). |
| `server/index.ts` | `apps/server` | Fase 8, la última grande del server. |
| UI escritorio | `apps/server/ui/` | Fase 9 del server. |
| `scripts/verify-no-cloud.sh` | `apps/server` | Tiene el bug #2 (el grep se automatchea con `A_STATUS_PHILIPS` y el script siempre sale 1). Se corre en vivo en el video. |
| `data/seed.json` | `apps/server` | Los tres escenarios de demo. |

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

5. **No pegues código fuente dentro de un prompt para un agente.** Los caracteres unicode invisibles (combinantes, zero-width) se corrompen en el traslado y terminan literales dentro de un regex. Pasó tres veces. Decile al agente que lea el archivo con la tool Read.

## Restricciones que no se negocian

Cero inferencia en la nube · nada de Vercel (ni `@qvac/ai-sdk-provider` ni el Vercel AI SDK) · nunca Web Speech API · `ignore-scripts=true` en los dos `.npmrc`, verificar cada paquete antes de instalar · marcas solo del vocabulario ficticio (NovaMed, Aurelia Health, BluePeak Medical, Orion Imaging, HelixCare, Zenith MedTech) · `core/contracts.ts` congelado, cambiarlo requiere replicar a las dos apps.

## Riesgos abiertos

- **Espacio en el Pixel 7**: quedaban ~2.4 GB. El portero (533 MB) ya está, pero el extractor (1 GB) y whisper (78 MB) todavía no se descargaron. Va a quedar muy justo.
- **10 vulnerabilidades npm moderadas** en `apps/mobile`, todas transitivas de Expo (`uuid` vía `xcode` → `@expo/config-plugins`). Riesgo aceptado: es tooling de build de iOS y el proyecto es Android-only. Revisar si algún día se agrega iOS. `apps/server` tiene 0.
- **Las métricas del pitch son hipótesis, no resultados.** No hay corrida sobre las 300 notas ciegas. Decir "esperamos", nunca "logramos".
- **Prioridad escritorio vs. móvil sigue sin decidir** (`ARCHITECTURE.md` §9). Hoy el móvil está más avanzado y ya demostró que el modelo corre en el teléfono, lo cual es el argumento más fuerte del proyecto.
