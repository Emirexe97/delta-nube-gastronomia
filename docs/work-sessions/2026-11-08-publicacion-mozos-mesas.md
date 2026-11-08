# Publicación del flujo móvil de mesas — 2026-11-08

**Destino:** `https://pedidos.deltanubeweb.com/waiter`. No se modificaron el proxy, las licencias, las cajas de los comercios ni el piloto aislado.

- Servicio Compose: proyecto `gastronomy_web_sites`, servicio `orders`. Imagen anterior `gastronomy-orders:waiter-20261107-private`; nueva `gastronomy-orders:waiter-table-20261108-r1`.
- En la infraestructura de la release anterior sólo se reemplazaron los compilados de `waiter-page.js` y `waiter-relay.js`. Se verificó su SHA-256 en destino e importación en la imagen sin red antes de activar.
- Antes del reemplazo se generó una copia consistente de SQLite con `VACUUM INTO`, se comprobó con `quick_check` y se cotejó su SHA-256 al extraerla. Respaldo privado: `/home/deploy/gastronomy-web-sites/operations/waiter-table-20261108-r1/orders.sqlite`.
- Tras recrear únicamente Pedidos, su salud interna y la página HTTPS pública respondieron correctamente. El HTML contiene `productSearch` y `tableSummary`. No se ingresó a una mesa real ni se envió ninguna comanda al comercio.
- La ruta `/home/deploy/gastronomy-web-sites/current` apunta a la release nueva. Para revertir el código, activar el Compose de la release anterior con su propio `release.env` y sus archivos base y override; verificar HTTPS antes de actualizar el enlace. **No restaurar la base** para revertir código: se perderían operaciones posteriores al respaldo.
- Los vínculos móviles del intermediario son volátiles: las sesiones previas pueden requerir QR nuevo y PIN. El buscador funciona con la página nueva; el detalle de mesa requiere además una caja compatible. No confundir publicación de la web con actualización del escritorio.
