# Rapidez operativa — ampliación y preparación de entrega

Fecha: 2026-11-15. Alcance local; no publicación ni cambio de versión.

## Importar productos desde Excel/CSV

En **Productos → Importar CSV** (permiso `prices.bulk_update`):

1. Descargar la plantilla. Completar `codigo`, `nombre`, `categoria`, `precio_principal`.
2. Usar el nombre de una categoría **activa existente**, sin coincidencias ambiguas.
3. Desde Excel, guardar como **CSV UTF-8**. Se admiten separadores coma o punto y coma; los campos con separadores/comillas deben estar entrecomillados.
4. Usar precio sin separador de miles, con coma o punto decimal y hasta dos decimales. Ejemplo: `1250,50`.
5. Elegir el archivo y revisar la vista previa. Todas las filas deben ser válidas antes de confirmar.

Límites: **500 productos / 1 MiB** por archivo; código obligatorio de hasta 64 caracteres y nombre de hasta 200. No se admite `.xlsx` directamente. La plantilla tiene BOM UTF-8 para conservar tildes. Se rechaza codificación inválida en lugar de reemplazar caracteres silenciosamente; el parser retiene como máximo el encabezado y 501 filas para detectar exceso sin acumular todos los registros.

### Garantías y límites

- Solo **altas de productos simples**. No sobrescribe precios, códigos, stock ni otros datos existentes. No importa variantes, combos, recetas, imágenes ni costos.
- El precio es el **principal**; los otros precios se derivan con las reglas vigentes, sin crear precios propios por lista.
- Stock inicial **0** si la categoría controla stock; **sin control** (`null`) en caso contrario. No se inventan mínimos/objetivos. Las existencias reales se cargan mediante el flujo autorizado de stock.
- Códigos repetidos (normalizados, sin distinguir mayúsculas) se rechazan en archivo y catálogo, incluso si el producto existente está inactivo.
- Validación de permiso y contrato también en backend. Toda la carga y su recibo se guardan en una transacción; un fallo revierte productos, auditoría y recibo.
- Una respuesta perdida conserva el UUID y las filas originales para **Reintentar mismo lote**. El recibo persistido devuelve los mismos IDs; no vuelve a crear productos. Tras cerrar/reiniciar sin el lote, verificar el catálogo antes de volver a cargar. No cambiar códigos para forzar un reintento.
- Un solo materializado de precios y una sola lectura del catálogo al terminar el lote, en lugar de leer todo el catálogo por cada fila.
- La demo conserva lote/recibo en una única escritura sobre un estado preparado; un fallo de almacenamiento no aplica cambios en memoria.

## Actualización desde el programa

La integración Windows existente busca al iniciar y periódicamente, descarga en segundo plano y ofrece instalación confirmada con caja cerrada. **No está activada en clientes**: falta feed HTTPS definitivo, firma Authenticode y ensayo firmado N→N+1.

Se añadió un preflight local de artefactos y una [lista de activación](WINDOWS_UPDATE_ACTIVATION_CHECKLIST.md). Verifica configuración, metadatos, confinamiento de archivos, tamaño/hash del instalador y firma/editor. Una prueba con un ejecutable firmado del sistema valida el helper de Windows, **no la firma de un instalador del POS**. No sustituye la prueba de hosting ni de actualización.

Las instalaciones con updater deshabilitado necesitan una primera versión compatible; no se promete eliminar esa transición manual. Mac continúa manual y con updater deshabilitado.

## Correcciones detectadas por la regresión

- **Compras y Caja:** contraste insuficiente en textos secundarios; se oscurecieron las etiquetas sin cambiar importes ni cálculos.
- **Editor al 200% de zoom:** con una sola columna, el alto fijo del editor reducía la lista de productos a un scroll de 12 px. La altura pasa a ser dinámica por debajo del breakpoint de dos columnas y las listas conservan entre 160 y 320 px.
- **Encabezado al 200%:** los controles no encogibles dejaban al título «Pedidos» con ancho cero. El encabezado permite varias filas, conserva el título y envuelve los controles sin ocultar el estado o importe de caja.
- **Fixtures:** actualizados selectores ante tarjetas/badges/HelpTip, fecha de negocio, PIN únicos y vínculo QR de mozos. No se eliminaron validaciones financieras o de permisos para obtener resultados verdes. El test de impresión captura HTML mediante un adaptador simulado y no envía trabajos a impresoras físicas.

## Evidencia y pendientes

Evidencia local ignorada por Git: `docs/qa/evidence/release-readiness-20261115/`.

