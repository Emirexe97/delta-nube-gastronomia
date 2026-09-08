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
