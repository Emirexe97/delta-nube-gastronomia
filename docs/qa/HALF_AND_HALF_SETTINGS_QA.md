# Configuración de pizzas mitad y mitad

Fecha: 2026-10-16. Cambio local sobre 0.1.24; sin publicación ni instalador.

## Alcance y comportamiento

- Configuración → General → **Habilitar pizzas mitad y mitad**, luego **Guardar configuración**.
- Desmarcar impide agregar combinaciones nuevas; no modifica líneas, mitades, precios ni totales de pedidos existentes.
- La tarjeta del catálogo desaparece; el botón inferior queda deshabilitado. F6, los alias de búsqueda y el modal también respetan la opción.
- El servidor SQLite y la API demo rechazan el alta aunque se invoque directamente.
- Se conserva la regla de precio elegida al apagar y volver a encender la función.
- `halfAndHalfEnabled?: boolean`: ausencia legada equivale a `true`. Se usa el JSON de configuración existente, sin migración de esquema.
- Permisos: se conserva el flujo existente de `saveSettings` / `settings.manage`; no se agrega otro canal de escritura.

## Cobertura

| Caso                                                     | Evidencia                                           |
| -------------------------------------------------------- | --------------------------------------------------- |
| Predeterminado habilitado y perfiles legados             | Dominio, SQLite y demo                              |
| Validación: sólo booleano si se informa                  | Dominio, incluidos null/string/número rechazados    |
| Alta denegada sin cambios en pedido/auditoría            | SQLite; demo y Electron verifican pedido intacto    |
| Productos comunes y mitades anteriores preservados       | SQLite y demo                                       |
| Deshabilitado persiste al reiniciar                      | Electron con mismo perfil temporal y demo recargada |
| Checkbox, precio deshabilitado y modo retenido           | Electron UI real                                    |
| Botón, tarjeta, F6 y alias mitad/media/mm/mym bloqueados | Electron UI real                                    |
| Reactivar y agregar combinación desde interfaz           | Electron UI real                                    |

Tests nuevos:

- `packages/domain/src/settings.test.ts`
- `packages/database/src/half-and-half-settings.test.ts`
- `apps/gastronomy-web/src/demo/half-and-half-settings.test.ts`
- `tests/e2e/half-and-half-settings.spec.ts`

## Validación ejecutada

- `pnpm test`: 9/9 tareas; dominio29, SQLite223, web291, shell49, protocolo7 y servicio14, sin fallos.
- `pnpm typecheck`: 9/9.
- `pnpm build`: 9/9. Advertencia no bloqueante de bundle web mayor a 500kB.
- `pnpm exec playwright test tests/e2e/half-and-half-settings.spec.ts`: 1/1, con reinicio real Electron y perfil aislado descartable.
- Tras ajustes finales de formato y tipos de fixtures: dominio29/29, demo focal5/5 y typecheck/build9/9 nuevamente.
- `pnpm exec playwright test tests/e2e/half-and-half-settings.spec.ts tests/e2e/desktop-flow.spec.ts --grep 'settings persist|protege modales anidados'`: 2/2. Repite el viaje nuevo sobre el build final y verifica la regresión existente de modales/atajos.

Primer intento E2E: falló únicamente el locator exacto del select, porque su nombre accesible incluye el texto de las opciones. Corregido a `combobox` con nombre por prefijo; ejecución posterior completa aprobada, sin alterar el producto para acomodar la prueba.

Capturas generadas por el spec en `test-results/half-and-half-settings-*/`: `half-disabled-settings.png`, `half-disabled-order.png`, `half-reenabled-order.png`. Carpeta de ejecución ignorada por Git; capturas revisadas localmente.

## Límites y reversión

No se ejecutó la suite E2E integral ni un instalador Mac. No se modificaron datos de clientes, licencias ni la lógica de rendiciones.

Reversión operativa: marcar nuevamente la opción y guardar. Reversión de fuente: retirar el bloque de cambios de esta función (contrato, defaults, validación, guardas, UI/demo y tests/docs asociados); no hay migración a deshacer ni datos históricos transformados.

Los tests Node de SQLite reconstruyen el módulo nativo para Node; antes de Electron ejecutar `pnpm --filter @gastronomy/desktop-shell rebuild:native`. No correr ambas clases de prueba en paralelo.
