# Storyboard — 3 capas por bloque

> Basado en `docs/GUION_VIDEO.md` (7 bloques, 5:00). Cada segmento del guion
> se resuelve con UNA de tres herramientas, nunca mezcladas dentro de un
> mismo clip:
>
> - **HUMANO** — cámara real, nadie más lo puede grabar por vos.
> - **PANTALLA** — captura de la app real, corriendo. Herramienta:
>   `docs/video/grabar-bloques.sh` (escritorio) o `grabar-celular.sh` (mobile).
> - **GRÁFICO** — tipografía cinética / diagrama animado en HTML, sin foto
>   real de por medio (nada que fotografiar: es texto y forma). Herramienta:
>   skill `video-promo-cinematografico`, `templates/timeline.html` adaptado
>   a la paleta de QUÓRUM (ver `docs/video/graficos/`).
>
> Estilo de referencia (OpenAI, "Introducing the Agents API"): cortes
> rápidos entre estas tres capas, paleta mínima, texto en pantalla solo
> para términos clave — nunca las tres a la vez en un mismo plano.

| Bloque | Tiempo | Capa | Detalle | Herramienta |
|---|---|---|---|---|
| 1 · El problema | 0:00–0:25 | **GRÁFICO** (opción elegida) o HUMANO | El guion da a elegir "texto sobrio" o "toma del ingeniero". Sin actor/locación, texto sobrio = tipografía cinética, encaja con "no nombrar el producto todavía". | `graficos/intro-cierre.html`, escena 1 |
| 2 · La tesis | 0:25–0:45 | **PANTALLA** | Pantalla de Capturar, quieta, chip de modelo visible. | `grabar-bloques.sh` → `iniciar bloque2` |
| 3 · Captura on-device | 0:45–1:40 | **HUMANO + PANTALLA** | La VOZ y el click son humanos en vivo (dictado real); lo que queda en cuadro es la pantalla reaccionando. Se graba como una sola toma de pantalla con audio del narrador en simultáneo, no se separan. | `grabar-bloques.sh` (pantalla) + mic real (audio) al mismo tiempo |
| 4 · ★ El quórum | 1:40–2:45 | **PANTALLA** | Cliente 360: tabla de confianza, conflicto, cohortes, puntaje. Bloque de más peso — no se recorta. | `grabar-bloques.sh` → `iniciar bloque4` |
| 5 · El ataque bloqueado | 2:45–3:25 | **HUMANO + PANTALLA** | Igual que el bloque 3: escribir la pregunta es acción en vivo, no hay forma de scriptearlo sin perder autenticidad (el modelo no es determinista). | `grabar-bloques.sh` (pantalla) + narración en vivo |
| 6a · Cumplimiento (terminal) | 3:25–~3:50 | **PANTALLA** | `verify-no-cloud.sh` corriendo, resultado en cámara. | `grabar-bloques.sh` → `iniciar bloque6-terminal` (apunta a la ventana de Terminal, no al navegador) |
| 6b · Apagar WiFi | ~3:50–4:15 | **HUMANO** | Acción física real (apagar WiFi) + dictado nuevo de punta a punta. No automatizable por definición. | Cámara real |
| 7 · Adopción/impacto | 4:15–5:00 | **PANTALLA** | Inteligencia, Cliente 360 con oportunidad, exportar CSV. | `grabar-bloques.sh` → `iniciar bloque7` |
| Cierre | ~5:00 | **GRÁFICO** o HUMANO | Línea final a cámara. Si no hay toma de cámara disponible, tipografía cinética con la frase de cierre — mismo tratamiento que la apertura, para que abran y cierren con el mismo lenguaje visual. | `graficos/intro-cierre.html`, escena 2 |

## Por qué el bloque 3 y 5 NO se separan en "pantalla" + "gráfico superpuesto"

El estilo de referencia mezcla capas **entre planos** (un corte a cámara, un
corte a pantalla, un corte a gráfico), no **dentro de un mismo plano** — no
hay picture-in-picture de la cara del narrador flotando sobre la pantalla.
Mantenerlo así es más simple de grabar (una sola fuente por clip) y evita
que un video "casero" con overlays mal alineados reste seriedad al pitch.

## Carpeta resultante

```
docs/video/
├── grabar-bloques.sh       # ya existe — pantalla escritorio
├── grabar-celular.sh       # ya existe — pantalla mobile
├── STORYBOARD.md           # este archivo
├── graficos/
│   └── intro-cierre.html   # las dos escenas de tipografía cinética
└── tomas/                  # .mov/.mp4 de cada bloque grabado (vacía hasta grabar)
```

## Armado final

1. Grabar cada capa por separado (pantalla con los scripts, humano con
   cámara, gráfico con el HTML + `screencapture`, ver receta abajo).
2. Concatenar en orden con `ffmpeg -f concat` (ver `GUION_VIDEO.md`,
   sección "Herramientas de grabación").
3. Narración/voz: si se graba la voz junto con la pantalla en los bloques
   3 y 5, no hace falta voiceover aparte ahí. Para los bloques de puro
   PANTALLA (2, 4, 6a, 7) sin voz propia, agregar narración después con la
   skill `flow-voiceover-video` si se decide usar voz en off en vez de que
   el presentador hable en cámara en esos tramos.

## Cómo grabar una escena GRÁFICO (`intro-cierre.html`)

1. Abrir `graficos/intro-cierre.html` en un browser a 1920×1080 (ventana o
   `--kiosk`, ver `references/pipeline.md` de la skill `video-promo-cinematografico`
   para el detalle de Chrome kiosk + display).
2. Identificar un display a 1920×1080 @1x con `screencapture -D <n>` — el
   Retina interno da otra resolución y hay que escalar en post si se usa.
3. `screencapture -v -D <n> docs/video/tomas/intro.mov &`, esperar ~1s,
   disparar el timeline (tecla o click — el HTML ya expone `window.__begin`),
   dejar correr hasta el final de la última escena, `kill -INT`.
