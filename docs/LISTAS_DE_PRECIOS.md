# Listas de precios

Si cobrás lo mismo en todos los modos de venta, solo necesitás **Principal**. Cargá ese precio al crear un producto, variante o combo. No hace falta duplicarlo.

## Cobrar distinto según el modo

1. En **Productos → Listas de precios**, creá una lista y elegí su porcentaje sobre Principal. Usá **0 %** si solo querés fijar precios puntuales, o un porcentaje negativo para dar un descuento.
2. Elegí el **redondeo**: sin redondeo adicional (se conservan los centavos), o al múltiplo más cercano de **$10, $100 o $1.000**. Se aplica después del porcentaje. Si el resultado está justo a mitad de camino, sube.
3. Para una excepción, buscá el producto en la lista y cargá su **precio propio**. Es el importe final: no se le aplica porcentaje ni redondeo. Podés quitar el precio propio para volver al cálculo. Revisá los importes y guardá con motivo y PIN.
4. Elegí qué lista usa **Salón, Retiro y Delivery**. Los tres pueden compartir lista. Guardá la asignación para que se use al agregar productos a un pedido.

**Ejemplo.** Una pizza de $9.900 con un 15 % de aumento queda en $11.385. Si elegís redondear a centenas, se cobra **$11.400**. Si en esa lista le fijás un precio propio de **$11.390**, se cobra ese importe, aunque cambie Principal.

La ficha del producto y la lista muestran el mismo precio propio: no hace falta editarlo dos veces. Cada lista se calcula directamente sobre Principal, nunca sobre otra derivada. No modifica el costo de envío, los extras ni el total de pedidos ya registrados.

**Cambios masivos.** Para aumentar el catálogo manteniendo las reglas, ajustá solo Principal. Si elegís expresamente una lista derivada, el importe resultante queda como precio propio de esos productos. La vista previa permite revisar el efecto antes de confirmar.

## Si ya trabajabas con precios de salón y delivery

Antes de instalar la actualización en la caja, guardá una copia desde **Configuración → Copias de seguridad**. La primera vez que abrís el catálogo antiguo con el sistema de listas, la conversión es automática. No tenés que volver a cargar los precios ni calcular un porcentaje.

| Modo de venta | Lista después de actualizar | Importe |
| --- | --- | --- |
| Salón | Principal | El precio anterior de salón. |
| Para llevar o para envío | Delivery | El precio anterior para fuera del salón, copiado como precio propio. |

Por ejemplo, si cobrabas **$9.800 en salón** y **$10.350 para llevar o enviar**, se conservan esos dos importes. Incluso si un producto costaba lo mismo en ambos modos, su precio de Delivery queda fijo: cambiar Principal más adelante no lo cambia. No se aplican porcentajes ni redondeos al importar.

Si el catálogo tenía un precio explícito de **Retiro** distinto del de **Envío** en algún producto, se conserva una tercera lista **Retiro** en vez de elegir un importe y perder el otro. Si sólo estaba cargado uno de los dos precios, se usa para ambas modalidades.

Podés comprobar las asignaciones en **Productos → Listas de precios → Lista por canal** y consultar cada importe con **Ver precios**. La conversión no modifica pedidos ni cobros históricos. Si la instalación ya tiene listas configuradas, la actualización las deja como están.
