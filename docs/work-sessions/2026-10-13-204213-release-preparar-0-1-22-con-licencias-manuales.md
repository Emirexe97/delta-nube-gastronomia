# 2026-10-13 - release: preparar 0.1.22 con licencias manuales

## Autor / sesion

- Autor: Emir / Codex
- Herramienta: Codex /commit

## Objetivo

Publicar Delta Nube Gastronomía 0.1.22 en `Emirexe97/delta-nube-gastronomia`, con licencias manuales, recuperación segura y preparación de DMG Intel/Apple Silicon. No publicar el repositorio POS Tienda ni su configuración remota desde este chat.

## Archivos tocados

- `.gitattributes` (??)
- `.github/workflows/build-macos.yml` (M)
- `.gitignore` (M)
- `apps/desktop-shell/licensing-config.json` (??)
- `apps/desktop-shell/package.json` (M)
- `apps/desktop-shell/scripts/verify-macos-license.mjs` (??)
- `apps/desktop-shell/scripts/verify-macos-license.test.mjs` (??)
- `apps/desktop-shell/src/licensing.test.ts` (??)
- `apps/desktop-shell/src/licensing.ts` (??)
- `apps/desktop-shell/src/main.ts` (M)
- `apps/desktop-shell/src/preload.ts` (M)
- `apps/gastronomy-web/src/app.tsx` (M)
- `apps/gastronomy-web/src/components/license-panel.tsx` (??)
- `apps/gastronomy-web/src/demo/demo-api.ts` (M)
- `apps/gastronomy-web/src/pages/settings-page.tsx` (M)
- `apps/licensing-service/Dockerfile` (??)
- `apps/licensing-service/package.json` (??)
- `apps/licensing-service/README.md` (??)
- `apps/licensing-service/src/admin-cli.ts` (??)
- `apps/licensing-service/src/server.ts` (??)
- `apps/licensing-service/test/service.test.mjs` (??)
- `apps/licensing-service/tsconfig.json` (??)
- `docker/licensing/Caddyfile.snippet` (??)
- `docker/licensing/compose.yml` (??)
- `docker/licensing/Dockerfile.runtime` (??)
- `docker/licensing/edge-network.override.yml` (??)
- `docs/LICENSING.md` (??)
- `docs/MACOS_BUILD.md` (M)
- `docs/qa/LICENSING_E2E_AUDIT.md` (??)
- `docs/qa/SYSTEM_USABILITY_AUDIT_PLAN.md` (M)
- `package.json` (M)
- `packages/contracts/src/index.ts` (M)
- `packages/licensing/package.json` (??)
- `packages/licensing/src/index.ts` (??)
- `packages/licensing/test/lease.test.mjs` (??)
- `packages/licensing/tsconfig.json` (??)
- `pnpm-lock.yaml` (M)
- `README.md` (M)
- `scripts/licensing/authority-backup.ps1` (??)
- `scripts/licensing/authority-backup.sh` (??)
- `scripts/licensing/authority-backup.test.ps1` (??)
- `scripts/licensing/authority-restore-check.mjs` (??)
- `scripts/licensing/authority-restore-check.sh` (??)
- `scripts/licensing/public-pilot.mjs` (??)
- `scripts/licensing/README.md` (??)
- `tests/e2e/desktop-flow.spec.ts` (M)
- `tests/e2e/licensing-packaged.spec.ts` (??)
- `tests/e2e/licensing.spec.ts` (??)

## Cambios realizados

