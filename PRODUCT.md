# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Nota: el producto tiene **dos superficies**. La registrada arriba es la UI de escritorio
(`apps/server/ui/`, HTML/CSS/JS servido en 127.0.0.1). La segunda es una app **Android
nativa** (`apps/mobile/`, Expo + React Native, Android 12+, solo dispositivo físico), que
no es un envoltorio de la web: tiene su propio lenguaje de interacción y sus propios
componentes. Trabajo que toque `apps/mobile/` debe tratarse como Android nativo.

## Stack

Existente, no delegado. `apps/server`: TypeScript sobre Node ≥22.17 corriendo con
`--experimental-strip-types`, `node:http` de la librería estándar, y la UI en HTML + CSS +
ES modules nativos, sin framework y sin paso de build. `apps/mobile`: Expo ≥54 / React
Native 0.86, TypeScript estricto. Inferencia con `@qvac/sdk` (llama.cpp + whisper.cpp
on-device). Total de dependencias de producción, deliberadamente auditables en un minuto.

## Users

Dos personas, un mismo dato.

**El colaborador de campo.** Visita hospitales y clínicas. Usa la app de pie, con una mano,
a veces con guantes, con poca luz o sol directo, entre una consulta y la siguiente. No está
sentado frente a un formulario: acaba de ver tres resonadores y quiere dejar constancia
antes de que se le olvide. Su trabajo es *capturar*, y capturar tiene que tomar segundos, no
minutos. El modo de falla real de este producto no es un dato incorrecto: es un dato que
nunca se registró porque la herramienta pidió demasiado.

**El analista de base instalada.** Trabaja sentado, en escritorio, sobre lo que otros
capturaron. Su pregunta no es "¿qué hay?" sino "¿cuánto puedo confiar en esto?". Necesita
ver de dónde viene cada valor, quién lo sostiene y qué tan viejo es, antes de llevárselo a
alguien que va a decidir una compra con eso.

## Product Purpose

QUÓRUM convierte testimonios de campo en una base instalada con **confianza medible por
campo**.

Un colaborador dicta o escribe lo que vio; el sistema extrae el equipo médico (modalidad,
marca, modelo, edad, cantidad) corriendo modelos enteramente en el dispositivo, y reconcilia
múltiples testimonios en un *quórum*: una verdad que exige corroboración, no un solo
reporte.

Éxito es que un analista mire una fila y sepa, sin preguntar, si puede apoyarse en ella.

## Positioning

Extraer entidades con un modelo local y tool calling es la parte fácil del problema. Lo que
un producto vecino no podría copiar sin rehacer su modelo de datos es **qué hace QUÓRUM
cuando dos personas se contradicen**: no promedia, no elige, no esconde el conflicto.
Muestra las dos versiones con quién sostiene cada una y declara que hace falta una visita
más.

De ahí salen dos ejes de confianza que viven en los contratos, no en la presentación:
**naturaleza** del testimonio (`Directo` / `Referido` / `Estimado` / `Desconocido`, por
observación) y **quórum** (`Sin datos` → `Estimado` → `Reportado` → `Quórum`, o
`Sin quórum` si discrepan, por campo). Un campo llega a `Quórum` solo con dos testimonios
directos y no dudados de observadores distintos.

El segundo diferenciador es de cumplimiento: **cero inferencia en la nube**, verificable en
vivo. No es una promesa de marketing, es un requisito del reto que un tercero comprueba
antes de pasar la entrega al cliente final.

## Operating Context

- **Captura en movimiento**, en sitio del cliente, con el teléfono en una mano.
- **Revisión en escritorio**, sobre la base reconciliada de todos los observadores.
- **Sin red por diseño**: la inferencia no necesita conexión. El sync P2P entre pares sí, y
  su ausencia es un estado esperado y declarado, no un error.
- **Contexto de evaluación**: el producto se presenta en un video de ≤5 minutos y se ejecuta
  en la laptop de un jurado. La interfaz tiene que sobrevivir a la compresión de video y a
  un proyector mal calibrado.
- Vocabulario de marcas **ficticio y obligatorio**: NovaMed, Aurelia Health, BluePeak
  Medical, Orion Imaging, HelixCare, Zenith MedTech. Ninguna marca real puede aparecer, y
  hay un control automatizado que lo verifica.

## Capabilities and Constraints

**Confirmado y funcionando**

- Pipeline de tres modelos on-device: precheck determinista → portero → extractor con cita
  literal obligatoria → verificador de evidencia determinista.
- Motor de reconciliación con siete reglas duras (RD-0..RD-7), puntaje por completitud,
  frescura y corroboración independiente, y cohortes de edad.
- App Android: pantallas Capturar, confirmación editable del borrador y Cliente 360,
  verificada en un Pixel 7.
