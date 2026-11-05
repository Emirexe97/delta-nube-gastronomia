# Modo Mozo: revisión de tandas demoradas

## Requisito

El usuario confirmó 60 segundos como umbral y revisión desde caja. Internet es necesario para recibir desde teléfonos, pero no para operar pedidos/cobros/impresiones locales.

## Implementación

- Primera hora de envío persistida en teléfono y reenviada sin renovarla.
- Más de 60 s, hora inválida, ausente o futura: revisión local persistida, cero incorporación a pedidos/comandas.
- Migración 46 agrega pendientes y reservas de líneas. Las rutas rápida y demorada consultan ambas reservas para bloquear un requestId nuevo que intente reutilizar líneas.
- Recibo ya aceptado tiene prioridad sobre la antigüedad. Se mantiene el hash anterior de contenido para que reintentos antiguos no entren en conflicto.
- Pedidos → Mozos demorados permite confirmar o descartar. Sólo administrador, encargado o cajero con permiso de crear pedidos.
- Confirmar conserva autoría del mozo y vuelve a validar turno, mesa, productos e impresión. La transacción recupera el camino existente de recepción mediante una sesión interna no expuesta, revocada al terminar; guarda la revisión del cajero en auditoría. Un fallo revierte todo y conserva el pendiente.
- Confirmación y descarte son idempotentes; sólo un resultado nuevo con printJobId despacha impresión. Nunca se reimprime automáticamente un recibo ya procesado.
- Pendientes durables tras reinicio; QR se renueva. El mismo mozo puede consultar recibos anteriores desde una nueva sesión, pero no reenviar pedidos de otro turno.
- Un fallo físico de impresión no se presenta como rechazo del pedido en el teléfono.

## Validación ejecutada

- Typecheck: database, desktop-shell, gastronomy-web, orders-service.
- Build: gastronomy-web, desktop-shell, orders-service.
- Tests SQLite de mozos ejecutados con Electron/tsx (ABI nativa existente; sin reconstruir dependencias compartidas).
- Tests de UI local y de página/relay; pruebas de comportamiento del script móvil.
- Integración worker HTTP + SQLite con red simulada caída: se crea, confirma, cobra y registra impresión local; respuesta perdida; tanda demorada sin cambios; confirmar dos veces, reintentar y rechazar sin duplicados.
- Playwright Electron + navegador: QR, PIN, tandas incrementales, pérdida de respuesta, fallo/reintento de controlador, revisión demorada desde botones reales, confirmación repetida y revocación.

## Límites de entrega

Pruebas con datos temporales y controlador de impresión simulado. No salió papel real. No se actualizaron las instalaciones de clientes, el hosting ni el VPS. No se generó instalador, ni commit/push. El piloto físico requiere publicar el servicio correspondiente y vincular la PC elegida.
