# Listas de precios y ficha de producto

Pedido: simplificar las acciones de la tabla, organizarlas en pestañas dentro de la ficha e implementar listas de precios vinculadas a modos de venta. Posteriormente el usuario solicita commit/push y distribución Windows y Mac, con actualización de esta PC.

Principal es la referencia del producto. Las derivadas aplican un porcentaje directo sobre Principal y admiten precios propios fijos. Salón, Retiro y Delivery eligen listas compartibles. Migración SQLite 48 y demo v13 conservan importes anteriores y pedidos históricos; consumidores Mozo y web siguen recibiendo precios efectivos por canal.

Validaciones previas: typecheck y build 11/11; dominio 53, SQLite 158, web 361, licencias 7. E2E nativos de ficha, variantes, edición masiva e historial aprobados; última regresión de combos, listas/asignaciones y precio propio/heredado 3/3. No se ejecutó la suite E2E completa. Corregida inicialización tardía que podía borrar campos al reabrir un combo.

Distribución se registra por separado. No subir instaladores, bases, perfiles, logs o credenciales. El script de la skill commit corresponde a POS Tienda y no debe ejecutarse en Gastronomía. No se modifican servicios POS ajenos.
