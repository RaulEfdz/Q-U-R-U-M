#!/bin/bash
# grabar-celular.sh — helpers para grabar la pantalla del Pixel 7 con
# `adb shell screenrecord` (nativo de Android, nada que instalar).
#
# A diferencia de grabar-bloques.sh (escritorio), acá NO hace falta aislar
# ventanas: screenrecord solo ve la pantalla del teléfono, nunca el resto
# del escritorio de la máquina de desarrollo. Probado: 5s de la app
# QUÓRUM abierta en Capturar salieron limpios, sin nada ajeno en cuadro.
#
# Límite real de screenrecord: máximo 3 minutos por archivo (limitación de
# Android, no de este script) y sin audio del micrófono del teléfono — si
# el bloque incluye narración hablada, se graba aparte y se mezcla en
# edición, igual que con las tomas humanas del escritorio.
#
# Uso:
#   source docs/video/grabar-celular.sh
#   grabar_celular <nombre-bloque> <segundos>
#   # ... actuás/dictás en el teléfono mientras corre ...
#   # (la función ya espera sola y baja el archivo al terminar)

set -uo pipefail
DIR_SALIDA="docs/video/tomas"
mkdir -p "$DIR_SALIDA"
RUTA_DISPOSITIVO="/sdcard/quorum-toma-tmp.mp4"

# Confirma que hay exactamente un dispositivo físico conectado — screenrecord
# con más de uno conectado y sin -s falla o graba el que no querías.
verificar_dispositivo() {
  local n
  n=$(adb devices | grep -c "	device$")
  if [ "$n" -eq 0 ]; then
    echo "⚠️  Ningún dispositivo conectado. adb devices:"
    adb devices
    return 1
  fi
  if [ "$n" -gt 1 ]; then
    echo "⚠️  Hay $n dispositivos conectados — especificá con -s <serial> a mano."
    adb devices
    return 1
  fi
  echo "✓ Un solo dispositivo conectado: $(adb devices | grep device$ | cut -f1)"
}

# grabar_celular <nombre> <segundos> — graba, baja el archivo a
# docs/video/tomas/<nombre>.mp4 y limpia el temporal del teléfono.
# BLOQUEANTE: no vuelve hasta terminar los <segundos> — actuá/dictá en el
# teléfono DESPUÉS de lanzar el comando (screenrecord ya está grabando desde
# el instante en que arranca, no hay cuenta regresiva).
grabar_celular() {
  local nombre="$1"
  local segundos="${2:-30}"
  if [ "$segundos" -gt 180 ]; then
    echo "⚠️  screenrecord corta solo a los 3 minutos (límite de Android). Pedido: ${segundos}s."
    return 1
  fi
  verificar_dispositivo || return 1
  echo "● Grabando ${segundos}s → $nombre.mp4 (empezá a actuar/dictar YA)"
  adb shell screenrecord --time-limit "$segundos" "$RUTA_DISPOSITIVO"
  echo "  Grabación terminada, bajando archivo…"
  adb pull "$RUTA_DISPOSITIVO" "$DIR_SALIDA/${nombre}.mp4"
  adb shell rm "$RUTA_DISPOSITIVO"
  local duracion
  duracion=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$DIR_SALIDA/${nombre}.mp4" 2>/dev/null)
  echo "✓ $DIR_SALIDA/${nombre}.mp4 — $(du -h "$DIR_SALIDA/${nombre}.mp4" | cut -f1), ${duracion:-?}s"
}

echo "grabar-celular.sh cargado. Funciones: verificar_dispositivo, grabar_celular <nombre> <segundos>"
