# Impresión térmica

## Contrato

La UI solicita un documento semántico:

```text
KITCHEN_ORDER
CUSTOMER_BILL
```

`CASH_CLOSE_SUMMARY` y `REPORT_SUMMARY` quedan como extensiones futuras; no se
publican todavía en el contrato operativo.

El adapter Electron genera el ticket y usa una ventana oculta de impresión. El
renderer desconoce impresoras y ESC/POS.

## Garantía de persistencia

```text
guardar pedido
-> crear print_job QUEUED
-> commit
-> intentar imprimir
-> PRINTED o FAILED
```

Un fallo muestra que el pedido quedó guardado. El mismo `print_job` queda en
`FAILED`, conserva el error técnico y aparece en la orden con una acción
explícita **Reintentar**. El reintento devuelve ese job a `QUEUED`, incrementa
sus intentos al ejecutarse y deja auditoría; no crea otro pedido ni aumenta el
contador de copias de la orden.

## Comanda completa o sólo agregados

Después de imprimir una comanda, **Reimprimir comanda** (también F7) permite elegir:

- **Sólo lo agregado**, seleccionada de forma predeterminada cuando hay pendientes:
  imprime líneas nuevas y aumentos de cantidad desde la última impresión exitosa.
  Si una línea pasó de 2 a 3 unidades, envía únicamente 1. El ticket lleva la marca
  **AGREGADO**, junto al número de pedido y la mesa o canal habituales.
- **Comanda completa**: imprime todos los productos actuales. Usarla también para
  comunicar cambios de observaciones o bajas de productos ya enviados.

El diálogo muestra los agregados pendientes y deshabilita la opción parcial si no
hay ninguno. La cuenta del cliente sigue incluyendo siempre el pedido completo.

Cada trabajo de cocina guarda el contenido y las cantidades al solicitarlo. Los
reintentos usan ese mismo contenido, aunque el pedido se edite mientras tanto.
Sólo un éxito actualiza el registro de cantidades enviadas; cancelar la vista
previa o fallar conserva los agregados pendientes. El registro persiste al cerrar
y reabrir la aplicación.

Las comandas impresas antes de esta función no tienen historial de cantidades:
deben imprimirse completas una vez para habilitar la opción parcial. No se
deducen sus cantidades a partir del pedido actual.

## Perfiles configurables

- perfiles independientes **Comanda de cocina** y **Cuenta del cliente**;
- diálogo de impresión del sistema o envío directo mediante el controlador de Windows;
- impresora específica o predeterminada;
- papel térmico de 58 mm o 80 mm;
- caracteres por línea, entre una y tres copias, corte completo/parcial y líneas de avance;
- módulo **Textos de impresión** con encabezado y pie independientes para comanda y cuenta;
- subtítulo, leyenda no fiscal y campos visibles configurables de la cuenta;
- comanda sin precios;
- pizza mitad y mitad con título propio y ambas variedades como detalle, sin repetirlas en el nombre ni generar observaciones; **OBS** conserva sólo las notas ingresadas manualmente;
- cuenta con subtotal, descuento, delivery y total;
- número, canal/mesa, mozo, hora de entrega, productos, mitades, modificadores con su
  alcance, observaciones y destino;
- marca `REIMPRESIÓN` a partir de la segunda copia.

## Incidentes y reintentos

- `BootstrapDto.printJobs` publica los últimos 100 jobs para mostrar fallos sin
  consultar la impresora desde el renderer.
- La UI refresca ese estado incluso cuando el IPC de impresión rechaza: el
  pedido ya está persistido y el job ya pasó a `FAILED`.
- Sólo un job `FAILED` puede prepararse para reintento.
- Cada preparación registra `PRINT_RETRY_QUEUED` con el permiso
  `orders.reprint`.
- Una reimpresión solicitada por el usuario sí crea una nueva copia semántica;
  un retry técnico recupera la misma copia fallida.

Los perfiles siguen el modelo `LocalConfigurationPrinterProfileV1` del POS de
referencia. El trabajo persistido conserva `printer_name` y `copies`, de modo
que un cambio posterior de configuración no altera el destino auditado.

## Límite del controlador actual

Electron imprime mediante el subsistema gráfico de Windows. Los campos de
cortador se conservan para el perfil térmico, pero el corte físico depende del
driver instalado. Una salida ESC/POS/RAW futura podrá reutilizar el contrato sin
cambiar la interfaz ni la cola.
