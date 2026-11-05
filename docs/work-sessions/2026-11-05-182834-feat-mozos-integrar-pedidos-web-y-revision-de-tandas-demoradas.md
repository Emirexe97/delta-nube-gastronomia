# 2026-11-05 - feat(mozos): integrar pedidos web y revisión de tandas demoradas

## Autor / sesion

- Autor: Emir / Codex
- Herramienta: Codex /commit

## Objetivo

Sincronizar la version local de Delta Nube POS con el repositorio Emirexe97/delta-nube-gastronomia para que el desarrollo pueda continuar desde otro PC/Codex con contexto actualizado.

## Archivos tocados

- `apps/desktop-shell/build/icons/app-icon.icns` (M)
- `apps/desktop-shell/build/icons/app-icon.ico` (M)
- `apps/desktop-shell/build/icons/app-icon.png` (M)
- `apps/desktop-shell/package.json` (M)
- `apps/desktop-shell/scripts/brand-assets.test.mjs` (M)
- `apps/desktop-shell/scripts/generate-brand-assets.mjs` (M)
- `apps/desktop-shell/scripts/run-waiter-circuit-integration.mjs` (M)
- `apps/desktop-shell/scripts/verify-macos-license.mjs` (M)
- `apps/desktop-shell/scripts/verify-macos-license.test.mjs` (M)
- `apps/desktop-shell/src/licensing.test.ts` (M)
- `apps/desktop-shell/src/licensing.ts` (M)
- `apps/desktop-shell/src/main.ts` (M)
- `apps/desktop-shell/src/preload.ts` (M)
- `apps/desktop-shell/src/printer.ts` (M)
- `apps/desktop-shell/src/printer-routing.test.ts` (M)
- `apps/desktop-shell/src/printer-routing.ts` (M)
- `apps/desktop-shell/src/waiter-circuit.integration.ts` (M)
- `apps/desktop-shell/src/waiter-relay.test.ts` (M)
- `apps/desktop-shell/src/waiter-relay.ts` (M)
- `apps/desktop-shell/src/waiter-rpc.ts` (M)
- `apps/desktop-shell/src/web-commerce-sync.test.ts` (M)
- `apps/desktop-shell/src/web-commerce-sync.ts` (M)
- `apps/desktop-shell/src/web-site-provisioning.test.ts` (M)
- `apps/desktop-shell/src/web-site-provisioning.ts` (M)
- `apps/desktop-shell/src/web-site-sharing.test.ts` (M)
- `apps/desktop-shell/src/web-site-sharing.ts` (M)
- `apps/desktop-shell/test/verify-website-qr.mjs` (M)
- `apps/desktop-shell/tsup.config.ts` (M)
- `apps/gastronomy-portal/public/ayuda/index.html` (M)
- `apps/gastronomy-portal/public/carta-de-ejemplo/index.html` (M)
- `apps/gastronomy-portal/public/index.html` (M)
- `apps/gastronomy-portal/public/portal-assets/inter-latin-variable.woff2` (M)
- `apps/gastronomy-portal/public/portal-assets/inter-OFL.txt` (M)
- `apps/gastronomy-portal/public/portal-assets/marca.png` (M)
- `apps/gastronomy-portal/public/portal-assets/mesa.webp` (M)
- `apps/gastronomy-portal/public/portal-assets/simbolo.png` (M)
- `apps/gastronomy-portal/public/portal-assets/site.css` (M)
- `apps/gastronomy-portal/test/edge.test.mjs` (M)
- `apps/gastronomy-web/index.html` (M)
- `apps/gastronomy-web/src/app.tsx` (M)
- `apps/gastronomy-web/src/assets/brand/marca.png` (M)
- `apps/gastronomy-web/src/assets/brand/simbolo.png` (M)
- `apps/gastronomy-web/src/components/delayed-waiter-inbox.test.tsx` (M)
- `apps/gastronomy-web/src/components/delayed-waiter-inbox.tsx` (M)
- `apps/gastronomy-web/src/components/license-panel.tsx` (M)
- `apps/gastronomy-web/src/components/waiter-desk-panel.tsx` (M)
- `apps/gastronomy-web/src/components/web-site-input.ts` (M)
- `apps/gastronomy-web/src/components/web-site-panel.test.tsx` (M)
- `apps/gastronomy-web/src/components/web-site-panel.tsx` (M)
- `apps/gastronomy-web/src/demo/demo-api.test.ts` (M)
- `apps/gastronomy-web/src/demo/demo-api.ts` (M)
- `apps/gastronomy-web/src/pages/catalog-page.tsx` (M)
- `apps/gastronomy-web/src/pages/orders-page.tsx` (M)
- `apps/gastronomy-web/src/pages/settings-page.tsx` (M)
- `apps/gastronomy-web/src/pages/web-orders-inbox.tsx` (M)
- `apps/gastronomy-web/src/pages/web-order-ui.test.ts` (M)
- `apps/gastronomy-web/src/pages/web-order-ui.ts` (M)
- `apps/licensing-service/Dockerfile` (M)
- `apps/licensing-service/package.json` (M)
- `apps/licensing-service/src/server.ts` (M)
- `apps/licensing-service/test/enrollment-panel.test.mjs` (M)
- `apps/orders-service/package.json` (M)
- `apps/orders-service/src/config.ts` (M)
- `apps/orders-service/src/server.ts` (M)
- `apps/orders-service/src/store.ts` (M)
- `apps/orders-service/src/storefront.ts` (M)
- `apps/orders-service/src/storefront-page.ts` (M)
- `apps/orders-service/src/tenant-registry.ts` (M)
- `apps/orders-service/src/tenant-storefront.ts` (M)
- `apps/orders-service/src/waiter-page.ts` (M)
- `apps/orders-service/src/waiter-relay.ts` (M)
- `apps/orders-service/test/orders-service.test.mjs` (M)
- `apps/orders-service/test/storefront.test.mjs` (M)
- `apps/orders-service/test/tenant-storefront.test.mjs` (M)
- `apps/orders-service/test/waiter-page.test.mjs` (M)
- `apps/orders-service/test/waiter-relay.test.mjs` (M)
- `docker/gastronomy-portal/edge.override.yml` (M)
- `docker/gastronomy-portal/portal.caddy` (M)
- `docker/licensing/Dockerfile.runtime` (M)
- `docker/licensing/web-sites.override.yml` (M)
- `docker/web-sites/Caddyfile.example` (M)
- `docker/web-sites/Caddyfile.waiter` (M)
- `docker/web-sites/compose.yml` (M)
- `docker/web-sites/Dockerfile.runtime` (M)
- `docker/web-sites/Dockerfile.runtime.dockerignore` (M)
- `docker/web-sites/waiter-edge.override.yml` (M)
- `docs/GASTRONOMIA_PORTADA.md` (M)
- `docs/MODO_MOZO.md` (M)
- `docs/TENANT_STOREFRONT_TEMPLATES.md` (M)
- `docs/WEB_COMMERCE_POS.md` (M)
- `docs/WEB_ORDERS_API.md` (M)
- `docs/WEB_SITES_REGISTRATION.md` (M)
- `docs/work-sessions/2026-11-05-mozo-demora-revision.md` (M)
- `packages/contracts/package.json` (M)
- `packages/contracts/src/index.ts` (M)
- `packages/contracts/src/waiter-desk.ts` (M)
- `packages/contracts/src/web-commerce.ts` (M)
- `packages/database/src/migrations.ts` (M)
- `packages/database/src/sqlite-repository.ts` (M)
- `packages/database/src/waiter-mobile.test.ts` (M)
- `packages/database/src/web-commerce-guards.test.ts` (M)
- `packages/database/src/web-commerce-persistence.test.ts` (M)
- `packages/web-orders/package.json` (M)
- `packages/web-orders/src/client.ts` (M)
- `packages/web-orders/src/index.ts` (M)
- `packages/web-orders/src/provision.ts` (M)
- `packages/web-orders/test/provision.test.mjs` (M)
- `packages/web-orders/test/web-orders.test.mjs` (M)
- `packages/web-orders/tsconfig.json` (M)
- `pnpm-lock.yaml` (M)
- `README.md` (M)
- `tests/e2e/gastronomy-portal.spec.ts` (M)
- `tests/e2e/licensing-packaged.spec.ts` (M)
- `tests/e2e/merchant-registration.spec.ts` (M)
- `tests/e2e/navigation-frame-readability.spec.ts` (M)
- `tests/e2e/waiter-mobile.spec.ts` (M)
- `tests/e2e/web-commerce.spec.ts` (M)
- `tests/e2e/website-share.spec.ts` (M)

