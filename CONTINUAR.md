# Para retomar — QUÓRUM

Estado comprobado el **2026-09-11**. La lista de cierre para el reto está en [`docs/FALTANTES_PARA_DEMO.md`](docs/FALTANTES_PARA_DEMO.md).

## Estado actual

- `rf/dev`: `03bea9e`, sincronizada con `origin/rf/dev` al iniciar esta actualización documental.
- `main`: merge `5fa8325`, sincronizada con `origin/main` al iniciar esta actualización documental.
- Servidor: typecheck, **117/117 tests** y `verify:no-cloud` **7/7**.
- Mobile: typecheck y **17/17 tests**.
- Pixel 7 ↔ servidor: Hyperswarm conectado y `hello_ack` real en **83 ms**.
- APK instalada: debug; el build release continúa pendiente.
- No hay video final ni URL verificada dentro del repositorio.
- El repositorio remoto aparece privado; hay que garantizar acceso al jurado.

## Arrancá por acá

```bash
cd /Users/dev-hyper-rf/Documents/PROYECTOS/RF/HACK/focus/proyectos/QURUM

cd apps/server
npm run test:ci

cd ../mobile
npm run typecheck
npm test
```

No leas un exit code a través de un pipe: el código observado sería el del último comando del pipe, no necesariamente el del typecheck o test.

## Verificar el núcleo compartido

```bash
cd /Users/dev-hyper-rf/Documents/PROYECTOS/RF/HACK/focus/proyectos/QURUM
for f in core/contracts.ts core/ids.ts trust/normalize.ts trust/similarity.ts \
         trust/entity.ts trust/reconcile.ts trust/score.ts policy/engine.ts \
         context/spotlight.ts export/philips.ts; do
  diff -q "apps/server/src/$f" "apps/mobile/src/$f" >/dev/null || echo "DIFIERE: $f"
done
```

Salida esperada: ninguna línea.

## Orden de cierre

1. Construir y reiniciar el APK release sin Metro.
2. Probar dictado móvil con voz real y vocabulario del dominio.
3. Ensayar una vez el flujo completo hasta Cliente 360 y oportunidad.
4. Grabar y publicar el video en español de máximo cinco minutos.
5. Probar repo y video en una ventana sin sesión.
6. Confirmar registro de cada integrante y enviar en TryDojo antes de las 08:00.

## Hechos que no deben sobreprometerse

- P2P real está probado mediante DHT; LAN totalmente aislada no.
- La app debug necesita Metro después de reiniciar; eso no es dependencia de inferencia cloud.
- `site` todavía no forma parte completa de la clave compartida de reconciliación.
- No existe firma criptográfica completa ni bootstrap privado de producción.

## Documentos de referencia

- [`README.md`](README.md): presentación, ejecución y estado de entrega.
- [`docs/AUDITORIA_REGLAS_HACKATHON_2026-09-11.md`](docs/AUDITORIA_REGLAS_HACKATHON_2026-09-11.md): cumplimiento frente a las reglas oficiales.
- [`docs/FALTANTES_PARA_DEMO.md`](docs/FALTANTES_PARA_DEMO.md): checklist prioritario y criterios de cierre.
- [`docs/GUION_VIDEO.md`](docs/GUION_VIDEO.md): relato y checklist del video.
- [`apps/server/SYNC_P2P.md`](apps/server/SYNC_P2P.md): implementación del receptor central.
- [`apps/server/SYNC_P2P_MOBILE_CONTRACT.md`](apps/server/SYNC_P2P_MOBILE_CONTRACT.md): contrato para los clientes móviles.
