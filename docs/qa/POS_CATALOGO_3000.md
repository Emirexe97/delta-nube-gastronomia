# POS con 3.000 productos

Validación local del 20 de noviembre de 2026. No se cambió la versión ni se generaron instaladores o despliegues.

## Resultados

Windows, Ryzen 9 7900, ~31 GiB de RAM, Electron 39.8.10. Dos perfiles previos y un perfil final sin fotos (3.000 SKU por perfil), más una prueba final mixta independiente. [Mediciones en JSON](evidence/catalogo-3000-20261120/resultados.json).

| Medida | Antes | Ahora, mismo escenario | Ahora, 600 variantes + 1.000 fotos |
|---|---:|---:|---:|
| Apertura de Productos hasta primer layout | 1.306–1.487 ms | 26,9 ms | 30,3 ms |
| Limpiar filtro hasta recuperar filas | 1.435–1.463 ms | 9,7–9,9 ms | No medido |
| Memoria privada de la interfaz en Productos | 653–686 MiB | 78 MiB | 78 MiB |
| Filas de tabla montadas (incluye espaciadores) | 3.000 | 20 | 20 |
| Buscar un código exacto en el pedido, p95 | 67,9–92,7 ms | 1,9 ms | 2,4 ms |
| Agregar un simple al borrador, p95 | 11,0–11,2 ms | 7,0 ms | 7,1 ms |

En el escenario mixto había **3.000 SKU en total**, no 3.000 más las variantes. Las 1.000 fichas de prueba guardaban una imagen WebP sintética de 11.042 bytes cada una; el bootstrap devolvió 1.000 indicaciones de foto y **cero** imágenes. La duplicación con foto se validó aparte en Electron. Catálogo aún realiza una carga de datos inicial: el p95 de bootstrap local + IPC sin fotos pasó de 51,8–57,9 ms a 51,8 ms; la mejora principal proviene de evitar trabajo de interfaz, no de afirmar que SQLite aceleró por ese mismo factor.

## Qué cambia para el comercio

- **Productos:** la tabla dibuja sólo las filas en pantalla y un margen. La búsqueda, la selección total, los filtros y la expansión de variantes siguen trabajando sobre el conjunto completo. La vista previa de operaciones masivas muestra 50 seleccionados por página; la confirmación conserva todos los IDs seleccionados y su autorización.
- **Venta:** se indexan nombres, códigos y variantes al cambiar el catálogo, no al escribir cada letra. Se mantiene el orden de coincidencias, la búsqueda por variantes, las flechas, Enter y la validación transaccional del alta. No se añadió debounce.
- **Fotos:** el arranque trae una indicación de que existe foto, no el WebP. La ficha la obtiene por ID antes de habilitar edición o copia; un error de lectura permite reintentar. Editar otros campos no envía una foto nula ni sobrescribe una foto que cambió mientras la ficha estaba abierta.
- **Comandas:** el teléfono negocia el protocolo nuevo en la lectura de sesión. Un menú pequeño sigue entrando en la respuesta inicial; uno grande se transfiere en páginas de hasta 1.000 productos y 400 KiB de contenido. Los límites del relay, el control de turno/mozo y los recibos no cambian. El teléfono instala un menú completo de una sola versión: si ésta cambia durante la carga, vuelve a empezar una vez, sin mezclar datos ni perder el borrador. Actualizar mesas con la misma carta no vuelve a descargar las páginas; buscar no hace peticiones de red.

Para usar la mejora de **Comandas en producción** deben actualizarse la aplicación de escritorio y el servicio que entrega la página del mozo. Un cliente anterior conserva su comportamiento previo; no se eliminó el límite de 512 KiB para versiones incompatibles.

## Cómo repetir la comprobación

Desde la raíz del proyecto, con las dependencias instaladas y el módulo nativo compilado para **Electron**, no para Node:

```powershell
pnpm build
node scripts/benchmark-pos-catalog.cjs 3000
pnpm exec playwright test tests/e2e/catalog-3000-performance.spec.ts tests/e2e/waiter-paged-menu.spec.ts
```

El benchmark usa una ventana de Electron oculta y un perfil SQLite temporal; no abre la instalación del comercio. Por operación se descarta una muestra de calentamiento y se toman 20. El p95 de búsqueda y alta mide desde el evento hasta el resultado o la línea en el DOM con el layout consultado: **no** incluye el tiempo humano ni la pintura física del monitor. La memoria es la **privada del proceso de interfaz** en Windows, no la RAM de todo Electron. La prueba de escritorio recorre hasta el último artículo con scroll, lo busca y lo agrega a una mesa. Las pruebas de SQLite/relay incluyen envío real por HTTP local y reintento con respuesta perdida sin duplicar una comanda.

## Límites

Los umbrales propuestos se deben repetir sobre la PC mínima del local: abrir y limpiar Productos en menos de 300 ms, búsqueda p95 menor a 50 ms y alta p95 menor a 30 ms. También conviene probar la primera carga y la reconexión en el teléfono y Wi-Fi reales. No son garantías para otros equipos ni una medición de una jornada entera de ventas.
