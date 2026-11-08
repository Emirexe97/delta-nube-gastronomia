# Publicación del flujo móvil de mesas — 2026-11-08

**Destino:** `https://pedidos.deltanubeweb.com/waiter`. No se modificaron el proxy, las licencias, las cajas de los comercios ni el piloto aislado.

- Servicio Compose: proyecto `gastronomy_web_sites`, servicio `orders`. Imagen anterior `gastronomy-orders:waiter-20261107-private`; nueva `gastronomy-orders:waiter-table-20261108-r1`.
- En la infraestructura de la release anterior sólo se reemplazaron los compilados de `waiter-page.js` y `waiter-relay.js`. Se verificó su SHA-256 en destino e importación en la imagen sin red antes de activar.
- Antes del reemplazo se generó una copia consistente de SQLite con `VACUUM INTO`, se comprobó con `quick_check` y se cotejó su SHA-256 al extraerla. Respaldo privado: `/home/deploy/gastronomy-web-sites/operations/waiter-table-20261108-r1/orders.sqlite`.
- Tras recrear únicamente Pedidos, su salud interna y la página HTTPS pública respondieron correctamente. El HTML contiene `productSearch` y `tableSummary`. No se ingresó a una mesa real ni se envió ninguna comanda al comercio.
- La ruta `/home/deploy/gastronomy-web-sites/current` apunta a la release nueva. Para revertir el código, activar el Compose de la release anterior con su propio `release.env` y sus archivos base y override; verificar HTTPS antes de actualizar el enlace. **No restaurar la base** para revertir código: se perderían operaciones posteriores al respaldo.
- Los vínculos móviles del intermediario son volátiles: las sesiones previas pueden requerir QR nuevo y PIN. El buscador funciona con la página nueva; el detalle de mesa requiere además una caja compatible. No confundir publicación de la web con actualización del escritorio.

## Continuación en la PC de caja (Windows)

Versión de fuente integrada: **0.1.35**. Incluye las mesas QR y los cambios de PIN de la 0.1.34. No distribuir un candidato 0.1.33 de esta sesión. Mac queda pendiente por decisión del usuario.

1. Verificar repositorio `Emirexe97/delta-nube-gastronomia`, rama y cambios locales. Si está limpio, actualizar con `git pull --ff-only origin main`; si diverge o hay cambios, preservarlos y consultar antes de instalar. Comprobar la versión en ambos package.json.
2. Seguir el empaquetado Windows del proyecto para esa fuente. Usar carpeta de salida propia de 0.1.35; verificar la versión en el instalador y en el ASAR, calcular SHA-256 y probar en perfil temporal. No activar ni publicar un feed de actualizaciones, no modificar DNS, no volver a desplegar Pedidos.
3. **No instalar con caja abierta.** Verificar la caja del negocio, no un perfil de prueba. Si está en uso, sólo preparar el instalador. Con caja cerrada, cerrar la app normalmente y respaldar íntegramente su perfil y la instalación antes de reemplazarla. Ante un error detenerse; no reiniciar la base ni restablecer licencias.
4. Comprobar versión instalada, integridad de la base y conservación de los datos. Verificar en el teléfono con QR y PIN que se pueda elegir mesa, revisar lo confirmado y buscar productos. No generar pedidos ni impresiones reales para probar sin autorización.
