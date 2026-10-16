# Actualizaciones automáticas del POS de escritorio

## Política de distribución vigente — 2026-10-16

- **Windows:** canal de actualización automática. La integración está preparada, pero la activación en clientes sigue pendiente de alojamiento HTTPS, firma y ensayo real entre versiones. Descarga automática; instalación confirmada con caja cerrada.
- **Mac:** entrega manual de instalador, no activar el updater macOS. Cuando el usuario pida una nueva versión o el instalador de la siguiente versión, generar el instalador Mac y entregar la **ruta absoluta de su carpeta**. Conservar datos/licencia y verificar el artefacto para la arquitectura requerida (M1: arm64).
- Un pedido de commit/push no genera versión ni instalador. La implementación técnica Mac que se describe debajo queda como referencia inactiva; no implica que el canal macOS esté habilitado ni que se necesite Apple Developer para continuar con la distribución manual actual.

## Estado y límites

El runtime de actualizaciones se mantiene deshabilitado por defecto mediante `apps/desktop-shell/updates-config.json` (`enabled: false`). Solo se debe habilitar en compilaciones empaquetadas de Windows x64 y macOS x64/arm64, una vez configurado un feed HTTPS persistente y una firma de editor estable. La verificación local no sustituye las pruebas de publicación/instalación en los sistemas operativos destino.

Los clientes actuales deben instalar manualmente una primera versión firmada y compatible. La versión instalada hoy está firmada ad-hoc y no debe considerarse candidata confiable para autoactualización macOS. No se promete ni se activa una actualización en segundo plano hasta contar con Developer ID Application, Team ID, notarización y publicación persistente de artefactos. Para Windows se necesita firma Authenticode; `app-update.yml` debe contener `publisherName` y coincidir exactamente con `windowsPublisherNames`.

La búsqueda comienza 30 segundos después del arranque y se repite cada seis horas; también puede solicitarse desde Configuración → Actualizaciones. Una versión estable posterior se descarga automáticamente en segundo plano. Un aviso no modal informa cuando está lista. La instalación exige confirmación explícita; no se instala al cerrar la aplicación (`autoInstallOnAppQuit=false`). La admisión atómica exige caja cerrada, permiso `settings.manage`, ninguna operación/impresión/restauración en vuelo, y bloquea nuevos ingresos hasta la salida. También cuenta consultas/persistencia de licencia y su polling. Si falla el inicio de instalación, se libera la admisión y se conserva la operación del POS.

No se debe borrar ni migrar manualmente la base local, la licencia o las copias de seguridad como parte de una actualización. Se conserva el directorio de datos de usuario de Electron.

No se agrega backup automático ni rollback automático de migraciones. No se cambian `appId`, `productName`, ruta SQLite ni identidad de licencia. No se considera probada la conservación por un instalador real hasta ejecutar el ensayo N→N+1 firmado en cada plataforma.

## Preparación del feed genérico HTTPS

Publicar por separado los artefactos firmados y metadatos de cada plataforma/arquitectura bajo una URL estable accesible por HTTPS, sin credenciales embebidas, query string ni redirección a un host no controlado. Servir los archivos sin modificar y con `Content-Length` correcto; no reutilizar enlaces temporales de workflows.

- **Windows x64 (NSIS):** `latest.yml`, el instalador `.exe` y el `.blockmap` referenciado. El instalador y el ejecutable deben estar firmados con el certificado Authenticode esperado en `windowsPublisherNames`.
- **macOS x64 y arm64:** `latest-mac.yml`, ZIP de actualización y DMG correspondiente para distribución manual. Los nombres/versiones y hashes de `latest-mac.yml` deben referenciar los ZIP exactos. Firmar la aplicación con Developer ID Application del Team ID configurado, habilitar hardened runtime, notarizar y verificar el ticket antes de publicar. El DMG no reemplaza el ZIP que usa el updater.
- Mantener versión SemVer estable creciente; no publicar prereleases, downgrades ni metadatos que apunten a artefactos faltantes.
- Proteger el endpoint y credenciales de publicación; nunca incluir secretos en configuración que se empaqueta con la aplicación.

## Preparación local de una release firmada (no ejecutada en esta implementación)

