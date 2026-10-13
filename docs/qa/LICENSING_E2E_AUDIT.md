# Licenciamiento manual: auditoría focal — 2026-10-13

**MVP y pruebas focales aprobados; DNS/HTTPS, piloto público positivo y respaldo externo cifrado con simulacro de recuperación aprobados el 2026-10-13.** Siguen pendientes requisitos de distribución/custodia independiente. No se ejecutó la integral canónica338 ni se generó un instalador comercial con estos cambios.

## Evidencia y alcance

| Validación                                                                                              | Resultado                                                                 |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Protocolo Ed25519 / esquema / límites de período / allowlist                                            | 5/5 Node                                                                  |
| Autoridad: alta, vínculo, verificación, renovación, idempotencia, validación, persistencia y rate-limit | 6/6 Node                                                                  |
| Desktop completo, incluyendo siete pruebas nuevas de licencia                                           | 34/34 Node                                                                |
| Web regresiones                                                                                         | 286/286, 26 archivos                                                      |
| Typecheck / build                                                                                       | 9/9 paquetes cada uno                                                     |
| Electron desarrollo: IPC licencia, panel sin bloqueo, backups coexistentes                              | 3/3 E2E                                                                   |
| Flujo desktop diario: retiro/envío, mozo, precios, teclado/modales, impresión, mesas, cierre            | 9 escenarios distintos aprobados entre pasada inicial8/9 y focalprecio1/1 |
| Electron verdaderamente empaquetado Windows, HTTPS y autoridad reales aislados                          | 1/1 E2E, sin omitir ni simular permiso                                    |
| Misma imagen Node22.23.3 desplegada en VPS: protocolo + servicio                                        | 11/11, sin usar DB de autoridad activa                                    |
| VPS privado                                                                                             | health200, administrador lista vacía, POS/staging saludables              |

La fila VPS privado corresponde a la primera pasada, anterior al piloto. Seguimiento autorizado:

| Comprobación adicional                                                                       | Resultado                                                                                                                           |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Piloto UI con Electron realmente empaquetado, configuración/clave originales y HTTPS público | 1/1 recorrido: activar GRACE, vencimiento real, bloquear ingreso sin mutación, renovar idempotentemente, ACTIVE e ingreso permitido |
| Binding de otra instalación y firma de autoridad real                                        | 401 esperado y clave pública/firma verificadas                                                                                      |
| Backups Windows: regresiones sin SSH                                                         | 5 grupos PASS (DPAPI/hashes/tamper, proceso correcto, límite, timeout, exit nozero)                                                 |
| Backup autoridad real fuera VPS                                                              | 41190bytes cifrados DPAPI, ACL usuario/SYSTEM; claves/DB no se escriben en claro en PC                                              |
| Recuperación del backup real                                                                 | integrityok, keysvalid, 1 licencia/1 renovación recuperadas, API de copia funcional; production_changedfalse, tmpfs/networknone     |
| Red de proxy declarada con autorización explícita                                            | Comparación profunda compose antes/después: sólo dos adiciones de red; sin reiniciar POS                                            |

El piloto público y la recuperación son escenarios operativos adicionales; no se suman sus repeticiones al inventario13 ni a la integral338. La autoridad ya contiene una licencia técnica etiquetada, no un cliente o cobro. Source checks Node y typecheck/build9/9 repetidos después de scripts; no cambios de producto en esa pasada.

Inventario E2E focal: **13 escenarios distintos** (9 desktop + 3 desarrollo + 1 empaquetado); repeticiones no se suman. El primer intento falló antes de abrir Electron porque `pnpm install --ignore-scripts` no había restaurado el binario. Se ejecutaron instalación de Electron y reconstrucción nativa; no se atribuye ese fallo al producto.

La pasada real posterior tuvo11/13. Los dos fallos fueron de fixture: (1) expectativa de precio resolvía dos filas mientras el modal masivo aún estaba abierto; ahora espera su cierre, focal1/1; (2) Windows no resuelve el shim `pnpm.cmd` con spawn de `pnpm`; el fixture invoca Corepack JS con `process.execPath`, empaquetado1/1. No se omitieron controles ni relajaron permisos para resolverlos.

## Paquete real: qué demuestra

`tests/e2e/licensing-packaged.spec.ts` crea directorio temporal con `electron-builder --win dir --x64`, sin NSIS, publicación ni cambio de versión. Verifica `app.isPackaged === true`, appPath del artefacto y userData temporal antes de escribir. Se usan SQLite y servicio de licencias reales con claves efímeras, proxy HTTPS y certificado local confiado por `NODE_EXTRA_CA_CERTS`; no hay `NODE_TLS_REJECT_UNAUTHORIZED=0`.

