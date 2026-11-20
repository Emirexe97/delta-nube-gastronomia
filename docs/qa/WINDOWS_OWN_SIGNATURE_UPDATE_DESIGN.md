# Actualizaciones Windows con firma propia — diseño y preparación

Actualizado: 2026-11-17. **Firma propia: integrada y validada en un [ensayo Windows instalado 98.0.1 → 98.0.2](WINDOWS_INSTALLED_UPDATE_QA_20261117.md). Canal de clientes: deshabilitado.** Sólo se generaron versiones y claves de prueba; no se tocó producción ni la versión oficial. Authenticode queda pendiente. [Informe de HTTPS existente](UPDATE_HTTPS_DEPLOYMENT_20261116.md).

## Integración Windows x64 y prueba aislada

- El modo explícito `windows-ed25519-v1` verifica `release.json` con claves públicas empaquetadas. No lee claves de la configuración ni vuelve a consultar metadatos para descargar o instalar. No tiene fallback a `latest.yml`, a Authenticode ni a macOS. El llavero empaquetado está vacío y `updates-config.json` conserva `enabled: false`.
- Descarga completa asíncrona: HTTPS fijo sin redirecciones ni proxy ambiental, límites y timeout, una sola instantánea firmada, comprobación por flujo de tamaño/SHA-512. Sólo llega a READY al cerrar el archivo validado. No reutiliza descargas de ejecuciones anteriores; el checkpoint persiste con reemplazo atómico bajo el perfil. Un checkpoint ausente en un directorio ya inicializado impide descargar.
- El proceso principal pide confirmación nativa, con **Cancelar** por defecto. Sólo después vuelve a verificar permisos, caja cerrada y operaciones activas. La admisión permanece exclusiva durante la reverificación y el inicio asíncrono; cerrar la app no dispara la instalación.
- El lanzador Windows rechaza un archivo o ancestro con reparse point. Sostiene handles del archivo y directorios sin compartir el borrado/renombre, comprueba tamaño/SHA‑512/vigencia y solicita arrancar esa ruta con argumentos NSIS fijos. No intenta elevar ni saltarse políticas de Windows. Requiere Windows PowerShell local y un perfil en unidad fija. No se elimina la fuente después de solicitar el arranque; antes de publicar, queda por definir su limpieza segura posterior.

### Evidencia y límites

| Capa | Resultado |
|---|---|
| Integración HTTPS real en loopback | Descarga a 50 % mientras se admiten operaciones; 0 llamadas al lanzador ante caja abierta, cancelación, permiso denegado o una operación activa. Si se abre caja durante el diálogo, se rechaza después de confirmar. Una única llamada simulada tras confirmar con caja cerrada, con exclusión hasta terminar. |
| Verificación negativa | Firma incorrecta, certificados sin confianza, redirecciones, bytes alterados, caducidad, replay al reiniciar y checkpoint ausente no habilitan instalación. |
| Lanzador real Windows | Pruebas negativas con bytes inertes: tamaño, hash, expiración, ruta reparse y handles incompatibles. Se confirmó que un handle de atributos solo no impide renombre de directorio; se requiere acceso de listado sin compartir borrado. No se ejecutó un instalador. |
| Electron/Playwright | 2/2 con perfiles desechables y sin servicios productivos: IPC deshabilitado no altera caja/licencia; la UI muestra progreso, delega la confirmación y conserva READY ante cancelación/rechazo simulados. |
| Regresión y compilación | 61 pruebas pasaron y 1 incompatibilidad de plataforma omitida; typecheck desktop/web y build local de 9 workspaces correctos. |

En esa fase, la confirmación y el lanzamiento fueron **simulados** en el ensayo integral con HTTPS local; las pruebas del helper real fueron negativas. La fase [N→N+1 instalada posterior](WINDOWS_INSTALLED_UPDATE_QA_20261117.md) verificó reemplazo real con NSIS y conservación de datos/licencia en QA. No habilitar el canal hasta contar con la custodia de claves reales, validación de la variante de distribución y publicación verificada.

Repetir la integración con `node --test apps/desktop-shell/src/windows-signed-update-adapter.test.ts apps/desktop-shell/src/windows-verified-launch.test.ts` (OpenSSL local para la CA efímera de loopback). UI: `corepack pnpm exec playwright test tests/e2e/automatic-updates.spec.ts` tras el build local. Typecheck: `corepack pnpm --filter @gastronomy/desktop-shell --filter @gastronomy/web typecheck`. Build: `corepack pnpm --filter @gastronomy/desktop-shell... build`.

