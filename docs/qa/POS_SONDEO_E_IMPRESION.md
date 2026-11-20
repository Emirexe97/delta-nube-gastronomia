# POS con 3.000 productos: sincronización e informe de caja

## Qué cambia para el comercio

El POS sigue consultando pedidos web cada 15 segundos. Si no cambió el catálogo, lee una revisión de SQLite en vez de consultar los productos, armar JSON y calcular una huella. Si la revisión cambió pero el catálogo público quedó idéntico, no lo vuelve a enviar. Una restauración, una nueva configuración o una publicación con respuesta incierta requieren verificar o reenviar el catálogo; no se pierde el reintento. Sin tienda configurada el sondeo no abre la base.

Al imprimir un informe de caja se consulta la configuración de impresión una sola vez, después de obtener el informe con sus controles de permisos. No cambian el contenido, el formato del papel, la impresora ni las copias.

## Prueba reproducible

Ejecutar desde la raíz en Windows, con dependencias instaladas y SQLite preparado para la ABI de Electron. No se usa la base instalada, ninguna impresora real ni un servicio de pedidos externo.

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
try {
  & '.\apps\desktop-shell\node_modules\electron\dist\electron.exe' scripts/benchmark-idle-web-catalog.cjs | Out-Host
} finally { Remove-Item Env:\ELECTRON_RUN_AS_NODE }
```

El script usa SQLite en memoria, el repositorio y el conector reales, y un cliente de red simulado. Crea 3.000 productos publicados, comprueba que después de la primera publicación haya **65 consultas de pedidos sin otra reconstrucción del catálogo**, y vende la última unidad por el flujo de comanda para verificar que se retire de la tienda en el siguiente sondeo. Para cada operación informa mediana y p95 sobre 60 muestras tras cinco de calentamiento.

Resultados de referencia (Ryzen 9 7900, Windows, Electron 39.8.10):

| Trabajo local | Mediana | p95 |
|---|---:|---:|
| Construir catálogo y calcular huella (comprobación anterior) | 6,929 ms | 8,944 ms |
| Consultar revisión (comprobación nueva) | 0,004 ms | 0,009 ms |
| Sondeo completo sin cambios, con red simulada | 0,017 ms | 0,032 ms |
| Dos cargas del estado general para leer ajustes del informe | 25,932 ms | 30,506 ms |
| Una consulta de configuración para el mismo informe | 0,008 ms | 0,011 ms |

Estas son mediciones de trabajo local; no representan la latencia de internet, la duración de una impresión física ni la velocidad garantizada en una PC básica. Para comprobar la experiencia del comercio, medir desde pulsar un producto hasta verlo en la comanda en el equipo mínimo mientras la tienda consulta pedidos.