1. Resolver alojamiento HTTPS y certificados. Copiar el ejemplo `apps/desktop-shell/updates-config.example.json` a `updates-config.json`, con datos reales, `target` (`win32-x64`, `darwin-x64` o `darwin-arm64`) y URL **específica para ese target**. Tanto runtime como configuración de release rechazan un target diferente al ejecutado; preparar un JSON por destino, no reutilizar el ejemplo M1 en Windows/Intel. No incluir contraseñas. El JSON y `app-update.yml` son parte del instalador, no secretos. En GitHub Releases privados no empaquetar tokens personales: usar un feed HTTPS con acceso apto para clientes.
2. Asignar una nueva versión estable coherente a todos los manifests según el proceso de publicación del proyecto; no reutilizar `0.1.24` para binarios nuevos. Mantener Team ID/editor estables.
3. En el sistema destino, con certificado/credenciales de notarización disponibles sólo en su almacén o entorno privado, construir workspace y empaquetar con la configuración opt-in:

   ```powershell
   pnpm build
   # Windows x64:
   pnpm --filter @gastronomy/desktop-shell rebuild:native
   pnpm --filter @gastronomy/desktop-shell exec electron-builder --config electron-builder.updates.cjs --win nsis --x64 --publish never
   # Mac M1 (desde macOS con toolchain Apple):
   pnpm --filter @gastronomy/desktop-shell exec electron-builder --config electron-builder.updates.cjs --mac dmg zip --arm64 --publish never
   ```

   Los scripts dedicados `dist:update:win`, `dist:update:mac:arm64` y `dist:update:mac:x64` realizan estos builds opt-in. Los scripts `dist:win`/`dist:mac` ordinarios no habilitan el canal de actualización. `electron-builder.updates.cjs` conserva la identidad y exige firma (`forceCodeSigning=true`), habilita hardened runtime/notarización para Mac y configura el proveedor genérico que genera los metadatos. Falla con el JSON deshabilitado, target diferente o sin identidad requerida. Los comandos no publican nada. El workflow ad-hoc `build-macos.yml` se conserva para pruebas, **no es el canal de releases automáticas**.
4. Verificar firmas, hashes, arquitectura, metadatos y ticket Apple; instalar manualmente la primera versión compatible de prueba. Ensayar N→N+1 antes de habilitar el canal de clientes.
5. Publicar primero los artefactos inmutables y **al final** los `latest*.yml` correspondientes. No mezclar metadatos de arquitecturas/canales. No hay comprobación criptográfica independiente del manifiesto en updater6.8.9: el hosting HTTPS y las credenciales de publicación son parte del límite de confianza; se verifican hashes y firma nativa de los ejecutables, no usar feeds ajenos o modificables por terceros.

## Validación de lanzamiento requerida

Antes de habilitar `enabled`, verificar el bundle instalado y las firmas de cada artefacto en macOS y Windows; probar búsqueda, descarga, cancelación, fallo de red, espacio insuficiente, reinicio e instalación con la caja cerrada y con una impresión/operación/restauración en curso. Confirmar que ninguna solicitud nueva puede colarse después de aprobar el cierre para instalar. Probar una instalación inicial manual y una actualización real desde la versión anterior en cada arquitectura soportada. No habilitar el feed de producción por la sola aprobación de pruebas unitarias.

## Evidencia local — 2026-10-16

- Workspace `pnpm test`: 9/9 paquetes, SQLite236, dominio38, web301, shell76 (26 pruebas nuevas de updater/configuración/admisión), protocolo7 y servicio14. `pnpm typecheck` y `pnpm build`: 9/9.
- Unitarias con adapters falsos: versiones posteriores estables, rechazo de targets/URLs inseguros, progreso, concurrencia, reintentos, errores tardíos, firma ausente/ad-hoc o editor distinto, configuración de release firmada, restauración/impresión/licencia en vuelo y bloqueo de nuevas operaciones.
- Guard adicional `before-quit-for-update`: una salida programada por el updater no puede cerrar SQLite si ya falló la instalación y se liberó la admisión. En Mac se limpian únicamente los listeners nuevos de instalación del updater nativo después de error, evitando reinicios tardíos.
- Electron focal final: `pnpm exec playwright test tests/e2e/automatic-updates.spec.ts tests/e2e/half-and-half-settings.spec.ts` **3/3** (1 min), perfiles temporales aislados, fuente final. Prueba real del puente preload/IPC deshabilitado y rechazo de salida nativa no autorizada sin perder caja/licencia; fixture IPC para descarga47%, banner READY, modal/cancelación y conservación de READY ante rechazo; regresión de mitad y mitad con reinicio. El fixture UI no descarga ni instala binarios. Capturas revisadas en `test-results/automatic-updates-*/updates-*.png` (ignoradas por Git).
- Incidencias de validación: la primera corrida encontró una falla previa de idempotencia de combos demo por timestamp de normalización; corregida preservando `updatedAt` al recalcular derivados. Una corrida posterior del test concurrente de backups previo dio `EPERM` transitorio en rename Windows; repetición sin cambios aprobada. No se modificó el mecanismo de backups.
- Límites: no se descargó/ejecutó un binario real, no se creó instalador, versión, commit, push ni despliegue. Firmas/configuración/adapters se ensayaron con fixtures, no certificados del cliente. Falta validación N→N+1 firmada real por plataforma y elección de alojamiento/certificados.
