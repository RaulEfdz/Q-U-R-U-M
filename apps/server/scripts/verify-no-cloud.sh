#!/usr/bin/env bash
#
# verify-no-cloud.sh — prueba de cumplimiento de QUÓRUM. SIETE controles.
#
# Se corre EN VIVO durante el video (guion §IV.3, 3:25–4:15) y es lo que ISD
# verifica antes de pasar la entrega a Philips. Por eso importa tanto que no
# tenga falsos positivos como que no tenga falsos negativos:
#
#   ★ Regla de diseño de los greps: se buscan USOS, no MENCIONES.
#
# El bug conocido (corrección #2 de ../CLAUDE.md) era exactamente eso: el
# control nº4 hacía `grep -rniE 'philips|…' src` y se automatcheaba con
# `A_STATUS_PHILIPS` de `src/core/contracts.ts` — el mapeo al vocabulario de
# export de Philips, que TIENE que estar. Con `set -euo pipefail` el script
# salía 1 siempre, así que el control nunca sirvió para nada. Un control que
# se dispara con su propio código no es un control: se apaga o se ignora.
#
# La corrección no es "sacar philips del patrón" (eso abre el agujero real:
# una marca de verdad en los datos de la demo). Es distinguir:
#
#   - una MENCIÓN legítima  → identificador (`A_STATUS_PHILIPS`), ruta de
#     módulo (`../export/philips.ts`) o prosa en un comentario. No es un dato
#     y no llega a pantalla.
#   - un USO real           → un literal de cadena / valor JSON, un import,
#     una URL. Eso sí puede filtrar una marca real al dataset o a la UI.
#
# Implementación: los patrones piden contexto de cadena/llamada, `escanear()`
# descarta las líneas de comentario y cada control declara su allowlist de
# rutas de módulo. El control nº4 suma además una verificación POSITIVA con
# Node: toda `marca` de `data/` tiene que pertenecer a `MARCAS_DUMMY` de
# `src/core/contracts.ts` — una lista blanca no se puede burlar con una marca
# que no esté en la lista negra.
#
# Los controles nº2 (vercel) y nº3 (Web Speech API) tenían el mismo defecto
# latente: `grep -rniE 'vercel' src` se dispara con el comentario "prohibido
# el Vercel AI SDK" que la política de la organización obliga a escribir, y
# `'[^a-zA-Z]SpeechRecognition'` con cualquier comentario que la nombre para
# prohibirla. Van con el mismo tratamiento.
#
# Otros dos defectos corregidos:
#   - Carpeta ausente: `grep -r … src ui scripts` con `ui/` inexistente
#     devuelve 2. Bajo `if grep`, un 2 se lee igual que "no hubo match" → el
#     control pasaba en verde sin haber mirado nada. Ahora se filtran las
#     rutas existentes, se avisa de las ausentes y un exit ≥2 de grep es
#     FALLO del control, no un OK.
#   - `set -e`: el script ya no aborta en el primer control que falla. Corren
#     los siete, cada uno imprime OK o FALLO, y el exit code final es la suma.
#     En el video se quiere ver los siete, no el primero.
#
set -uo pipefail

YO="$(basename "${BASH_SOURCE[0]}")"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

FALLOS=0
ADVERTENCIAS=0

titulo() { printf '\n== %s ==\n' "$1"; }
ok()     { printf '   OK — %s\n' "$1"; }
fallo()  { printf '   FALLO — %s\n' "$1"; FALLOS=$((FALLOS + 1)); }
aviso()  { printf '   AVISO — %s\n' "$1"; ADVERTENCIAS=$((ADVERTENCIAS + 1)); }

# Comillas: simple, doble y template literal. Construidas así para que el
# backtick no se evalúe dentro de dobles.
Q='["'\''`]'
NQ='[^"'\''`]'

# Prefijo `archivo:linea:` + inicio de comentario (//, /*, *, #, <!--).
COMENTARIO='^[^:]*:[0-9]+:[[:space:]]*(//|/\*|\*|#|<!--)'

# ── Rutas: solo las que existen (ui/ y data/ pueden no estar todavía) ────────
OBJETIVOS=()
seleccionar() {
  OBJETIVOS=()
  local r
  for r in "$@"; do
    if [ -e "$r" ]; then
      OBJETIVOS+=("$r")
    else
      printf '   nota: %s no existe todavía, se omite de este control\n' "$r"
    fi
  done
}

