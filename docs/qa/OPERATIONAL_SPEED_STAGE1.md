# Carga directa y lecturas acotadas — primera etapa

Fecha: 2026-11-15. Estado: implementada y validada localmente, sin publicación.

Esta entrega cubre las prioridades 1–2 del análisis de rapidez: reducir pasos al
agregar productos y evitar reconstruir el estado completo para cada edición de
un borrador. No rediseña cliente/cobro, Comandas ni administración del catálogo;
no publica ni genera instaladores. Conserva cambios concurrentes del tutorial.

## Uso

1. Abrir un pedido y buscar un producto simple.
2. Clic o `Enter`: agrega una unidad al precio de la modalidad.
3. Usar **Cantidad y precio** para cantidad especial o precio autorizado.

Variantes, combos y mitades mantienen su selección. Doble clic y tecla sostenida
no reenvían el agregado; se mantiene el bloqueo durante la solicitud, sin retries
automáticos. El error es visible y anunciado; no se borra la búsqueda si falla o
si se escribió otra búsqueda mientras se procesaba el agregado.

## Cambios y límites de seguridad

| Unidad | Cambio | Protección |
| --- | --- | --- |
| Entrada | Producto simple sin diálogo obligatorio | Precio por canal en servidor; PIN para override; opciones complejas conservadas |
| Caché | Aplicar respuesta guardada a orden y total de mesa | Sólo DRAFT sin pagos, turno abierto idéntico, snapshot sin cambios y ninguna lectura/invalidación concurrente |
| Reconciliación | Confirmados, errores, carreras y cache ausente siguen refresco completo | Stock, caja, impresión y operaciones financieras no se derivan en cliente |
| Catálogo SQL | Precios de todos los productos en una consulta | Mismo DTO/listas y orden de precios |
| Pedidos SQL | Mapper común para bootstrap/getOrder, 400 pedidos por lote | Cinco lecturas relacionadas por lote; orden de líneas, pagos/reembolsos y snapshot de cocina preservados |
| Benchmark | Completar configuración inicial de PIN en fixture | Respeta must_change_pin, sin deshabilitar autorización |

La actualización de caché **no es optimista**: se aplica después del commit y sólo
desde el DTO devuelto por el backend. No se elimina la validación del dominio.

## Evidencia y métricas

Dos ejecuciones locales aisladas con 2.500 pedidos y 1.875 cobros:

| Métrica | Referencia previa al lote de pedidos | Lote implementado |
| --- | ---: | ---: |
| Lectura bootstrap | 494,9 ms | 187,6 ms |
| Informe | 48,0 ms | 47,3 ms |
| SQL ejecutadas en bootstrap | No instrumentado | 61 |
| RSS de proceso | 256,5 MiB | 178,7 MiB |

Son muestras individuales, no P50/P95 ni un porcentaje de mejora garantizado.
Hubo carga concurrente distinta y la referencia ya incluía precios en lote.
Los ~102/107 segundos de siembra no representan espera de uso de la interfaz.
Los tiempos no incluyen IPC, render ni impresora. No se usaron datos reales.

Prueba estructural: 1→50 pedidos, +49 productos y +1005 líneas no agregan
consultas; pasar a 405 pedidos agrega sólo cinco lecturas por el segundo lote.
Una orden con 1006 líneas no supera el límite de parámetros SQLite.

Evidencia local en `docs/qa/evidence/operational-speed-20261115/` (directorio
ignorado por Git; no se agregó forzosamente):

- `gastro-bench-before.out` / `gastro-bench-after.out`: muestras del benchmark.
- `gastro-db-focused.out` / `gastro-kitchen-focused.out`: pruebas SQLite.
- `web-unit-final.log`: pasada final de unitarias web.
- `typecheck-build-final.log`: typecheck y build finales del árbol integrado.
- `e2e-quick-add.md`: recibo transcrito de 6/6; no es stdout original.
- `e2e-regression.log`, `e2e-complex.log`, `e2e-selector-recheck.log`: regresión
  y revalidación de selectores que también coincidían con botones de ayuda.
- `quick-add-1366x768.png`: captura inspeccionada, acción secundaria visible sin
  solapamiento y línea agregada directamente.

## Verificación

- `pnpm typecheck`: 11/11 paquetes.
- `pnpm build`: 11/11 paquetes, sin rebuild del módulo nativo.
- `pnpm --filter @gastronomy/web test`: 392/392 pruebas (incluye 7 nuevas de caché).
- SQLite con Electron ABI 140: 146 pruebas aprobadas en bootstrap, combos,
  repositorio y cocina; ver logs de evidencia.
- E2E: **55 escenarios distintos validados** en Electron/harness local: alta,
  foco, teclado, stock, PIN, borradores preservados, catálogo de variantes/combos,
  mitades, cambio de mesa, cliente y cobro/cierre.
  - Alta directa/flechas: 6/6.
  - Regresión de entrada/foco/modalidad/lenguaje: 30/31 en la pasada ampliada.
  - Flujos generales/catálogo/cliente/mitades: 17/18 en la pasada ampliada.
  - Los dos fallos eran selectores parciales que encontraban también botones
    `Ayuda:`; se precisaron por rol/nombre sin quitar expectativas. Revalidación
    focalizada: 3/3 (los dos fallidos y la entrada secundaria mediante Enter).
    Las 55 pruebas tienen resultado aprobado; no se ejecutó toda la suite E2E
    del repositorio ni se ocultan los intentos fallidos en los logs.
- `git diff --check`: sin errores de whitespace.

La instrumentación E2E del IPC confirmó **cero bootstrap adicionales durante tres
altas DRAFT**, refresco al confirmar y al editar confirmados, consumo de stock
correcto y rechazo real de stock insuficiente sin perder cantidad ni búsqueda.

Para SQLite, no ejecutar un rebuild para Node durante E2E: el nativo compartido
usa ABI 140 de Electron y Node del sistema ABI 137. Ejecutar `electron.exe` con
`ELECTRON_RUN_AS_NODE=1`, `--import` del loader tsx y archivo de prueba/benchmark,
mediante `Start-Process -WindowStyle Hidden -Wait` y salida redirigida. Los fixtures
crean y eliminan bases temporales independientes.

## Archivos y rollback por unidad

- Entrada: `components/order-editor.tsx`, tests E2E afectados y guía de atajos.
  Revertir sólo los hunks de carga directa/búsqueda/error de esta entrega.
- Caché: `api.ts`, `order-entry-cache.ts` y `.test.ts`; volver las mutaciones de
  líneas a `useApiMutation` permite retirar esta unidad sin tocar el dominio.
- Lecturas: `sqlite-repository.ts` (listProducts/orderRowsSql/loadOrderDtos/getOrder),
  `bootstrap-performance.test.ts`, `benchmark.ts`. Revertir sólo estos métodos,
  nunca las funciones/migraciones del tutorial ajeno.

No hay migración de datos ni cambio de versión asociado a estas unidades.
