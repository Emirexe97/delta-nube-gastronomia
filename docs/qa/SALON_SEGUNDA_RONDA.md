# Salón lleno: segunda ronda y apertura de mesa

Prueba local del 20/11/2026 en Electron y SQLite, con perfil descartable. El catálogo tiene 3.000 productos; hay 120 mesas confirmadas de tres renglones cada una y dos mesas libres. No requiere una caja real.

| Recorrido normal | Antes | Ahora |
| --- | --- | --- |
| Agregar un producto simple al pedido confirmado | Se guarda la línea y se relee todo el POS | Se guarda una vez y se consultan el pedido, el stock y la mesa afectados |
| Abrir por número una mesa ocupada | Se busca entre todas las mesas y se relee todo el POS | Se consulta esa mesa; si la vista sigue vigente, se abre el pedido sin recarga general |
| Abrir por número una mesa libre y asignarle mozo | Dos recargas generales | Se consultan y aplican sólo la mesa y el pedido confirmados por la base |
| Abrir el editor | Se preparaban el selector de mitades y el de cambio de mesa aunque estuvieran cerrados | Se preparan al abrirlos; el buscador recibe el foco sin esperar un temporizador fijo |

Una edición externa, un cambio de caja, una lectura puntual fallida o una respuesta cuya revisión no coincide conserva la recarga completa. Nunca se vuelve a enviar la venta por un error al actualizar la pantalla. La ruta optimizada de segunda ronda es la de producto simple; otras ediciones mantienen sus controles existentes.

Al actualizar stock también cambia la referencia al catálogo. Por eso Carga rápida sólo ordena los productos cuando muestra el paso de productos, y el editor reutiliza el texto de búsqueda de los productos que no cambiaron. Con stock controlado, agregar un producto a una mesa confirmada y verlo en el pedido tomó **71 ms** de mediana en el escenario final (cinco muestras después de una de calentamiento, CPU del renderer ×4). No es una medición de una PC ni de una impresora física.

Comparación con la auditoría, usando la misma carga sintética (productos agregados sin stock controlado), ventana y ralentización:

| Desde la acción hasta ver el cambio en pantalla¹ | Antes | Después |
| --- | ---: | ---: |
| Agregar producto a una mesa confirmada | 253,5 ms | 61,7 ms |
| Abrir mesa ocupada con clic | 316,1 ms | 167,8 ms |
| Abrir mesa ocupada por número + Enter | 311,5 ms | 261,4 ms |

¹ La medición termina cuando aparece el renglón o el buscador en el DOM y se lee su geometría; no mide el instante de presentación física de la imagen.

## Regresión

```sh
pnpm build
pnpm exec playwright test tests/e2e/peak-salon.spec.ts
```

- Se imprime la comanda original, se marca servida la mesa y se agrega una unidad de otro producto desde el editor. El stock pasa de 8 a 7 y la mesa vuelve a quedar pendiente de servicio.
- El controlador simulado captura el texto real enviado a imprimir. En el segundo ticket aparece el agregado y no aparece ninguno de los tres productos originales. SQLite registra exactamente dos trabajos exitosos: original y agregado.
- Se recorren por teclado una mesa ocupada y otra libre sin recargar el POS. Dos solicitudes simultáneas, con distintos mozos, compiten por la misma mesa libre: se guarda sólo el pedido del ganador; el otro recibe el error de mesa ocupada.
- Las pruebas de SQLite también cubren el reenvío de la misma clave de carga (sin segundo descuento) y dos sesiones de mozo que habían leído la misma mesa como libre (sin mezclar sus tandas).