- Servidor local con nueve rutas, y las cuatro pantallas de escritorio (Capturar, Cliente
  360, Panorama, Auditoría).
- Cadena de hashes de auditoría con verificación de integridad.
- Export CSV al esquema de 19 columnas del cliente.

**Restricciones duras, no negociables**

- **Cero inferencia en la nube.** Ningún proveedor externo. Requisito del reto.
- **Nada de Vercel** (deploy, preview, CI/CD) ni del Vercel AI SDK — política de la
  organización, no solo del reto.
- **Web Speech API prohibida**: manda audio a un servidor del proveedor. La transcripción es
  whisper local.
- **Cero dependencias nuevas y ningún recurso externo** en la UI. Sin framework, sin
  Tailwind, sin componentes prefabricados, sin CDN de iconos ni de fuentes.
- **Nada se persiste sin confirmación humana.** Todo lo extraído por un modelo es borrador
  hasta que el usuario confirma.
- `core/contracts.ts` está congelado, y diez archivos del núcleo son idénticos byte a byte
  entre las dos apps: cualquier cambio ahí se replica a ambos lados.

**Explícitamente sin decidir**

- La prioridad estratégica escritorio-vs-móvil. Hoy el móvil está más avanzado y ya demostró
  lo que más pesa (el modelo corriendo en un teléfono real), pero la decisión no se tomó.

## Brand Commitments

- Nombre: **QUÓRUM**. Tesis: *"La verdad tiene quórum."*
- Voz en **castellano rioplatense**, segunda persona informal (`vos`). Los textos explican la
  *razón*, no solo el estado: no "Sin quórum", sino "No se promedia. Cada versión con quién
  la dijo".
- Dice **"esperamos", nunca "logramos"**: las métricas del pitch son hipótesis, no
  resultados, y la interfaz y la documentación tienen que reflejarlo.
- No hay archivo de logo. La identidad se apoya en el glifo `●`, que es el mismo que marca
  `Quórum` en el eje de corroboración.
- Restricciones visuales que el usuario hizo binding (2026-09-10): **tema claro de alto
  contraste** en las dos superficies, e **iconografía SVG propia dibujada a medida** — nunca
  una librería externa. Los cinco glifos de estado (`● ◐ ○ · ▲`) se conservan como
  portadores de significado.

## Evidence on Hand

- **Real y verificado**: el modelo corriendo on-device en un Pixel 7; Cliente 360 con datos
  reconciliados en el dispositivo; 31 tests en verde; `verify-no-cloud.sh` con siete
  controles en verde, probado también con prueba negativa; `data/seed.json` con 23
  observaciones válidas que producen los cuatro estados de quórum.
- **Existe pero no está probado de punta a punta**: el pipeline completo de tres modelos en
  el teléfono, bloqueado hoy por espacio en el dispositivo. La UI de escritorio se verificó
  contra un servidor mock, no contra QVAC real.
- **No existe, y no se puede insinuar que exista**: cualquier corrida sobre las 300 notas
  ciegas. Las cifras de precisión que circulan en el documento son hipótesis. No inventar
  benchmarks, clientes, testimonios ni resultados de evaluación.

## Product Principles

**1. El LLM entiende. El código decide. El humano confirma.**
Principio rector del producto y también de la interfaz. Los campos extraídos se presentan
como *confirmación*, nunca como formulario a rellenar.

**2. El conflicto no es un error.**
`Sin quórum` es un estado válido y esperado, no una falla que haya que ocultar ni resolver a
la fuerza. Se muestra completo, siempre visible y con atribución.

**3. La ausencia se declara, no se calla.**
`Sin datos` es una respuesta legítima. Una línea de datos que se perdió deja constancia. Un
dato viejo se avisa. Una garantía degradada se expone en vez de taparse.

**4. Confianza y frescura son preguntas distintas.**
Un dato con quórum puede estar viejo. Tratarlos como un solo eje es el error más fácil de
cometer en este producto.

**5. Densidad alta, ornamento cero.**
Es una herramienta de trabajo usada en un momento de trabajo. Nadie la usa por gusto.

## Accessibility & Inclusion

- **Contraste real, no elegante.** Texto de cuerpo ≥4.5:1. El móvil se usa a sol directo: el
  gris tenue está deliberadamente oscuro, nunca `#999` o más claro.
- **El color no es nunca el único canal de significado**: cada estado lleva glifo y etiqueta.
  Cubre daltonismo y también video comprimido.
- **Objetivos táctiles grandes** en Android: 52px normal, 64px para la acción primaria — se
  toca de pie, con una mano, a veces con guantes.
- **Una sola animación** en todo el producto (el ascenso a quórum, 600 ms), con alternativa
  bajo `prefers-reduced-motion`.