# escanear <patron> <allowlist|""> <rutas...>
#   0 = limpio · 1 = hubo hallazgos (en RESULTADO) · 2 = grep falló
RESULTADO=""
escanear() {
  local patron="$1" permitido="$2"
  shift 2
  RESULTADO=""
  [ "$#" -eq 0 ] && return 0

  # `--exclude=$YO`: este script vive en `scripts/`, que es una de las rutas
  # escaneadas, y sus PATRONES contienen literalmente las cadenas prohibidas.
  # Sin la exclusión el verificador se denuncia a sí mismo — la misma clase de
  # bug que el `A_STATUS_PHILIPS` del control 4, encontrada al correrlo.
  local crudo rc
  crudo="$(grep -rIniE --exclude-dir=node_modules --exclude-dir=.git \
             --exclude-dir=tmp --exclude="$YO" -e "$patron" "$@" 2>&1)"
  rc=$?
  if [ "$rc" -gt 1 ]; then
    RESULTADO="$crudo"
    return 2
  fi

  local filtrado
  filtrado="$(printf '%s\n' "$crudo" | grep -vE "$COMENTARIO" || true)"
  if [ -n "$permitido" ]; then
    filtrado="$(printf '%s\n' "$filtrado" | grep -vE "$permitido" || true)"
  fi
  filtrado="$(printf '%s\n' "$filtrado" | grep -v '^[[:space:]]*$' || true)"

  RESULTADO="$filtrado"
  [ -z "$RESULTADO" ]
}

# control <nombre> <patron> <allowlist> <mensaje-ok> <mensaje-fallo> -- <rutas...>
control() {
  local nombre="$1" patron="$2" permitido="$3" msg_ok="$4" msg_fallo="$5"
  shift 5
  [ "${1:-}" = "--" ] && shift
  seleccionar "$@"
  # Ninguna ruta existente = el control no miró NADA. Eso no es un OK: es la
  # misma trampa que el exit 2 de grep con carpeta ausente, y sale como aviso.
  if [ "${#OBJETIVOS[@]}" -eq 0 ]; then
    aviso "$nombre: ninguna de las rutas existe todavía — no se verificó nada"
    return 0
  fi
  if escanear "$patron" "$permitido" ${OBJETIVOS[@]+"${OBJETIVOS[@]}"}; then
    ok "$msg_ok"
  else
    local rc=$?
    if [ "$rc" -eq 2 ]; then
      printf '%s\n' "$RESULTADO" | sed 's/^/     /'
      fallo "$nombre: el grep no pudo correr — el control NO se verificó"
    else
      printf '%s\n' "$RESULTADO" | sed 's/^/     /'
      fallo "$msg_fallo"
    fi
  fi
}

printf 'QUÓRUM · verify-no-cloud — 7 controles\n'
printf 'raíz: %s\n' "$RAIZ"

# ─────────────────────────────────────────────────────────────────────────────
titulo "1. Proveedores de inferencia cloud en el código"
control "control 1" \
  "(${Q}${NQ}{0,160})?(api\.openai|anthropic\.com|generativelanguage|openrouter|groq\.com|together\.(ai|xyz)|replicate\.com|api-inference\.huggingface|api\.cohere|api\.mistral|\.openai\.azure\.com|bedrock-runtime|api\.deepseek|api\.x\.ai)|${Q}(openai|@anthropic-ai/[a-z0-9-]+|@google/gen(erative-)?ai|groq-sdk|cohere-ai|replicate|together-ai|@mistralai/[a-z0-9-]+)${Q}" \
  "" \
  "ninguna referencia a inferencia en la nube." \
  "referencia a inferencia en la nube" \
  -- src ui scripts data package.json

# ─────────────────────────────────────────────────────────────────────────────
titulo "2. Vercel AI SDK y Vercel prohibidos por política de la organización"
# `vercel` en un comentario es la política escrita, no una dependencia: el
# patrón exige contexto de import / literal de cadena / dominio / clave de
# package.json. Cubre también el paquete `ai` y `@ai-sdk/*`, que ES el Vercel
# AI SDK con otro nombre, y `@qvac/ai-sdk-provider`, que lo arrastra.
control "control 2" \
  "${Q}${NQ}{0,160}(vercel|@qvac/ai-sdk-provider|@ai-sdk/)|vercel\.(app|com|json)|${Q}(ai|@vercel/[a-z0-9-]+)${Q}[[:space:]]*:" \
  "" \
  "ni Vercel ni el Vercel AI SDK. Se usa @qvac/sdk puro." \
  "dependencia o destino prohibido por política de la organización" \
  -- src ui scripts data package.json package-lock.json .npmrc