- **CI / GitHub**: 1 archivo(s). Ejemplos: .github/workflows/build-macos.yml
- **Docker / despliegue**: 4 archivo(s). Ejemplos: docker/licensing/Caddyfile.snippet; docker/licensing/compose.yml; docker/licensing/Dockerfile.runtime; docker/licensing/edge-network.override.yml
- **Documentacion**: 4 archivo(s). Ejemplos: docs/LICENSING.md; docs/MACOS_BUILD.md; docs/qa/LICENSING_E2E_AUDIT.md; docs/qa/SYSTEM_USABILITY_AUDIT_PLAN.md
- **POS web / interfaz operativa**: 4 archivo(s). Ejemplos: apps/gastronomy-web/src/app.tsx; apps/gastronomy-web/src/components/license-panel.tsx; apps/gastronomy-web/src/demo/demo-api.ts; apps/gastronomy-web/src/pages/settings-page.tsx
- **Proyecto / configuracion**: 20 archivo(s). Ejemplos: .gitattributes; .gitignore; apps/licensing-service/Dockerfile; apps/licensing-service/package.json; apps/licensing-service/README.md; apps/licensing-service/src/admin-cli.ts
- **Scripts**: 7 archivo(s). Ejemplos: scripts/licensing/authority-backup.ps1; scripts/licensing/authority-backup.sh; scripts/licensing/authority-backup.test.ps1; scripts/licensing/authority-restore-check.mjs; scripts/licensing/authority-restore-check.sh; scripts/licensing/public-pilot.mjs
- **Shell desktop / licencias**: 8 archivo(s). Ejemplos: apps/desktop-shell/licensing-config.json; apps/desktop-shell/package.json; apps/desktop-shell/scripts/verify-macos-license.mjs; apps/desktop-shell/scripts/verify-macos-license.test.mjs; apps/desktop-shell/src/licensing.test.ts; apps/desktop-shell/src/licensing.ts

## Verificaciones

```powershell
corepack pnpm --filter @gastronomy/web typecheck
```

Resultado:

- El typecheck web del script pasó; checks completos y resultados específicos se registran abajo.
- Revisado que no se incluyan node_modules, builds, secretos .env, bases locales, logs, backups ni archivos tsbuildinfo. El archivo demo versionado anterior no contiene credenciales.
- Base local/upstream antes de esta publicación: `eec8a92294151fb86f9ae2966cd65d8aaed1d7af`.

## Riesgos y pendientes

- Revisar en GitHub Actions si el workflow completo encuentra problemas que el typecheck local no cubra.
- Si se agregaron migraciones, el proximo entorno debe ejecutar el flujo normal de instalacion/migracion antes de probar.
- Si el cambio afecta desktop, reconstruir renderers/app antes de entregar instaladores.

## Notas para la proxima sesion

- Este archivo fue generado automaticamente antes del commit.
- Usar este handoff como punto de partida para entender el lote de cambios posterior al ultimo commit.
- Commits de implementación/preparación: `42f1df7` y `c43cbcf`. Se complementa este handoff antes del push.

## Evidencia de esta entrega

- Autorización explícita: publicar cambios y preparar versión 0.1.22 para DMG Intel/Apple Silicon con licencias.
- Versiones raíz/shell 0.1.22; tipo/build 9/9, shell 37/37 (incluye ASAR3), protocolo5/5, servicio6/6, web286/286, backupPS5grupos PASS. E2E final licencia4/4 en48,7s (no sumar repeticiones al inventario13).
- Piloto público anterior con Electron empaquetado real y autoridadHTTPS aprobado; un registro técnico, no cliente/cobro. Recuperación de autoridad desde backupDPAPI enPC aprobada en cloneDocker tmpfs/networknone.
- No claves privadas, admin credentials, bases, backups, bundles ni fixtures en Git. El cliente lleva sólo clave pública. URL y operación: docs/LICENSING.md; evidencia/límites: docs/qa/LICENSING_E2E_AUDIT.md.
- Dos unidades: feature manual de licencias/recuperación con sus tests/docs; preparación0.1.22 y guard ASAR/CI para buildsMac. Antes de publicar, base eec8a92294151fb86f9ae2966cd65d8aaed1d7af y origin/main sin divergencia.
- CI manualMac posterior al push run38486157882 completado success arm64/x64 desde5498656854bf3937436315b9f7dbfa086c07a1e6; guard ASAR y DMG/SQLite success ambos. Artefactos0.1.22 licenciados descargados/hash en docs/MACOS_BUILD.md. Builds internos sinfirma; no afirmar Mac físico ni impresión/notarización. El backupDPAPI depende del perfilWindows; custodia portátil/segunda copia y monitoreo siguen pendientes antesventa.
- Rollback no consiste en sustituir por el DMGprelicencia0.1.21: retiraría enforcement. No tocar bases/permisos/claves de autoridad ni composeotrorepoPOS. Preparar reversión específica si se requiere.
