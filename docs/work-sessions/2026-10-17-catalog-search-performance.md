# 2026-10-17 — Demora al buscar en la tabla de productos

El usuario informó trabas al buscar en Productos. Se investigó sin navegar en la aplicación operativa ni modificar su base. La versión instalada continúa siendo 0.1.26; no se autorizó una nueva versión o instalación para esta corrección.

## Hallazgo y cambio

- La consulta es estado local: no dispara una búsqueda IPC ni una consulta de costos por cada letra. No se encontró una clave inestable que remonte el campo.
- Cada tecla volvía a construir las filas y a formatear dos precios y el stock por producto visible. `formatMoney` construye un `Intl.NumberFormat` por llamada, por lo que repetirlo en toda la tabla tiene un costo apreciable.
- Reproducción con el bundle de producción anterior y 260 productos sintéticos: 4.822 construcciones de formateadores al escribir 12 caracteres, una sola consulta de costos, y aproximadamente 100–150 ms por tecla durante los prefijos amplios con CPU ralentizada 4 veces. La mediana fue de unos 103 ms.
- `CatalogPage` prepara los precios y el stock visibles en un `useMemo` dependiente de `data.products`. La búsqueda reutiliza esos valores; cuando el bootstrap actualiza los productos se vuelve a preparar la presentación. Se conservan los importes, formatos, filtros, agrupación de variantes y selección.
- En la prueba actualizada, con una variante incluida, no se construyen formateadores monetarios durante la escritura. La mediana observada bajó a unos 24–28 ms. Hubo picos iniciales de 283–421 ms en las ejecuciones bajo carga/CPU ralentizada; no se afirma que esta corrección elimine todas las causas posibles de demora. La tabla sigue renderizando sus filas y expandiendo variantes coincidentes.

## Verificación y entrega

- Unitarias de catálogo y filtros: 12/12 aprobadas.
- Nueva prueba browser sobre el bundle de producción: foco y texto de búsqueda conservados, búsqueda por nombre/código, resultados vacíos y limpieza, variantes, precios y stock, selección conservada al filtrar y ausencia de cientos de formateadores por tecla. Aprobada.
- Build web aprobado, incluido `tsc --noEmit`. Las mediciones y el mock usan datos sintéticos y un servidor local temporal; no usan ni escriben en SQLite de producción.
- Sin commit, push, cambio de versión, instalador ni actualización del programa operativo. Corrección preparada en el árbol de trabajo para una entrega posterior.

## Entrega solicitada

Posteriormente el usuario autorizó expresamente la versión 0.1.27, commit/push, instaladores Windows/Mac, publicación y actualización de esta PC manteniendo la caja abierta y todos los datos. El seguimiento de esa entrega se registra en [la sesión de release 0.1.27](2026-10-17-release-0-1-27-busqueda-productos.md).