# ─────────────────────────────────────────────────────────────────────────────
titulo "3. Web Speech API prohibida (envía el audio a la nube)"
# Se busca el USO (constructor, acceso por window, llamada), no la mención:
# `ui/app.js` documenta por qué está prohibida y eso no puede hacer fallar.
control "control 3" \
  "new[[:space:]]+([A-Za-z_.\$]*\.)?(webkit)?SpeechRecognition|(window|globalThis|self)[[:space:]]*\.[[:space:]]*(webkit)?SpeechRecognition|(window|globalThis|self)\[${NQ}*SpeechRecognition|(^|[^A-Za-z0-9_.])(webkit)?SpeechRecognition[[:space:]]*\(|SpeechGrammarList" \
  "" \
  "la transcripción es whisper local vía QVAC." \
  "reconocimiento de voz del navegador (audio a la nube)" \
  -- src ui scripts

# ─────────────────────────────────────────────────────────────────────────────
titulo "4. Marcas reales (guardrail de datos del reto)"
# 4a · marcas de la competencia y modelos reales: sin excepciones, en ningún
#      contexto. Acá no hay identificador legítimo posible.
control "control 4a" \
  "siemens|ge[[:space:]_-]*health|general[[:space:]]*electric|canon[[:space:]]*medical|toshiba[[:space:]]*medical|hologic|fuji(film|[[:space:]]*medical)|mindray|esaote|shimadzu|samsung[[:space:]]*medison|carestream|agfa|dr(a|ä)ger|ingenia|achieva|azurion|affiniti|somatom|aquilion|lightspeed|incisive[[:space:]]*ct" \
  "" \
  "ninguna marca de la competencia." \
  "marca real de la competencia en el código o los datos" \
  -- src ui scripts data

# 4b · `philips` en los DATOS: estricto, sin allowlist y en cualquier
#      contexto. El dataset de la demo no tiene ninguna razón legítima para
#      nombrar la marca — si aparece ahí, se filtró al escenario.
control "control 4b" \
  "philips" \
  "" \
  "la marca no aparece en ningún archivo de data/." \
  "la marca real Philips aparece en los DATOS de la demo" \
  -- data

# 4c · `philips` en el CÓDIGO: solo como VALOR de cadena, y con allowlist de
#      las referencias legítimas. Philips es el cliente del reto y el destino
#      del export, así que nombrarlo es correcto en tres formas:
#        - identificador   → `A_STATUS_PHILIPS` (no lleva comillas: el patrón
#                            no lo mira, y ése era el bug #2 original)
#        - ruta de módulo  → `../export/philips.ts`
#        - el esquema/vocabulario de export, incluida su etiqueta en la UI
#          ("Exportar CSV (esquema Philips)")
#      Lo que NO se permite es la marca como valor de equipo (`marca:
#      'Philips'`, un modelo real), que es el riesgo que el control cuida.
control "control 4c" \
  "${Q}${NQ}{0,160}philips" \
  "(export/philips\.ts|(^|[/.])philips\.ts|(esquema|schema|vocabulario|formato|columnas|status|export|csv)${NQ}{0,40}philips|philips${NQ}{0,40}(schema|csv|export))" \
  "'philips' en el código aparece solo como identificador, ruta de módulo o esquema de export — nunca como marca de un equipo." \
  "la marca real Philips aparece como valor de cadena fuera del esquema de export" \
  -- src ui scripts

# 4d · verificación POSITIVA sobre los datos: toda `marca` de `data/` tiene
#      que estar en MARCAS_DUMMY. Una lista blanca no se burla con una marca
#      que no esté en la lista negra de 4a.
if [ -d data ]; then
  if node --experimental-strip-types --input-type=module -e '
    import { readdir, readFile } from "node:fs/promises";
    const { MARCAS_DUMMY } = await import("./src/core/contracts.ts");
    const permitidas = new Set(MARCAS_DUMMY);
    const malas = [];
    let revisados = 0;
    const visitar = (v) => {
      if (Array.isArray(v)) return v.forEach(visitar);
      if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) {
          if (k === "marca" && typeof x === "string") {
            revisados++;
            if (!permitidas.has(x)) malas.push(x);
          } else visitar(x);
        }
      }
    };
    for (const f of await readdir("data")) {
      if (!/\.(json|jsonl)$/.test(f)) continue;
      const txt = await readFile(`data/${f}`, "utf8");
      for (const linea of f.endsWith(".jsonl") ? txt.split("\n").filter(Boolean) : [txt]) {
        try { visitar(JSON.parse(linea)); } catch { }
      }
    }
    if (malas.length) {
      console.error("marcas fuera de MARCAS_DUMMY: " + [...new Set(malas)].join(", "));
      process.exit(1);
    }
    console.log(`${revisados} valores de marca, todos dentro de MARCAS_DUMMY`);
  ' 2>&1 | sed 's/^/     /'; then
    ok "las marcas de data/ están todas en el vocabulario ficticio."
  else
    fallo "hay marcas fuera de MARCAS_DUMMY en data/"
  fi