- Web: 404 pruebas aprobadas (incluye 8 parser y 4 demo de importación).
- SQLite: suite completa 323/323 aprobada bajo Electron ABI140, sin rebuild durante las pruebas.
- Shell: 136 pruebas aprobadas (incluye 7 preflight Windows).
- Otros paquetes: dominio 56, licencias 9, servicio de licencias 65, protocolo web 11, servicio de pedidos 54; todos aprobados.
- Typecheck y build finales: 11/11 paquetes aprobados. El build final se ejecutó después de terminar la corrida general, sin reconstruir el addon SQLite.
- Total unitario: **1.058 pruebas**. Sobre el build final se aprobaron **46 E2E distintos**: importación 8, editor 4, resumen/encabezado 1, compras/caja/navegación 14 y operación rápida/controles compartidos 19.
- Importación Electron final: 8/8 aprobadas, incluida respuesta perdida tras commit, lectura asíncrona y rechazo Latin-1 sin importar datos. Captura de vista previa a 1100 px sin desbordamiento. Evidencia `catalog-import-final/` y `catalog-import-final.log`.
- Medición repetida SQLite: [20 muestras con 2.500 pedidos](../PERFORMANCE.md); bootstrap P50 173,2 ms / P95 181,6 ms. No es latencia del circuito UI/red.
- E2E amplio: **498 casos seleccionados**, 412 aprobados, 84 fallidos y 2 omitidos intencionalmente (IA live/cuotas); 0 flaky. Duración 1 h 51 min. Los 84 fallos se agrupan en 25 specs y se contrastan con las repeticiones focalizadas de abajo; esta corrida general por sí sola **no fue verde**.
- Hubo además dos errores de teardown de workers: diálogo nativo de impresión en el fixture anterior de `cash-shipping-breakdown` y diálogo abierto por el selector ambiguo de `purchases-workflow`. Ambos fixtures se corrigieron y sus repeticiones completas terminaron sin ese error. No se descartan silenciosamente del resultado original.
- `licensing-packaged.spec.ts` (2 casos) quedó excluido de esta corrida porque reconstruye dependencias nativas; importación (8 casos) se ejecuta por separado. Las 2 omisiones IA no equivalen a validación del proveedor real/cuotas. No hubo publicación ni actualización binaria firmada.
- La primera corrida E2E se invalidó por un rebuild nativo concurrente accidental (el filtro recursivo incluyó el paquete raíz). No es evidencia de fallos del producto. Se restauró ABI140 y verificó SQLite real bajo Electron antes de repetir.
- Cinco fixtures de compras (dos web, tres SQLite) usaban fecha UTC para un informe por fecha de negocio; corregidos sin cambiar cálculos de producción ni debilitar assertions. El helper que simula esquemas anteriores ahora elimina también la tabla del tutorial al retroceder a versiones previas a 51; no se cambió la migración real.
- La regresión de etiquetas de caja usaba el encabezado de una tarjeta en vez de la tarjeta completa; selector corregido conservando importes/aclaraciones/overflow. 13/13 pruebas focalizadas aprobadas.
- Los **84 fallos iniciales quedaron cubiertos por repeticiones aprobadas**. Cobertura acumulada: 496 escenarios de la corrida general más los 8 nuevos de importación; no equivale a otra ejecución general completa sobre el último build. Los logs originales se conservan.

### Trazabilidad de fallos y repeticiones

Todos los paths de evidencia siguientes son relativos al directorio de evidencia local indicado arriba. No sumar las repeticiones como escenarios únicos adicionales de la suite general.

| Spec(s) | Fallos iniciales | Repetición completa / evidencia |
| --- | ---: | --- |
| cash-float-labels | 10 | 13/13, `cash-float-rerun/` |
| cash-shipping-breakdown | 4 | 4/4, `cash-shipping-rerun/` |
| catalog-purchases-readability | 3 | 5/5 final, `final-layout/` |
| customer-modality-recovery + customer-workflows | 3 | 4/4, `customer-rerun/` |
| demo-reset-browser | 1 | 2/2, `demo-reset-rerun/` |
| finance-cash-readability | 2 | 6/6 final, `final-layout/` |
| finance-cost-filters | 1 | 12/12, `finance-cost-rerun/` |
| floor-controls-accessibility | 3 | 3/3, `e2e-rerun/floor-controls-accessibility/` |
| navigation-frame-readability | 1 | 3/3 final, `final-layout/` |
| open-order-labels | 18 | 18/18, `open-order-labels-rerun/` |
| order-editor-readability | 1 | 4/4 final, `final-editor/`; opción Doble completamente visible (ratio 1) a 1100 y 1366 px con zoom 200% |
| order-filter-accessibility | 1 | 2/2, `order-filter-rerun/` |
| orders-list-readability | 2 | 2/2, `orders-list-rerun/` |
| purchases-historical-scope + purchases-workflow | 2 | 5/5, `purchases-rerun/` |
| report-tables-layout | 1 | 2/2, `report-tables-rerun/` |
| sales-labels | 18 | 18/18, `sales-labels-rerun/` |
| salon-plan-readability | 2 | 4/4, `salon-plan-readability-rerun/` |
| secondary-text-readability | 2 | 3/3, `secondary-text-rerun/` |
| shared-controls-readability | 5 | 8/8 final dentro de 19/19 operativas, `final-operational.log` y `final-operational.json` |
| shared-visual-style | 1 | 2/2, `shared-visual-rerun/` |
| summary-table-layout | 1 | 1/1 final, `summary-table-rerun/`, `summary-table-final-stable.log`; captura posterior a la animación |
| user-permission-descriptions | 1 | 2/2, `user-permission-rerun/` |
| visual-harmony | 1 | 1/1, `visual-harmony-rerun/` |

### Incidente de limpieza QA

Al terminar `final-layout`, un intento de detener procesos de un perfil temporal ya eliminado cerró **15 procesos `cmd.exe` fuera del alcance previsto**. `Resolve-Path` produjo un error no terminante; el filtro posterior recibió una ruta nula y coincidió con todos los launchers. El comando no borró archivos, pero pudo interrumpir terminales o comandos ajenos. No se conservaron sus líneas de comando y no se puede afirmar que fueran inocuos ni reconstruir esas sesiones. Se detuvo la limpieza y se informó al usuario; no se reiniciaron comandos desconocidos. Los logs finales 14/14 y 19/19, el JSON operativo y `git diff --check` se verificaron después del incidente. Antes de cualquier futura limpieza de procesos: resolver con `-ErrorAction Stop`, exigir ruta no nula y perfil existente, verificar PID/árbol propio y abortar ante cualquier discrepancia; preferir cierre por handle de la app de prueba.

No confundir pruebas locales con operación real en teléfono, impresora y red del negocio. Pendientes de aceptación: carga rápida → comanda → cocina → cobro → cierre, con el equipo y volumen reales; actualización firmada conservando datos/licencia.