**Reversión:** retirar el modo explícito y sus módulos de almacenamiento/adaptador/lanzador y sus tests. Si se revierte la confirmación nativa compartida, restaurar en conjunto el helper IPC, la interfaz y sus tests; no revertir cambios ajenos en `main.ts`. No requiere cambios en el servidor ni en los perfiles del POS.

## Implementado localmente

`apps/desktop-shell/src/windows-signed-update.ts` verifica la firma Ed25519 con una clave pública de confianza entregada por el llamador, valida los metadatos del destino Windows x64 y devuelve un snapshot inmutable. Con ese mismo snapshot, la verificación del artefacto lee sus bytes en flujo y exige tamaño y SHA-512 exactos. **No hay acceso a red, escritura de estado, instalación ni cambios a la ruta Authenticode.**

Para repetir la firma y el preflight local con claves efímeras desde la raíz:

```powershell
node --test apps/desktop-shell/src/windows-signed-update.test.ts
```

La prueba firma un manifiesto en memoria, verifica un archivo de prueba inerte y vuelve a leerlo para rechazar una alteración. No guarda ni imprime claves. No prueba un instalador NSIS ni autoriza ejecutarlo.

### Contrato del prototipo v1

| Componente | Formato y reglas |
|---|---|
| Sobre (máx. 64 KiB) | JSON plano con exactamente `format: 1`, `keyId`, `payload`, `signature`. ID ASCII en minúsculas de hasta 48 caracteres; mapa de claves públicas Ed25519 provisionado por un canal confiable, nunca por el feed. |
| Firma | Ed25519 sobre `ASCII("DeltaNubeGastronomia-Update-v1") + 0x00 + bytes exactos del payload`. Payload (máx. 16 KiB) y firma (64 bytes) en Base64 estándar canónico. Se verifica antes de interpretar el payload. |
| Payload | JSON plano de esquema cerrado: `appId`, `platform`, `arch`, `channel`, `version`, `sequence`, `issuedAt`, `expiresAt`, `minVerifierVersion`, `artifactPath`, `artifactSize`, `artifactSha512`. No acepta duplicados, claves extra, UTF-8 inválido ni BOM. |
| Identidad y vigencia | `com.deltanube.gastronomy / win32 / x64 / stable`. Versiones de tres enteros canónicos (hasta 9 dígitos por componente). `minVerifierVersion: 1`; vigencia máx. 30 días, fechas UTC a segundos, tolerancia de 5 minutos para emisión futura/retroceso de reloj. La expiración usa el máximo entre el reloj actual y el observado en el checkpoint. |
| Artefacto | `versions/<version>/<nombre>.exe`, nombre ASCII seguro de hasta 128 caracteres; archivo entre 1 byte y 1 GiB; SHA-512 hexadecimal en minúsculas. |
| Antirreplay | Compara contra versión instalada y checkpoint previo. Misma secuencia sólo para los mismos bytes firmados; una nueva secuencia permite renovar el manifiesto de la misma versión pero no autoriza sobrescribir el ejecutable publicado. El adaptador lee y persiste el checkpoint atómicamente antes de usar el snapshot. |

**Límite del módulo puro:** verificar un flujo no garantiza que una ruta de archivo siga apuntando a esos bytes al ejecutar. El adaptador añade la admisión y el helper Windows descritos arriba.

### Evidencia de la fase inicial (histórica)

- **17 pruebas nuevas**, más 33 de regresión del actualizador/gate/preflight previo: 50/50 con `node --test` sobre `windows-signed-update.test.ts`, `app-updater.test.ts`, `update-runtime.test.ts`, `update-install-gate.test.ts`, `update-release-config.test.cjs` y `verify-windows-update.test.mjs` del desktop shell.
- Typecheck del desktop y build local correctos en esa fase. El verificador se integró al bundle del proceso principal en la fase posterior descrita arriba.
- La prueba con archivo inerte es un preflight local, no un E2E instalado.

## Estado verificado