else
  printf '   nota: data/ no existe todavía, se omite 4d\n'
fi

# ─────────────────────────────────────────────────────────────────────────────
titulo "5. Dependencias con scripts de instalación"
# Antes era un `echo` informativo que nunca salía 1 — o sea, no era un
# control. Ahora falla: cualquier paquete con `hasInstallScript` que no esté
# en la allowlist revisada es un FALLO (vector de Shai-Hulud / node-gyp).
PERMITIDOS_INSTALL=""   # revisados a mano; hoy vacío a propósito
if [ -f package-lock.json ]; then
  if node -e '
    const l = require("./package-lock.json");
    const permitidos = new Set((process.env.PERMITIDOS_INSTALL || "").split(",").filter(Boolean));
    const s = Object.entries(l.packages || {})
      .filter(([, v]) => v.hasInstallScript)
      .map(([k]) => k)
      .filter((k) => !permitidos.has(k));
    if (s.length) { console.error("con script de instalación: " + s.join(", ")); process.exit(1); }
    console.log("ninguna dependencia declara hasInstallScript");
  ' 2>&1 | sed 's/^/     /'; then
    ok "ninguna dependencia ejecuta código en npm install."
  else
    fallo "hay dependencias con script de instalación sin revisar"
  fi
else
  fallo "no hay package-lock.json: el árbol de dependencias no está anclado"
fi

if grep -qE '^[[:space:]]*ignore-scripts[[:space:]]*=[[:space:]]*true' .npmrc 2>/dev/null; then
  ok ".npmrc mantiene ignore-scripts=true."
else
  fallo ".npmrc sin ignore-scripts=true (el control central de supply chain)"
fi

# ─────────────────────────────────────────────────────────────────────────────
titulo "6. npm audit (--audit-level=high)"
SALIDA_AUDIT="$(npm audit --audit-level=high 2>&1)"
RC_AUDIT=$?
printf '%s\n' "$SALIDA_AUDIT" | sed 's/^/     /'
if [ "$RC_AUDIT" -eq 0 ]; then
  ok "sin vulnerabilidades high ni critical."
elif printf '%s' "$SALIDA_AUDIT" | grep -qiE 'ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network|offline|registry.*(unreachable|failed)'; then
  # La demo se graba con el WiFi apagado: npm audit necesita el registro.
  # Sin red el control no se puede EJECUTAR — eso es un aviso, no un pase.
  aviso "npm audit no pudo consultar el registro (sin red). Correrlo con red antes de la entrega."
else
  fallo "npm audit reporta vulnerabilidades high/critical"
fi

# ─────────────────────────────────────────────────────────────────────────────
titulo "7. Egress: ningún destino de red fuera de localhost"
# El nº7 era un `echo` manual — no era un control. La instrucción manual se
# mantiene abajo como nota, pero el control ahora se automatiza: en el código
# no puede haber ninguna URL absoluta que no apunte a la máquina local. El
# sync P2P va por Hyperswarm (DHT, sin URL) y está declarado en el README.
# Allowlist: localhost en todas sus formas (incluida la interpolada
# `http://${HOST}`) y `w3.org`, que en `ui/index.html` es el NAMESPACE XML de
# un SVG inline — un identificador que ningún navegador dereferencia, no un
# destino de red.
control "control 7" \
  "https?://" \
  "https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\\\$\{|\\\$[A-Za-z_])|https?://(www\.)?w3\.org/" \
  "no hay URLs de red fuera de localhost." \
  "URL absoluta a un host externo (posible egress)" \
  -- src ui scripts data

printf '\n   nota manual (no cuenta como control): apagá el WiFi y corré '\''npm start'\''.\n'
printf '   Captura y proyección deben seguir funcionando. El sync P2P no: es lo\n'
printf '   esperado y está declarado en el README.\n'

# ─────────────────────────────────────────────────────────────────────────────
printf '\n────────────────────────────────────────\n'
if [ "$FALLOS" -eq 0 ]; then
  printf 'RESULTADO: 7/7 controles en verde'
  [ "$ADVERTENCIAS" -gt 0 ] && printf ' (%s aviso(s))' "$ADVERTENCIAS"
  printf '\n'
  exit 0
fi
printf 'RESULTADO: %s control(es) en FALLO' "$FALLOS"
[ "$ADVERTENCIAS" -gt 0 ] && printf ' · %s aviso(s)' "$ADVERTENCIAS"
printf '\n'
exit 1
