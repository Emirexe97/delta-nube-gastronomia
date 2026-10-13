# Plano por sectores: mesas compactas y separadas

Fecha: 2026-10-13. Solicitud: mesas demasiado grandes y superposición cuando aumenta la cantidad.

## Corrección

- Las altas desde el plano usan 108×108 px; rectangulares, 144×108. Las medidas normalizadas se derivan del mismo tamaño, sin mezclar 7×7% con 126×126 px.
- Colocación calculada según ancho/alto reales y separación. Si no hay espacio, no se crea la mesa ni se usa una posición superpuesta como alternativa.
- La vista empieza ajustada al área; al alejar, los nodos muestran número y estado legibles, con detalle en título y al abrir/acercar. El contenido no sobresale del nodo.
- En edición, las propiedades pasan debajo del plano hasta 1280 px de ventana; en pantallas más amplias quedan al costado. Se quitó el rótulo flotante redundante que podía tapar nodos.
- **Editar plano → Ordenar mesas** ofrece compactar y distribuir el sector por número, evitando figuras. Requiere confirmación: reemplaza posición/tamaño, no números, nombres, formas, IDs ni pedidos. Cancelar/Escape no escriben.
- No se cambia automáticamente una disposición guardada. Los tamaños legacy pueden ser 252×204 px; una coincidencia con esos tamaños no permite saber si el usuario los personalizó.

## Hallazgos y límites

| ID     | Hallazgo                                                        | Corrección                                                     | Estado   |
| ------ | --------------------------------------------------------------- | -------------------------------------------------------------- | -------- |
| FP-D01 | Tamaños legacy grandes y defaults UI inconsistentes             | Altas compactas, vista general y compactación voluntaria       | Validado |
| FP-D02 | Escaneo fijo y fallback escalonado superpuesto                  | Grilla dimension-aware y resultado sin espacio, antes del alta | Validado |
| FP-D03 | Sectores numerosos/cerrados sin recuperación visible            | Confirmación, capacidad explícita y error contextual de alta   | Validado |
| FP-D04 | Ordenación masiva puede fallar después de guardar algunas mesas | Conteo de avance, refetch y reintento; sin falso éxito total   | Validado |
| FP-D05 | Propiedades laterales recortaban el canvas a 1100 px            | Panel debajo hasta xl; comprobación de encuadre horizontal     | Validado |

Las figuras se preservan y sus cajas se tratan como obstáculos, incluso para polígonos/líneas. Es conservador: no calcula huecos internos de polígonos. Un sector lleno requiere mover/reducir figuras o distribuir mesas en otro sector. No se amplía el canvas ni se inventa espacio ilimitado.

Ordenar usa actualizaciones individuales del API existente, **no una transacción masiva**. Un fallo posterior informa cuántas se guardaron y permite reintentar. No afirmar rollback total. Se preservan reglas/permisos del backend y mínimos de tamaño. No cambian contratos, esquema SQLite, reglas económicas ni el alta directa de mesas fuera del plano.

## Validación

Fixtures temporales Electron/SQLite: 60 mesas grandes superpuestas, columna/figura, mesa con pedido confirmado; comparación de pedidos completos, caja, stock, IDs, nombres, formas y figuras. Geometría y cajas DOM en 1100/1366, persistencia tras recargar, cancelación, ocho altas con números mayores de 100, sector totalmente bloqueado y error IPC en tercera actualización/reintento. Prueba de geometría adicional coloca 110 mesas compactas sin solapes: no confundirla con 110 altas E2E.

### Resultados finales

- `corepack pnpm --filter @gastronomy/web test`: **286/286**, 26 archivos; geometría **23/23** incluida. Colocación de 110 mesas es prueba unitaria, no 110 altas de Electron.
- `corepack pnpm typecheck` y `corepack pnpm build`: **7/7** paquetes cada uno, después del ajuste responsive. Advertencia existente de chunk Vite mayor de 500 kB, sin error.
- **21 escenarios E2E distintos validados** en siete specs: pasada focal/regresión **20/21 en 8,4 min**, seguida de **3/3 en 1,4 min** del spec corregido (dos repetidos, uno pendiente). No sumar repeticiones. Los cinco nuevos de densidad pasan, igual que zoom, vector, accesibilidad al 200%, filtro ocupadas y Lista/servicio. El fallo restante era del propio test al consultar `window` fuera del renderer; corregido. No es un fallo de datos/producto ni una pasada integral.
- Revisión adicional sólo lectura sin hallazgos accionables; integración y validación final a cargo del agente raíz.
- Capturas nativas finales de 60 mesas inspeccionadas en **1100/1366**: números/estados legibles, columna preservada, canvas dentro del viewport horizontal y ausencia de solapes. A 1100 el panel queda debajo; a 1366 al costado. Desplazamiento vertical de página sigue disponible; no prometer que controles, plano y propiedades caben simultáneamente en cualquier tamaño/zoom.

Los primeros cinco fallos fueron de fixtures con bootstrap cacheado, corregidos con recarga. Dos expectativas antiguas de zoom suponían inicio al 100%; ahora restablecen explícitamente antes de medir incrementos, mientras el spec de zoom verifica autoajuste inicial. La figura de regresión se desplaza con su nodo en viewport y se espera persistencia desde el renderer, no coordenadas fuera de pantalla ni lectura prematura.

Evidencia local nueva: `test-results/floor-density-verified/` (capturas y pasada 20/21), `test-results/floor-density-regression-final/` (3/3), `test-results/floor-density-web-final.log`. Los specs anteriores de accesibilidad también usan su destino histórico de capturas bajo `docs/qa/evidence/`. Evidencia generada ignorada por Git. No impresión física ni datos reales. Cambios previos de clientes/ticket preservados. Sin commit, push, cambio de versión ni instalador.
