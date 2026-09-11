#!/bin/bash
# grabar-bloques.sh — helpers para grabar los bloques de navegación pura
# (sin voz humana) del guion de GUION_VIDEO.md, con screencapture nativo de
# macOS. Diseñado para correrse a mano, función por función, NO de punta a
# punta: cada bloque necesita revisar el resultado antes de seguir al
# siguiente.
#
# Requisitos: la app QUÓRUM corriendo en http://127.0.0.1:3000, y el browser
# de Orca ya abierto sobre esa URL (visible en pantalla — se graba el
# display completo, no una región recortada: más simple y robusto que medir
# bordes de ventana, se recorta en edición si hace falta).
#
# Uso: source este archivo desde bash, después llamar a las funciones.
#   source docs/video/grabar-bloques.sh
#   iniciar bloque2
#   ... (acá corrés los comandos `orca` del bloque a mano) ...
#   detener

set -uo pipefail
DIR_SALIDA="docs/video/tomas"
mkdir -p "$DIR_SALIDA"
PID_GRABACION=""
ARCHIVO_ACTUAL=""

# Chequeo obligatorio antes de arrancar cualquier bloque: un screencapture
# huérfano de una corrida anterior deja el nuevo archivo sin escribirse bien.
verificar_sin_huerfanos() {
  local huerfanos
  huerfanos=$(ps aux | grep screencapture | grep -v grep || true)
  if [ -n "$huerfanos" ]; then
    echo "⚠️  Hay un screencapture corriendo de antes. Matalo primero:"
    echo "$huerfanos"
    return 1
  fi
  echo "✓ Sin screencapture huérfano."
}

# iniciar <nombre-bloque> — arranca la grabación. Antes de llamarla, dejá la
# app en la pantalla/estado desde el que arranca ESE bloque (recargada, nav
# correcto). El archivo se borra si ya existía (screencapture no sobrescribe
# y falla en silencio si el destino ya existe).
iniciar() {
  local nombre="$1"
  ARCHIVO_ACTUAL="$DIR_SALIDA/${nombre}.mov"
  rm -f "$ARCHIVO_ACTUAL"
  verificar_sin_huerfanos || return 1
  # -v: video · -k: muestra clicks · -C: cursor · -D1: display principal
  # completo (evita medir región de la ventana de Orca a mano).
  screencapture -v -k -C -D1 "$ARCHIVO_ACTUAL" &
  PID_GRABACION=$!
  echo "● Grabando '$nombre' (PID $PID_GRABACION) → $ARCHIVO_ACTUAL"
  echo "  Corré ahora los pasos de navegación de este bloque, con pausas de"
  echo "  ~1-2s entre acciones (2s+ después de cualquier click que dispare"
  echo "  una interpretación/guardado, para no perder el frame de transición)."
}

# detener — para la grabación en curso con SIGINT (nunca -9, corrompe el
# .mov) y verifica que el archivo quedó con contenido real.
detener() {
  if [ -z "$PID_GRABACION" ]; then
    echo "No hay grabación en curso (¿ya se detuvo?)."
    return 1
  fi
  kill -INT "$PID_GRABACION" 2>/dev/null
  echo "Deteniendo (PID $PID_GRABACION)…"
  sleep 2
  if [ ! -s "$ARCHIVO_ACTUAL" ]; then
    echo "⚠️  El archivo quedó vacío o no se creó: $ARCHIVO_ACTUAL"
    return 1
  fi
  local duracion
  duracion=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$ARCHIVO_ACTUAL" 2>/dev/null)
  echo "✓ $ARCHIVO_ACTUAL — $(du -h "$ARCHIVO_ACTUAL" | cut -f1), ${duracion}s"
  PID_GRABACION=""
}

echo "grabar-bloques.sh cargado. Funciones: verificar_sin_huerfanos, iniciar <nombre>, detener"
