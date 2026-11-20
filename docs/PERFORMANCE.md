# Benchmark local reproducible

El comando `pnpm benchmark` crea una base SQLite temporal, carga y confirma 2.500 pedidos
con productos, 1.875 cobros y cierres operativos, mide lecturas reales y elimina
el archivo al terminar. Puede variarse el volumen con
`BENCHMARK_ORDERS=5000 pnpm benchmark`.

## Umbrales

- `bootstrap()` debe completar en menos de 5 segundos;
- el informe detallado del día debe completar en menos de 5 segundos;
- deben persistirse todos los pedidos;
- `bootstrap()` expone sólo los pedidos del turno de caja actual; los turnos
  anteriores permanecen disponibles mediante los informes históricos.

## Resultado de referencia — 2026-08-31

| Métrica                               |  Resultado |
| ------------------------------------- | ---------: |
| Pedidos persistidos                   |      2.500 |
| Pedidos cobrados incluidos en informe |      1.875 |
| Tamaño SQLite                         |   9,88 MiB |
| Carga completa                        | 6.080,7 ms |
| Bootstrap (turno actual)              |    42,2 ms |
| Informe detallado                     |     7,6 ms |
| RSS del proceso                       |  122,1 MiB |

Los tiempos sirven como guardarraíl reproducible, no como certificación del
hardware definitivo del comercio.

## Lecturas agrupadas — 2026-11-15

La [primera etapa de rapidez operativa](qa/OPERATIONAL_SPEED_STAGE1.md) documenta
la carga directa, la caché segura de borradores y las lecturas SQLite por lotes.
Con 2.500 pedidos, dos muestras individuales antes/después del lote de pedidos
registraron 494,9 ms y 187,6 ms para bootstrap; la segunda ejecutó 61 consultas.
No son percentiles ni son comparables directamente con la referencia de agosto.
El informe incluye las limitaciones, la evidencia y las pruebas de equivalencia.

En el entorno Windows actual, el módulo SQLite está compilado para Electron
(ABI 140), no para Node del sistema (ABI 137). Ejecutar el benchmark con ese
runtime, como describe el informe, sin reconstruir el nativo durante pruebas E2E.

## Menú móvil por bloques — 2026-11-15

La [tercera etapa de rapidez](qa/OPERATIONAL_SPEED_STAGE3.md) limita el renderizado
inicial del menú a 100 productos y reutiliza el índice de nombres y los filtros.
El E2E con 1.001 productos verifica búsqueda global, ampliación de bloques,
conservación del borrador y actualización del menú. La comparación de DOM pasa
de 1.000 a 100 filas iniciales en la categoría probada; no mide latencia de red,
renderizado en un teléfono físico ni percentiles de operación.
# Medición repetida local — 2026-11-15

`packages/database/src/benchmark.ts` admite `BENCHMARK_SAMPLES` (5–100; predeterminado 20). Mide lecturas calientes con percentil por rango más cercano; la primera lectura instrumentada se informa por separado.

Ejecución local: Electron 39.8.10 / Node 22.22.1 / ABI140, SQLite temporal de 21,29 MiB, 2.500 pedidos (1.875 pagados), 20 muestras:

| Operación SQLite | P50 | P95 | Máximo |
|---|---:|---:|---:|
| Bootstrap de 2.500 pedidos | 173,2 ms | 181,6 ms | 188,5 ms |
| Informe detallado | 47,9 ms | 54,9 ms | 55,1 ms |

Primera lectura instrumentada: 179,5 ms / 61 consultas. Evidencia: `docs/qa/evidence/release-readiness-20261115/benchmark-2500.json`.

**Alcance:** backend local, proceso caliente y datos sintéticos; excluye renderer, IPC, red y tiempo humano. Había otras pruebas locales concurrentes; no es un benchmark de hardware dedicado ni un SLA. No se calcula un porcentaje de mejora entre estos percentiles y las muestras únicas de etapas anteriores. Falta cronometrar el circuito completo en el equipo/red del negocio.

Para rendimiento de **catálogo** (3.000 productos, no 2.500 pedidos), consultar la [medición de escritorio y Comandas](qa/POS_CATALOGO_3000.md).