| Elemento | Evidencia / estado |
|---|---|
| VPS | Lectura SSH: 96 GiB totales, 33 GiB libres; RAM disponible 5.649 MiB; carga 0,27/0,47/0,44. Es una instantánea, no una prueba de capacidad bajo descarga. |
| Servicios | Contenedores POS, staging, licencias, pedidos y edge reportaron healthy; no se reiniciaron. |
| Caddy | 2.11.3; mount existente de `/opt/pos/delta-nube-pos/updates` a `/srv/updates`, sólo lectura. |
| Aislamiento | Subcarpeta `gastronomy/windows/x64` creada y vacía, sin publicar archivos del otro POS. |
| DNS | A `actualizaciones.deltanubeweb.com` → `145.223.121.144`, TTL 300, creado en Hostinger y verificado en autoritativo y 1.1.1.1. Reemplaza el NXDOMAIN observado inicialmente. |
| Transferencia | Cuota y costo del proveedor sin verificar; dimensionar según tamaño del instalador × clientes × frecuencia. |
| HTTPS | Sitio instalado tras validar configuración completa, respaldo y recarga sin reinicio. Certificado Let's Encrypt verificado con TLS 1.3; 11 pruebas de rutas ausentes/rechazadas. Ver informe para evidencia final. |

## DNS y hosting

Registro creado: **A `actualizaciones` → `145.223.121.144`**, dentro de la zona `deltanubeweb.com`. DNS y HTTPS confirmados. No agregar AAAA sin verificar IPv6; no configurar clientes hasta implementar y validar el canal firmado.

- URL de manifiesto: `https://actualizaciones.deltanubeweb.com/gastronomia/windows/x64/release.json`.
- Artefactos: `/gastronomia/windows/x64/versions/X.Y.Z/<nombre>.exe`.
- Caddy sólo admite el manifiesto exacto y rutas versionadas de ejecutables; todo lo demás da 404. Sin listado, claves, enlaces simbólicos ni fallback a `latest.yml`.
- Manifiesto no-cache/no-store. Ejecutables inmutables con caché larga. Publicar archivos primero y manifiesto al final, mediante reemplazo atómico dentro del árbol de publicación.
- El Caddyfile activo es un **bind mount individual**: no reemplazar su inode mediante rename. Se respaldó, validó el candidato completo, escribió preservando inode, comprobó contenido montado y recargó; no se recreó el edge ni reinició el POS.

## Decisión de seguridad

Usar **Ed25519** con implementación criptográfica estándar de Node, sin inventar algoritmos. Clave exclusiva para actualizaciones, distinta de licencias y TLS. La privada nunca estará en VPS, repositorio, instalador ni logs. La pública se incorpora al cliente inicial por un canal confiable; no se descarga del servidor que se está verificando.

La firma propia autentica el manifiesto y, mediante su hash firmado, el instalador. **No equivale a Authenticode ni elimina avisos/bloqueos de SmartScreen, Smart App Control o políticas empresariales.** No se propondrá desactivar protecciones de Windows para superar un bloqueo.

### Compatibilidad y separación de proveedores

