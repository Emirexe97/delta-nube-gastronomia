# 2026-10-15 - feat(licensing): publicar panel privado y habilitación sin códigos 0.1.24

## Autor / sesion

- Autor: Emir / Codex
- Herramienta: Codex /commit

## Objetivo

Sincronizar la version local de Delta Nube POS con el repositorio DiegoPerez-3/delta-nube-pos para que el desarrollo pueda continuar desde otro PC/Codex con contexto actualizado.

## Archivos tocados

- `apps/desktop-shell/package.json` (M)
- `apps/desktop-shell/scripts/verify-macos-license.mjs` (M)
- `apps/desktop-shell/scripts/verify-macos-license.test.mjs` (M)
- `apps/desktop-shell/src/licensing.test.ts` (M)
- `apps/desktop-shell/src/licensing.ts` (M)
- `apps/desktop-shell/src/main.ts` (M)
- `apps/desktop-shell/src/preload.ts` (M)
- `apps/gastronomy-web/src/components/license-panel.tsx` (M)
- `apps/gastronomy-web/src/demo/demo-api.ts` (M)
- `apps/licensing-service/Dockerfile` (M)
- `apps/licensing-service/package.json` (M)
- `apps/licensing-service/panel/index.html` (??)
- `apps/licensing-service/panel/panel.css` (??)
- `apps/licensing-service/panel/panel.js` (??)
- `apps/licensing-service/scripts/set-panel-password.mjs` (??)
- `apps/licensing-service/scripts/stage-panel.mjs` (??)
- `apps/licensing-service/src/panel-auth.ts` (??)
- `apps/licensing-service/src/server.ts` (M)
- `apps/licensing-service/test/enrollment-panel.test.mjs` (??)
- `apps/licensing-service/test/panel-auth.test.mjs` (??)
- `apps/licensing-service/test/password-cli.test.mjs` (??)
- `docker/licensing/panel.override.yml` (??)
- `docs/LICENSING.md` (M)
- `docs/MACOS_BUILD.md` (M)
- `docs/qa/LICENSING_E2E_AUDIT.md` (M)
- `docs/qa/SYSTEM_USABILITY_AUDIT_PLAN.md` (M)
- `package.json` (M)
- `packages/contracts/src/index.ts` (M)
- `packages/licensing/src/device-enrollment.ts` (??)
- `packages/licensing/src/index.ts` (M)
- `packages/licensing/test/device-enrollment.test.mjs` (??)
- `scripts/licensing/authority-backup.sh` (M)
- `scripts/licensing/authority-restore-check.mjs` (M)
- `scripts/licensing/authority-restore-check.sh` (M)
- `tests/e2e/licensing-packaged.spec.ts` (M)

## Cambios realizados

- **Docker / despliegue**: 1 archivo(s). Ejemplos: docker/licensing/panel.override.yml
- **Documentacion**: 4 archivo(s). Ejemplos: docs/LICENSING.md; docs/MACOS_BUILD.md; docs/qa/LICENSING_E2E_AUDIT.md; docs/qa/SYSTEM_USABILITY_AUDIT_PLAN.md
- **POS web / interfaz operativa**: 2 archivo(s). Ejemplos: apps/gastronomy-web/src/components/license-panel.tsx; apps/gastronomy-web/src/demo/demo-api.ts
- **Proyecto / configuracion**: 18 archivo(s). Ejemplos: apps/licensing-service/Dockerfile; apps/licensing-service/package.json; apps/licensing-service/panel/index.html; apps/licensing-service/panel/panel.css; apps/licensing-service/panel/panel.js; apps/licensing-service/scripts/set-panel-password.mjs
- **Scripts**: 3 archivo(s). Ejemplos: scripts/licensing/authority-backup.sh; scripts/licensing/authority-restore-check.mjs; scripts/licensing/authority-restore-check.sh
- **Shell desktop / licencias**: 7 archivo(s). Ejemplos: apps/desktop-shell/package.json; apps/desktop-shell/scripts/verify-macos-license.mjs; apps/desktop-shell/scripts/verify-macos-license.test.mjs; apps/desktop-shell/src/licensing.test.ts; apps/desktop-shell/src/licensing.ts; apps/desktop-shell/src/main.ts

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
