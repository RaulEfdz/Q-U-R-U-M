# Roadmap de interfaz — QUÓRUM

## Ahora: base consolidada

- Shell de workspace con sidebar persistente.
- Header contextual con conexión y usuario local.
- Captura y confirmación humana antes de persistir.
- Cliente 360 con estados de quórum y conflicto.
- Panorama con consulta determinista y export.
- Auditoría con cadena de integridad y origen de inferencia.

## Siguiente pase recomendado

### P0 — Confianza de uso

- Validación real de contraste en datos completos.
- Prueba de teclado, lector de pantalla y zoom 200%.
- Capturas visuales desktop/mobile contra `data/seed.json`.

### P1 — Lectura de procedencia

- Evidence rail por grupo.
- Comparación explícita de versiones en conflicto.
- Frescura visible cerca del nombre del cliente.

### P2 — Aceleración analítica

- Vistas guardadas y filtros con nombre.
- Atajos de teclado para navegación y captura.
- Acciones de exportación más visibles, con confirmación de alcance.

### P3 — Pulido expresivo

- Transición única de ascenso a quórum, respetando reduced motion.
- Empty states específicos por pantalla.
- Refactor de tokens duplicados y sidecar de componentes.

## Definition of done para cada nueva pantalla

- Tiene objetivo operativo explícito.
- No agrega claims ni datos inventados.
- Mantiene los dos ejes: confianza y frescura.
- Tiene estados loading, empty, error, disabled y success.
- Funciona con teclado y zoom.
- Usa tokens de `DESIGN.md`.
- No añade dependencia ni recurso externo.
- Se valida con `impeccable detect` y una captura con seed real.