La versión fijada por el proyecto, `electron-updater` 6.8.9, no contiene `updateManifestPublicKey`. La [documentación de manifiestos firmados](https://www.electron.build/docs/features/signed-update-manifests/) no es aplicable a esa versión. No copiar esa configuración ni migrar sin evaluación.

El adaptador implementado no usa 6.8.9 para este modo: consume un solo manifiesto verificado, descarga directamente y delega el lanzamiento del ejecutable NSIS verificado al helper Windows. El proveedor Authenticode conserva sus controles y Mac sigue manual.

## Contrato propuesto y flujo

1. Descargar `release.json` con límite de 64 KiB, timeout y HTTPS de origen fijo, sin credenciales ni redirecciones. Un error afecta sólo las actualizaciones, no el POS.
2. Sobre cerrado: versión de formato, identificador de clave, payload UTF-8 codificado en base64 canónico y firma de 64 bytes. Firmar los bytes exactos del payload con prefijo de dominio `DeltaNubeGastronomia-Update-v1`, separado inequívocamente. Rechazar campos extra, JSON con claves duplicadas, codificación inválida y tamaños excesivos. Nunca reserializar un objeto recibido para verificarlo.
3. Payload firmado: appId exacto, plataforma `win32`, arquitectura `x64`, canal `stable`, versión `X.Y.Z`, secuencia creciente, fechas de emisión/expiración, versión mínima del verificador, nombre/ruta relativa del instalador, tamaño y SHA-512. Validar esquema cerrado incluso después de verificar la firma. Rutas sólo bajo `versions/<versión>/`; rechazar traversal, escapes ambiguos, query, fragmentos y otros orígenes.
4. Comparar contra versión instalada y máximo manifiesto aceptado persistido: impedir downgrade, replay de secuencia inferior y distinta identidad para igual secuencia. Persistencia atómica; un fallo impide actualizar. Fechas y expiración limitan replay, pero dependen del reloj: ante retroceso sospechoso bloquear actualización y explicar el problema, no bloquear ventas. Una reinstalación que borre ese estado requiere tratarse como nuevo bootstrap de confianza.
5. Descarga completa inicialmente, **sin diferencial/blockmap**. Usar tamaño y hash firmados, límite de bytes, progreso y cancelación. La misma instantánea verificada debe controlar toda la descarga: no validar un manifiesto y luego pedir otro `latest.yml` al servidor.
6. Verificar nuevamente cualquier archivo recuperado de caché y antes de instalar. Cache local con permisos restringidos y sin reparse points. Diseñar explícitamente el control del intervalo entre hash y ejecución (TOCTOU); no asumir que la caché de la librería lo garantiza. Cualquier discrepancia invalida READY.
7. Reutilizar admisión atómica existente: permiso, caja cerrada, sin operaciones/impresión/restauración en vuelo, confirmación explícita y bloqueo de nuevas operaciones durante instalación. Integrar la reverificación asíncrona con esa admisión sin liberar el bloqueo entre validación y lanzamiento. `autoInstallOnAppQuit=false`; nunca ejecutar un archivo no verificado.

Amenazas cubiertas: servidor/transportes alterados sin acceso a la privada, sustitución de manifiesto/archivo y replay. No se promete protección frente a administrador local malicioso, clave de firma robada, cliente inicial adulterado o sistema operativo comprometido.

## Custodia y recuperación antes de generar claves reales

Ver el [runbook del piloto privado](WINDOWS_ED25519_PILOT_RUNBOOK.md) para la custodia propuesta, el simulacro de recuperación y el preflight offline. El modo piloto tiene sus propios pines y checkpoint; ambos canales siguen deshabilitados en este workspace y no se publicaron binarios ni metadatos de piloto.

- Elegir responsable y almacén de secretos de firma en PC de releases o CI protegido; confirmar copia de recuperación cifrada y separada. No basta una sola copia DPAPI ligada a una PC.
- Generar claves sólo después de definir custodia; registrar huella pública, no la privada.
- Rotación normal: cliente puente confía en vieja y nueva; distribución posterior retira vieja. No aceptar claves nuevas sólo porque el feed las anuncia.
- Compromiso: detener publicación y usar canal independiente para recuperar confianza. Una clave comprometida puede firmar falsas revocaciones; no prometer recuperación segura exclusivamente desde ese feed.
- Clientes actuales con updater deshabilitado necesitan una primera instalación compatible por un canal confiable; publicar un manifiesto no les agrega la clave retroactivamente.

## Implementación y criterios de aceptación pendientes

- [x] Modo independiente de 6.8.9; sin segunda consulta no autenticada ni reutilización de caché. Helper NSIS probado con negativos y actualización real de QA.
- [x] Verificador puro de manifiesto y artefacto con preflight local reproducible y claves efímeras de prueba.
- [x] Herramienta offline de firma, recuperación y preflight para piloto, probada con material efímero. Ejecución real pendiente de custodia aprobada.
- [ ] Negativos: firma/clave/hash/tamaño incorrectos, replay, downgrade, expiración, reloj atrasado, origen/ruta inválida, JSON duplicado, manifest oversized, redirección, caché alterada y cambio de archivo antes de instalación.
- [x] Admisión aislada: caja abierta (también tras iniciar confirmación), falta de permisos, solicitudes concurrentes, cancelación y operación activa no lanzan. Protección ante salida no autorizada cubierta por Electron; falta ensayo instalado.
- [ ] Custodia de clave y recuperación comprobadas, DNS y TLS reales, verificación del hosting remoto.
- [x] Ensayo N→N+1 con instaladores de prueba, datos y licencia ficticios persistidos.
- [ ] Validar variante de distribución y políticas de Windows de los equipos piloto sin desactivar las protecciones, y autorizar publicación.
- [ ] Sólo entonces habilitar canal para clientes y registrar evidencia. Sin commit, push, versión ni instalador en esta preparación.

## Referencias

- [Plantilla y operación Caddy](../../docker/updates/README.md).
- [Node.js: firma y verificación Ed25519 en `node:crypto`](https://nodejs.org/api/crypto.html#cryptoverifyalgorithm-data-key-signature-callback).
- [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https).
- [Microsoft: reputación SmartScreen](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation).
- [Microsoft: acceso y compartición de handles `CreateFileW`](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew).
- [Electron: confirmación nativa `dialog.showMessageBox`](https://www.electronjs.org/docs/latest/api/dialog#dialogshowmessageboxwindow-options).
