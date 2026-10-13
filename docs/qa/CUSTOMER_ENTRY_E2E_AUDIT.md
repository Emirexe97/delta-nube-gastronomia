# Cargar el cliente del pedido sin ambigüedades

Fecha: 2026-10-13. Alcance: cliente en creación/edición de pedidos para retirar y con envío. Cambios anteriores del ticket de cierre se conservan.

## Cambios y límites

| Hallazgo                                                                                         | Corrección                                                                                                          | Estado   |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | -------- |
| Buscar, crear ficha y datos del pedido se mezclan; el buscador sigue visible después de elegir   | Cliente elegido en tarjeta; reemplazo explícito con Cambiar cliente. Carga manual y guardar ficha siguen opcionales | Validado |
| Tab acepta una coincidencia durante la búsqueda sin elección explícita                           | Tab navega; clic/Enter seleccionan. Respuestas tardías no reemplazan otra selección                                 | Validado |
| Retiro muestra dirección innecesaria                                                             | Dirección sólo en envío; alternar modalidad conserva los datos localmente                                           | Validado |
| Dirección personalizada no tiene representación en el selector guardado                          | Selector antes del editor, opción Otra dirección para este pedido e ID coherente                                    | Validado |
| Crear cliente habilita el envío con nombre/teléfono demasiado cortos pero el submit no hace nada | Validación consistente con feedback y bloqueo durante guardado                                                      | Validado |
| La ficha se recupera por un teléfono que puede haber sido editado                                | Recuperación por ID con reintento, sin sobrescribir datos actuales del pedido                                       | Validado |
| Salir durante la búsqueda descarta una respuesta y la misma consulta no se recupera              | Reenfocar busca nuevamente; respuestas pendientes no seleccionan tras Tab                                           | Validado |
| Tarifa inválida de envío bloquea crear ficha en retiro aunque el campo esté oculto               | En retiro no se exige ni se valida esa tarifa; la ficha puede guardarse                                             | Validado |

No se cambian contratos, bases, reglas de cobro, tarifas ni la opción Cargar productos primero. Los datos manuales no crean una ficha; guardar una ficha es una acción explícita e independiente de crear el pedido.

**Persistencia vigente:** nombre y teléfono editados son datos del pedido. Una entrega con dirección guardada recuerda su costo como tarifa habitual al crear o editar normalmente; una conversión de modalidad no cambia esa tarifa. Se aclara la regla existente, no se agrega ni elimina esa persistencia.

## Validación

Pruebas nuevas y regresiones: carga manual, búsqueda por teclado, cliente guardado, edición de datos, direcciones personalizadas, ida/vuelta entre modalidades, crear/cancelar ficha, fallas de búsqueda e hidratación, controles en 1100/1366 y zoom 200%, productos primero y pedidos persistidos.

### Resultados finales

- **38 escenarios E2E distintos validados** sobre el build final: la regresión seleccionada tuvo 33/35 verdes; dos expectativas de texto antiguo de cliente seleccionado se adaptaron a la tarjeta. La pasada final adicional pasó **6/6** (esas dos regresiones, tres escenarios no incluidos por el filtro y una repetición reforzada de ficha tardía). No sumar repeticiones como escenarios nuevos ni presentar esto como la suite integral.
- Diez casos nuevos cubren carga manual, selección explícita, Tab mientras hay una búsqueda pendiente, recuperación al reenfocar, snapshots, dirección personalizada, cancelación, alta validada, tarifa oculta y errores. La ficha tardía se libera explícitamente y se espera su actualización de opciones antes de comprobar que no sobrescribió nombre/teléfono/dirección/costo.
- Web: **282/282**, 26 archivos. Typecheck y build: **7/7** cada uno. Diff-check y formato focalizado sin errores. Advertencia previa de bundle Vite >500 kB continúa sin bloquear build.
- Revisión visual de capturas nativas: retiro sin dirección, tarjeta guardada y datos del pedido diferenciados, búsqueda/botón alineados en 1100/1366 y controles alcanzables con desplazamiento interno al 200%. No afirmar que todo el formulario cabe simultáneamente.
- Regresiones incluyen productos primero, horarios, modalidades, pedidos cobrados/PIN, devoluciones, caja, stock y rendiciones. El recorrido de dirección registrada verifica que la tarifa habitual continúa actualizándose como antes.

Durante la integración se corrigieron expectativas obsoletas, un locator ambiguo por el hint del costo, confirmación de descarte no aceptada por un test, reapertura de lista tras Escape y assertions escalares aplicadas a listas de opciones. No se relajaron las protecciones del producto para hacer pasar esas pruebas.

Evidencia nueva en `test-results/` y `test-results/customer-entry-final-extra/` (local/ignorada); no se sobrescribe evidencia histórica del selector. Las regresiones antiguas conservan sus destinos habituales. Perfiles temporales Electron/SQLite, sin datos reales ni impresión física. Sin commit, push, cambio de versión ni instalador; se preservan los cambios anteriores del ticket de cierre.
