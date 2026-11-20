# Atajos de teclado

| Atajo               | Acción                                      |
| ------------------- | ------------------------------------------- |
| `F2`                | Ir a Salón                                  |
| `F3`                | Nuevo pedido para retirar                   |
| `F4`                | Nuevo envío                                 |
| `F6`                | Buscar pedido                               |
| `Ctrl+P`            | Productos                                   |
| `Enter`             | Confirmar formularios / abrir fila enfocada |
| `Escape`            | Cerrar modal                                |
| `Tab` / `Shift+Tab` | Recorrer controles                          |

En **Salón**, la carga rápida avanza con `Tab` entre número de mesa, número de
mozo y nombre de mozo; número y nombre se sincronizan en ambos sentidos. Luego,
`Enter` permite cargar cantidad y código o nombre de producto. La mesa se crea si no existe; el
código/ID y el nombre completan automáticamente el producto y su precio de
salón. Después de agregar una línea, el foco vuelve a Cantidad.

En el **editor de pedido**, escribir un código o nombre y pulsar `Enter` agrega
una unidad del producto simple seleccionado al precio de su canal, sin abrir
otra ventana. Las flechas cambian la selección; también se puede tocar la tarjeta.
Para ingresar otra cantidad o un precio manual, usar **Cantidad y precio** debajo
del producto. Cambiar el precio mantiene la autorización por PIN. Las variantes,
combos y pizzas mitad y mitad conservan sus selectores.

Después de guardar, el foco vuelve al buscador; si ya se escribió la siguiente
búsqueda mientras se guardaba, ese texto no se borra. Un error conserva la carga
y muestra el motivo. No hay reintentos automáticos del agregado.

El editor de pedido enfoca el buscador al abrirse. Los atajos no se disparan en
acciones destructivas; cancelación siempre requiere motivo y PIN.

En retiro/envío sin pagos, **Cliente y envío** abre los datos dentro del mismo
pedido. **Guardar datos** vuelve a productos conservando la búsqueda; **Volver a
productos** permite descartar los cambios con confirmación. F6/F7/F8 no ejecutan
acciones del pedido mientras se editan estos datos. `Tab` omite los controles
deshabilitados y el cierre queda bloqueado durante el guardado.

En el cobro, elegir un medio asigna el saldo completo sin cobrar todavía.
**Pago mixto** despliega la división entre medios. `Enter` confirma únicamente
cuando se cumplen las validaciones; el importe y el vuelto siguen visibles.

En **Productos**, la ficha de un producto base sin variantes ni combo ofrece
**Duplicar producto**: abre una copia para revisar, sin código ni existencias.
En altas nuevas, **Guardar y crear otro** conserva la categoría, limpia los datos
del siguiente producto y vuelve a enfocar Nombre. El control de stock se toma de
la categoría. **Guardar producto** guarda y cierra; un error mantiene el formulario.

En **Comandas móvil**, **+** agrega directamente una unidad entera. **Nota**
personaliza una unidad pendiente sin duplicarla y **Mitad y mitad** abre su
selector específico. El menú muestra 100 productos por bloque; **Mostrar más**
amplía la lista y el buscador encuentra productos de todo el catálogo.
