# Listas de precios

Si cobrás lo mismo en todos los modos de venta, solo necesitás **Principal**. Cargá ese precio al crear un producto, variante o combo. No hace falta duplicarlo.

## Cobrar distinto según el modo

1. En **Productos → Listas de precios**, creá una lista. Por ejemplo, *Reparto* con **+15 %** sobre Principal. Usá **0 %** si solo querés cambiar algunos productos o un porcentaje negativo para una lista con descuento.
2. En **Lista por canal**, elegí qué lista usa Salón, Retiro y Delivery. Dos o tres modos pueden compartir una lista. Guardá la asignación con motivo y PIN.
3. En la ficha del producto, abrí **Precios**. Cada lista muestra el importe calculado. Para una excepción, marcá **Precio propio**, ingresá el importe final y guardá. Desmarcá la opción para volver al cálculo.

| Ejemplo | Principal | Reparto (+15 %) | Reparto si cambiás Principal a $12.000 |
| --- | ---: | ---: | ---: |
| Pizza sin excepción | $10.000 | $11.500 | $13.800 |
| Pizza con precio propio de $11.900 | $10.000 | $11.900 | $11.900 |

Cada lista se calcula directamente sobre Principal, nunca sobre otra derivada. El resultado se redondea al centavo. La lista define el precio del producto: no reemplaza el costo de envío ni aplica otro descuento al total del pedido.

**Cambios masivos.** Para aumentar el catálogo manteniendo las reglas, ajustá solo Principal. Si elegís expresamente una lista derivada, el importe resultante queda como precio propio de esos productos. La vista previa permite revisar el efecto antes de confirmar.

**Datos existentes.** Al actualizar una base anterior, el precio de salón pasa a Principal. Si retiro o delivery tenían otros importes, se conservan como excepciones en las listas correspondientes. Si ambos modos usaban los mismos precios, pueden compartir lista. Cambiar la configuración no reescribe los importes ya registrados en pedidos.
