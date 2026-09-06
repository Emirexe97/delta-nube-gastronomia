# Pruebas de aceptación

## Automatizadas hoy

- mitad y mitad en ambos modos;
- extra completo y media pizza;
- fecha comercial;
- efectivo esperado y diferencia;
- pago mixto y trazabilidad de caja;
- efectivo recibido persistido y cálculo visible del vuelto;
- snapshot de precio;
- precio manual por línea con PIN, auditoría y catálogo sin cambios;
- cancelación conservada y auditada;
- reimpresión sin duplicar pedido;
- bloqueo de cierre con pedidos pendientes;
- cierre forzado con motivo, PIN autorizado y autor identificable;
- cambio final independiente del inicial, efectivo a retirar y diferencia de
  arqueo persistidos por separado;
- descuento autorizado y preservación de snapshots;
- ajuste, consumo y restitución de stock;
- persistencia y cálculo de modificadores por media pizza;
- creación y liquidación de rendiciones de delivery;
- alta de repartidor como identidad operativa sin credenciales propias;
- creación persistente de clientes desde el flujo de pedido;
- listado de clientes sin filtro, búsqueda por dirección/referencia y
  persistencia de notas;
- valor de envío persistente por dirección y actualización desde el borrador;
- retorno desde el editor de un borrador a cliente/dirección sin perder líneas;
- rendición inversa cuando el delivery se cobra por transferencia;
- rechazo de cancelación de pedidos que ya tienen pagos;
- devolución total de pago con PIN, movimiento inverso de caja, protección
  contra una segunda devolución y cancelación posterior;
- persistencia de fecha/marca de pedidos programados;
- creación idempotente de mesa, resolución de número de mozo y carga por cantidad;
- recuperación de caja, pedido, estado y líneas después de reiniciar;
- autorización y auditoría de altas/cambios de usuarios;
- informes históricos usando snapshots de producto y categoría;
- creación y validación de un backup SQLite real;
- benchmark reproducible con 2.500 pedidos.
- operación masiva transaccional con categoría/estado/precio y rollback ante
  un precio negativo;
- persistencia de impresora y copias en el trabajo de impresión.

## E2E de escritorio

`pnpm test:e2e` inicia Electron con una base SQLite temporal y verifica desde la
interfaz:

1. apertura de caja, creación de takeaway y agregado de un producto;
2. alta de repartidor, creación/edición de cliente con valor por dirección,
   creación del delivery, retorno a sus datos y actualización del costo sin
   perder el borrador;
3. alta y asignación explícita de mozo al abrir una mesa;
4. edición autorizada de un producto y consulta de su historial;
5. creación de mesa y carga de productos con autocompletado alfabético,
   espera de 1 segundo, flechas, `Tab`, `Enter`, clic y cambio de precio con
   retorno seguro o autorización por PIN;
6. conciliación de caja, cambio final distinto y confirmación definitiva.
7. guardado y recarga de un perfil de impresión y sus encabezados/pies editables.

El primer viaje también cobra y devuelve un pago desde la interfaz; el segundo
verifica que Clientes liste sin buscar y permita editar direcciones; el cuarto
aplica una actualización masiva de precios a dos productos.

El perfil temporal se elimina al terminar para que las pruebas sean repetibles.

## Flujos manuales

### Mesa

1. Abrir caja.
2. Abrir una mesa libre.
3. Agregar productos y verificar autoguardado.
4. Imprimir cuenta y confirmar que la mesa continúa ocupada.
5. Agregar otra línea.
6. Cobrar con dos medios.
7. Marcar entregado y verificar mesa libre/historial.

### Takeaway

1. `F3`, buscar o crear cliente sin salir del pedido, demora y observación.
2. Agregar productos.
3. Imprimir comanda.
4. Editar y reimprimir.
5. Cobrar y entregar.

### Delivery

1. `F4`, buscar o crear cliente, dirección, demora, costo y repartidor.
2. Agregar productos y cobrar.
3. Verificar separación entre total gastronómico y costo de delivery.
4. Cobrar en efectivo y liquidar la rendición desde Repartidores.

### Resiliencia

1. Crear un pedido y cerrar el proceso sin marcarlo entregado.
2. Reiniciar: el pedido y la mesa deben reaparecer.
3. Probar una impresora desconectada: el pedido debe seguir guardado y el job
   quedar `FAILED`.
