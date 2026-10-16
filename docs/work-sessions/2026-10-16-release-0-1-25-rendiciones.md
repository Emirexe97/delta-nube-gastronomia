# 2026-10-16 — Release local 0.1.25 y regularización de rendiciones

## Objetivo

Preparar la versión 0.1.25, corregir el alcance de rendiciones a la caja actual y conservar evidencia de la regularización solicitada por el usuario. El usuario autorizó expresamente commit/push de esta entrega para generar Mac mediante CI. La instalación local se posterga hasta el cierre real de caja al terminar el turno; no se declara aprobación operativa mientras falten instalación y licencia.

## Archivos y cambios

- `package.json` y `apps/desktop-shell/package.json`: versión 0.1.25.
- `packages/database/src/sqlite-repository.ts` y su prueba: rendiciones filtradas por caja actual mediante `COALESCE(cash_session_paid_id, cash_session_created_id)`.
- `apps/gastronomy-web/src/pages/cash-page.tsx` y `apps/gastronomy-web/src/demo/demo-api.ts` / `demo-api.test.ts`: UI y demo aplican los mismos filtros y muestran el saldo residual.
- No incorporar la base de datos local, datos de clientes/negocio, binarios ni `CONTINUAR_EN_CODEX_OTRA_PC.local-backup.md` al repositorio.

## Regularización autorizada

Por confirmación del usuario, se regularizaron seis rendiciones históricas como `SETTLED` con auditoría `DELIVERY_SETTLED`. No se agregaron movimientos de caja ni se alteraron sesiones de caja. Los identificadores operativos y los datos del repartidor permanecen únicamente en la auditoría local.

Respaldo previo a la regularización: `C:\Users\Bonis\AppData\Local\DeltaNubeBackups\regularizacion-rendiciones-2026-10-16T22-29-11-950Z\gastronomy.sqlite`. Mantener la base y el respaldo fuera de Git.

Respaldo consistente posterior a la regularización y previo a preparar 0.1.25: `C:\Users\Bonis\AppData\Local\DeltaNubeBackups\preparacion-0.1.25-2026-10-16T22-51-42-832Z\gastronomy.sqlite`. `integrity_check` correcto; 744 pedidos y caja 32 en estado `OPEN`. Mantener fuera de Git.

## Verificaciones y estado de instalación

- Pruebas focales de la corrección antes de preparar el release: 101 PASS.
- `pnpm install --frozen-lockfile --ignore-scripts` con pnpm 10.33: completado sin cambios en el lockfile.
- `pnpm typecheck`: 9/9 paquetes PASS.
- Pruebas focales SQLite: 10/10 PASS con Node 24 y prebuild nativo ABI 137; dominio: 38/38 PASS.
- Suite web completa: 303/303 PASS en 32 archivos.
- `pnpm build`: 9/9 paquetes PASS.
- Shell completo después del build: 76/76 PASS (`node --test --test-concurrency=1`).
- SQLite 12.11.1 probado en memoria con Electron 39.8.10 / ABI 140. El empaquetado Windows conserva ese addon validado (`npmRebuild=false` sólo en la invocación; no cambia la configuración versionada).
- Smoke del paquete Windows real sobre copia consistente de la base: versión 0.1.25, `isPackaged=true`, perfil temporal aislado, renderer/Caja correctos, cero rendiciones pendientes. Hash de pedidos/sesiones/movimientos idéntico antes y después del arranque/migración. Evidencia local ignorada: `apps/desktop-shell/release/qa-0.1.25/packaged-smoke.json` y `packaged-cash.png`.
- Ese perfil de prueba devuelve `UNACTIVATED`, `canOperate=false`; updater `DISABLED`. No equivale a licencia aprobada ni instalación sobre el perfil operativo.
- Cliente instalado localmente: 0.1.21. Caja 32 está abierta; se solicitó cerrarla mediante arqueo real antes de actualizar. No actualizar ni declarar la instalación 0.1.25 aprobada hasta completar ese paso y validar el instalador en el entorno destinatario.
- El usuario confirmó que la caja no puede cerrarse hasta terminar el turno. No se cerró ni se instaló sobre el programa operativo.

## Distribución pendiente

- macOS: el workflow manual `.github/workflows/build-macos.yml` produce DMG arm64/x64 en GitHub Actions. Publicar únicamente la fuente de esta entrega y ejecutar desde ese commit; el artefacto anterior 0.1.24 no sustituye la compilación 0.1.25.
- Updater Windows: `apps/desktop-shell/updates-config.json` continúa con `enabled: false`; no hay feed HTTPS ni certificado Authenticode configurados. Por tanto, no publicar ni habilitar actualización automática.
- Licencia: faltan las credenciales del owner del panel y el `known_hosts` SSH de esta PC. No marcar una solicitud/aprobación de licencia como activa sin confirmación y acción en la autoridad correspondiente.
- Aprobación funcional: pendiente de instalación real 0.1.25, arranque, flujo POS/rendiciones, persistencia y registro del resultado. CI/build por sí solos no equivalen a instalación aprobada.

## Próximos pasos

1. Completar la validación de release y registrar comandos/resultados exactos.
2. Cerrar la caja 32 con arqueo real y realizar la actualización local cuando el instalador 0.1.25 esté disponible.
3. Verificar instalación, flujos y persistencia; registrar modelo/OS, arquitectura, artefacto y SHA256.
4. Sincronizar el commit autorizado que contiene 0.1.25 y solicitar el workflow Mac; guardar run, commit fuente, artefacto y hash.
5. Habilitar/publicar updater sólo tras configurar feed HTTPS y Authenticode y completar ensayo real N→N+1. Mantener la distribución Mac como instalador manual.