## Cambios realizados

- **Base de datos / Prisma**: 5 archivo(s). Ejemplos: packages/database/src/migrations.ts; packages/database/src/sqlite-repository.ts; packages/database/src/waiter-mobile.test.ts; packages/database/src/web-commerce-guards.test.ts; packages/database/src/web-commerce-persistence.test.ts
- **Docker / despliegue**: 10 archivo(s). Ejemplos: docker/gastronomy-portal/edge.override.yml; docker/gastronomy-portal/portal.caddy; docker/licensing/Dockerfile.runtime; docker/licensing/web-sites.override.yml; docker/web-sites/Caddyfile.example; docker/web-sites/Caddyfile.waiter
- **Documentacion**: 7 archivo(s). Ejemplos: docs/GASTRONOMIA_PORTADA.md; docs/MODO_MOZO.md; docs/TENANT_STOREFRONT_TEMPLATES.md; docs/WEB_COMMERCE_POS.md; docs/WEB_ORDERS_API.md; docs/WEB_SITES_REGISTRATION.md
- **Proyecto / configuracion**: 68 archivo(s). Ejemplos: apps/gastronomy-portal/public/ayuda/index.html; apps/gastronomy-portal/public/carta-de-ejemplo/index.html; apps/gastronomy-portal/public/index.html; apps/gastronomy-portal/public/portal-assets/inter-latin-variable.woff2; apps/gastronomy-portal/public/portal-assets/inter-OFL.txt; apps/gastronomy-portal/public/portal-assets/marca.png
- **Shell desktop / updater**: 28 archivo(s). Ejemplos: apps/desktop-shell/build/icons/app-icon.icns; apps/desktop-shell/build/icons/app-icon.ico; apps/desktop-shell/build/icons/app-icon.png; apps/desktop-shell/package.json; apps/desktop-shell/scripts/brand-assets.test.mjs; apps/desktop-shell/scripts/generate-brand-assets.mjs

## Verificaciones

`powershell
corepack pnpm --filter @gastronomy/web typecheck
`

Resultado:

- corepack pnpm --filter @gastronomy/web typecheck debe haber pasado antes del commit.
- El script valida que no se suban 
ode_modules, builds, .env, bases locales, logs, runtime desktop ni *.tsbuildinfo.
- Commit base local antes de esta sesion: $baseCommit.
- Upstream antes de esta sesion: $remoteCommit.

## Riesgos y pendientes

- Revisar en GitHub Actions si el workflow completo encuentra problemas que el typecheck local no cubra.
- Si se agregaron migraciones, el proximo entorno debe ejecutar el flujo normal de instalacion/migracion antes de probar.
- Si el cambio afecta desktop, reconstruir renderers/app antes de entregar instaladores.

## Notas para la proxima sesion

- Este archivo fue generado automaticamente antes del commit.
- Usar este handoff como punto de partida para entender el lote de cambios posterior al ultimo commit.
- Commit planeado: $CommitMessage.