Activa un permiso en gracia, abre caja, espera el límite real y verifica EXPIRED. Un ingreso válido queda rechazado antes de mutar caja/productos/pedidos; consultas, historial, copia SQLite y exportación CSV siguen funcionando. Restaura realmente la copia en EXPIRED, compara caja/productos/pedidos y confirma que restaurar no altera el vencimiento. Renueva por API administrativa real, obtiene ACTIVE y permite ingreso, comprobando importe esperado. Los únicos stubs son selectores/confirmaciones nativos de archivos, nunca API de licencia o IPC.

Evidencia local ignorada: `test-results/licensing-verified/`, `licensing-price-final/`, `licensing-packaged-final/` y `licensing-packaged-recovery-final/` (runtime con isPackagedtrue, captura y trace). La captura inicial confirmó banner claro y navegación conservada; no bastaba para inspeccionar el panel fuera de viewport. La pasada final reforzada de recuperación y panel visible pasó1/1 en36,9s, sin sumar otra vez ese escenario al inventario.

## Revisión de tiempo y seguridad

- Veinte días pagados sobreviven a siete offline; persistencia y reinicio comprobados en unidad.
- paidThrough/graceUntil exclusivos; tres días exactos; firma alterada y revisión anterior rechazadas.
- Retroceso de reloj bloquea aunque se intente verificar; debe corregirse el reloj.
- Revisión detectó pérdida de tiempo monotónico al reanclar tras refresh. Se conserva `effectiveNow()` y un nuevo test exige EXPIRED al segundo30 aunque haya refresh al25 y reloj pared detenido.
- Gate central IPC; nuevos métodos desconocidos bloqueados por defecto. Restaurar está permitido expresamente y no reemplaza `license-state.json`.
- Clave privada/admin en VPS y dentro de copia cifrada DPAPI fuera de él, separados de POS; ninguna credencial en claro en evidencia versionable.

## Límites / pendientes

En la primera pasada DNS era NXDOMAIN. Tras confirmar el usuario el alta del registro, DNS A correcto verificado en1.1.1.1/8.8.8.8 y VPS. Se respaldó Caddyfile y añadió únicamente el host de licencias; validate/reload sin reinicio, red propia conectada sólo al edge. HTTPS health200 desde VPS/Windows, admin404 y activate/verify inválidos401. POS/staging302 antes/después y todos sus contenedores saludables. Recibo remoto: `/home/deploy/gastronomy-licensing/operations/https-20261013T231109Z/receipt.json`.

Después del nuevo Adelante, `scripts/licensing/public-pilot.mjs --run-public-pilot` pasó contra VPS desde una app empaquetada real sin CA local ni cambios de configuración. Sólo Windows temporal: artefacto noNSIS con isPackaged/appPath/userData comprobados, UI real de activación/verificación, sin trace de secretos. Un solo registro técnico `jbgL9sLMbCERSd_GobsftA`, vencimiento45s y renovación20d sin pago real; perfil POS eliminado. Recibo sanitizado `.licensing-local/public-pilot-receipt.json`.

Backup `C:\Users\Emir\AppData\Local\DeltaNube\LicensingBackups\authority-20261013T232615Z.dnbak` +receipt; `ValidateRestore` recuperó DB/clave real sin tocar autoridad activa, sólo Docker tmpfs sin red, y probó API de copia. Hash público recuperado coincide con configuración cliente. Helpers `scripts/licensing/authority-backup.*`, `authority-restore-check.*`, README y pruebasPS permanentes; primeras revisiones corrigieron orden de hash cifrado y ACL con privilegio innecesario antes de afirmar éxito. El fallo de ACL ocurrió antes de SSH: no pausó ningún servicio.

Autorización independiente del usuario permitió declarar únicamente red del proxy en el compose actual POS, con comparación profunda sin resolver envfiles. Recibo/backup `/home/deploy/gastronomy-licensing/operations/edge-network-20261013T232712Z/`. No se recreó producción para simular una actualización; su próximo despliegue debe conservar esta declaración en fuente. Monitoreo, segunda copia/custodia portátil, carga detrás del proxy y soporte de cambio de equipo pendientes. DPAPI liga recuperación al perfilWindows; no equivale a recuperar tras perder la PC. Rate-limit detrás del proxy compartido. Procedimiento/rollback en `docs/LICENSING.md`.

Sin prueba física Mac ni impresión real; los DMG0.1.21 CI son anteriores al MVP. UI no deshabilita todos los controles de edición: el rechazo efectivo ocurre en main. No cobro automático, suspensión/transferencia/panel admin ni protección absoluta frente al dueño del equipo. Las pruebas focales no sustituyen una validación integral ni habilitan venta.
