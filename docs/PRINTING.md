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

## Perfiles configurables

- perfiles independientes **Comanda de cocina** y **Cuenta del cliente**;
- diálogo de impresión del sistema o envío directo mediante el controlador de Windows;
- impresora específica o predeterminada;
- papel térmico de 58 mm o 80 mm;
- caracteres por línea, entre una y tres copias, corte completo/parcial y líneas de avance;
- módulo **Textos de impresión** con encabezado y pie independientes para comanda y cuenta;
- subtítulo, leyenda no fiscal y campos visibles configurables de la cuenta;
- comanda sin precios;
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
