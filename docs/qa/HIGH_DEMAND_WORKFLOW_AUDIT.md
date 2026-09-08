# Auditoría de flujos bajo alta demanda y error humano

Fecha: 2026-09-01  
Modo: auditoría original, corrección y segunda pasada de regresión.  
Entornos: demo local `http://127.0.0.1:5173`, Chromium aislado, SQLite temporal e inspección de contratos, dominio, adaptadores y pruebas.

## Objetivo

Evaluar si el sistema permite operar y recuperarse con seguridad cuando el local
está bajo presión: entradas rápidas, doble clic o doble tecla, datos equivocados,
operaciones interrumpidas, impresora fuera de servicio, múltiples cajas y colas
largas. La prueba no se limitó a comprobar el camino feliz: después de cada error
se intentó corregirlo usando solamente las opciones disponibles en la interfaz.

Cuatro auditorías independientes cubrieron:

1. Salón, carga rápida, pedidos para retirar y envíos.
2. Caja, cobros, devoluciones, cierre y rendiciones.
3. Clientes, catálogo, lotes, stock e impresión.
4. Teclado, foco, modales, latencia, navegación y recuperación transversal.

Los hallazgos se clasifican así:

- **Reproducido:** ocurrió en UI local o en una base SQLite temporal.
- **Verificado por código:** la ruta está determinada por contratos/repositorio,
  aunque falte una prueba UI específica.
- **Brecha:** capacidad operativa o cobertura que todavía no existe.
- **Decisión:** requiere fijar una política del negocio antes de implementar.

## Dictamen ejecutivo

Las correcciones cerraron los bloqueos de una sola terminal: los activos ya no
desaparecen por la ventana histórica, la configuración local fuerza una caja,
los modales forman una pila, cobros y rendiciones tienen guardas de efectivo y la
impresión sólo se contabiliza después del resultado físico. La demo conserva
atomicidad de lotes y actualiza el estado de pago igual que SQLite.

**La versión es apta para continuar una prueba intensiva local de una terminal,
pero todavía no está validada para varias terminales ni para una impresora física
específica.** Quedan como riesgos estructurales las claves de idempotencia ante
respuesta IPC perdida, los contramovimientos de rendiciones/caja, paginación real
de directorios y la integración térmica RAW/ESC-POS dependiente del hardware.

## Estado de corrección al 2026-09-01

| Bloque                  | Estado               | Corrección verificada                                                                                                                                                                                                                |
| ----------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HD-001 a HD-002         | Corregido local      | Una sola caja forzada y `bootstrap` expone todos los pedidos del turno actual sin mezclar turnos históricos.                                                                                                                         |
| HD-003 a HD-004         | Corregido            | Pila real de modales, sólo el superior responde a Escape, confirmación de descarte y bloqueo durante mutaciones.                                                                                                                     |
| HD-005 a HD-006         | Corregido            | Contador posterior al éxito físico, fallas no resueltas preservadas y recuperación manual de `FAILED` o `QUEUED` estancado.                                                                                                          |
| HD-007 a HD-008         | Corregido local      | Rendiciones por repartidor con detalle, validación transaccional y cierre normal bloqueado; el forzado audita pendientes y saldos.                                                                                                   |
| HD-009                  | Pendiente            | Falta `idempotencyKey` persistente para reintentos ambiguos de movimientos/IPC.                                                                                                                                                      |
| HD-010                  | Corregido            | Operación masiva demo valida todo antes de mutar y revierte el lote completo.                                                                                                                                                        |
| HD-011 a HD-021         | Corregido o mitigado | Bloqueo síncrono de doble alta, selector coherente, atajos contextuales, F8/Enter, errores locales, quitar visible, urgencia, estados y repartidor reasignable. La reasignación completa de mesa/mozo post-confirmación sigue en P2. |
| HD-022                  | Parcial              | Selección oculta ahora permanece visible y compacta; falta contralote/reversión auditable.                                                                                                                                           |
| HD-023 a HD-024         | Corregido            | La prueba usa settings transitorios sin guardarlos; stock usa milésimas y rechaza precisión inválida.                                                                                                                                |
| Segunda ola financiera  | Corregido            | Reportes netean devoluciones por medio/producto/categoría, delivery exige repartidor activo, ledger cero no bloquea y ninguna salida puede dejar caja negativa.                                                                      |
| Segunda ola clientes    | Corregido local      | Búsqueda sin texto, direcciones con ID estable, hidratación por lote, control optimista y bloqueo de duplicado exacto; los teléfonos compartidos por una familia siguen permitidos.                                                  |
| Segunda ola responsive  | Corregido            | Sin overflow de página a 390 px; controles críticos visibles, navegación móvil rotulada y modales inferiores `inert`.                                                                                                                |
| Tercera regresión UX    | Corregido            | Atrás del historial respeta formularios sucios, el foco vuelve al modal padre sin robar un foco nuevo y la carga rápida persistida no dispara avisos falsos de datos sin guardar.                                                    |
| Tercera regresión caja  | Corregido            | Reembolsos entre jornadas separan venta neta de salida física de caja, el cierre forzado registra IDs concretos y un repartidor con envíos activos no puede desactivarse hasta reasignarlos.                                         |
| Tercera regresión print | Corregido local      | `RECOVERING` reclama el reintento de forma atómica, una restricción parcial evita dos jobs activos por pedido/tipo y el arranque recupera reclamos interrumpidos.                                                                    |
| Tercera regresión demo  | Corregido            | Estado demo v7 migra clientes sin fecha, CAS se comprueba entre pestañas y configuración/impresión reutilizan la misma validación que producción.                                                                                    |

## Hallazgos priorizados

### P0 — corregir antes de una prueba intensiva real

| ID     | Severidad | Evidencia             | Hallazgo y recuperación actual                                                                                                                                                                                                                                                                                                |
| ------ | --------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HD-001 | Crítica   | Código                | `maxConcurrentCashSessions` admite 1–20, pero el contrato expone una sola `cashSession` y abrir, cobrar, mover, cerrar o liquidar toma la última caja abierta global. No existe selector ni propiedad de terminal. **Recuperación:** no hay forma confiable de corregir la atribución; hasta modelarla, el máximo debe ser 1. |
| HD-002 | Crítica   | Reproducido SQLite    | Con 207 pedidos, `bootstrap()` devolvió 200; una mesa seguía ocupada y un delivery confirmado seguía impago, pero ninguno de sus pedidos estaba en `data.orders`. Al pulsar la mesa el editor no aparece. **Recuperación:** no existe en UI; el cierre puede informar pendientes sin permitir encontrarlos.                   |
| HD-003 | Alta      | Reproducido UI        | Cobro, descuento, devolución, cancelación, extras y mitad/mitad abren un segundo `Modal` con el mismo nivel. El padre puede quedar por encima y cada modal escucha `Escape`; una tecla cerró hijo y padre. **Recuperación:** reabrir puede restaurar un hijo latente o perder el borrador.                                    |
| HD-004 | Alta      | Reproducido UI        | Una operación asincrónica puede cerrarse con X/Escape mientras sigue pendiente; al responder, aparece un “pedido fantasma” ya creado. **Recuperación:** el operador no sabe si cancelar, esperar o reintentar.                                                                                                                |
| HD-005 | Alta      | Código                | `queuePrint` marca `printed_at` e incrementa `print_count` antes del resultado físico. La primera copia puede rotularse “REIMPRESIÓN” y una falla queda contabilizada como impresa. **Recuperación:** reintento existe, pero el historial ya es semánticamente incorrecto.                                                    |
| HD-006 | Alta      | Código                | Sólo se exponen los últimos 100 trabajos de impresión. El único reintento busca un `FAILED` dentro de esa ventana; tras 100 trabajos posteriores, una falla no resuelta desaparece. **Recuperación:** no hay monitor global ni búsqueda por estado.                                                                           |
| HD-007 | Alta      | Reproducido UI        | “Liquidar pendientes” puede incluir todos los repartidores y ambas direcciones de deuda; el modal sólo muestra una cantidad de movimientos, sin nombres, pedidos, importes ni neto. **Recuperación:** la liquidación no puede revertirse ni reasignarse.                                                                      |
| HD-008 | Alta      | Reproducido UI/código | El cierre de caja ignora rendiciones pendientes. Es posible cerrar normalmente y dejar deuda de repartidor sin handover o caja destino. **Recuperación:** la rendición se imputa a la caja que esté abierta cuando se liquide, sin cadena explícita entre turnos.                                                             |
| HD-009 | Alta      | Reproducido API       | Dos llamadas iguales a `registerCashMovement` generan dos movimientos. La UI bloquea el doble clic visible, pero no un retry ambiguo de IPC ni ofrece contramovimiento/reversión.                                                                                                                                             |
| HD-010 | Alta      | Reproducido UI        | El demo aplica cambios de precio dentro del bucle masivo y puede devolver error después de haber mutado parte del estado en memoria. Una mutación posterior podría persistir ese parcial. **Recuperación:** no hay rollback de lote ni contrato de paridad con SQLite.                                                        |

### P1 — seguridad y fluidez de la operación en hora pico

| ID     | Severidad  | Evidencia             | Hallazgo y recuperación actual                                                                                                                                                                                                                                               |
| ------ | ---------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HD-011 | Alta       | Reproducido UI        | Doble clic sobre un producto agregó dos líneas. Se puede quitar una, pero no hay coalescencia, deshacer ni idempotencia de comando.                                                                                                                                          |
| HD-012 | Alta       | Reproducido UI        | Después de seleccionar un cliente, escribir otro nombre y pulsar Enter antes del debounce creó el pedido con el cliente anterior. La selección previa no se invalida al cambiar el texto. **Recuperación:** “Volver a datos…” funciona sólo si el operador detecta el error. |
| HD-013 | Alta       | Reproducido UI        | Escribir una mesa equivocada la crea; asignar un mozo equivocado abre el borrador. “Nueva mesa” deja la mesa creada u ocupada y el editor no permite reasignar mozo. **Recuperación:** descartar/cancelar o ir a Configuración.                                              |
| HD-014 | Alta       | Reproducido UI        | `F2/F3/F4/F6/Ctrl+P` navegan aun con un formulario sucio. `F3` y `F6` tampoco reaccionan si Pedidos ya está montado; los parámetros sólo se procesan al montar.                                                                                                              |
| HD-015 | Media/Alta | Reproducido UI        | Cobrar muestra `F8`, pero no existe handler. Enter tampoco confirma el cobro porque el contenido no es un formulario. El modal no toma foco en el primer importe.                                                                                                            |
| HD-016 | Alta       | Reproducido UI        | Errores de descuento, cobro, cancelación, modificador o mitad/mitad se escriben en el editor padre que queda cubierto por el hijo. El operador no ve el motivo ni sabe qué corregir.                                                                                         |
| HD-017 | Alta       | Reproducido UI        | “Descartar borrador” elimina en un clic un pedido que ya puede tener productos; no pide confirmación ni ofrece undo.                                                                                                                                                         |
| HD-018 | Media/Alta | Reproducido UI        | Con el autocomplete de Salón esperando un segundo, pulsar Tab antes del resultado mueve el foco y nunca adopta la primera coincidencia. Contradice la expectativa de completar con Tab.                                                                                      |
| HD-019 | Media      | Reproducido UI        | Quitar una línea mantiene opacidad 0 incluso con foco; depende de hover, no tiene `aria-label` visible y no ofrece deshacer.                                                                                                                                                 |
| HD-020 | Alta       | Reproducido UI        | La bandeja conserva orden de creación, no prioridad. Un borrador con 44 minutos puede quedar sobre un pedido atrasado. No hay vista operativa por atraso/listo/canal.                                                                                                        |
| HD-021 | Alta       | Código                | `READY` y `OUT_FOR_DELIVERY` existen, pero la UI sólo ofrece entregar. Tampoco se puede asignar/cambiar repartidor después de confirmar un borrador creado con “Asignar después”.                                                                                            |
| HD-022 | Alta       | Reproducido UI        | La selección masiva de productos persiste al cambiar filtros, pero el modal muestra sólo “N productos”; no lista selección oculta ni precios antes/después. El historial del producto omite el evento masivo y el audit no guarda una matriz reversible.                     |
| HD-023 | Alta       | Reproducido UI        | “Imprimir prueba” guarda primero toda la configuración en memoria, incluso cambios que el usuario nunca confirmó con Guardar. Probar hardware no debe persistir módulos, stock u otras políticas.                                                                            |
| HD-024 | Alta       | Reproducido UI/código | Stock demo usa unidades distintas de producción y el alta acepta texto inválido como stock inicial. La carga de pedidos tampoco muestra agotado hasta que la confirmación falla.                                                                                             |

### P2 — capacidades faltantes para operación gastronómica intensiva

| ID     | Tipo                    | Faltante                                                                                                                                                                                                                                                                                                                   |
| ------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HD-025 | Flujo                   | Editar cantidad de una línea, combinar duplicados, notas por producto, undo de corto plazo y botón de quitar visible para teclado/touch.                                                                                                                                                                                   |
| HD-026 | Salón                   | Transferir mesa, cambiar mozo, mover productos entre mesas, unir mesas, dividir cuenta por productos/comensales y reapertura deliberada.                                                                                                                                                                                   |
| HD-027 | Producción              | Tablero de preparación, transición rápida `En preparación → Listo → En reparto`, tiempos/alertas y acción masiva controlada.                                                                                                                                                                                               |
| HD-028 | Cobro                   | Atajos contextuales, importe rápido por medio, referencia/comprobante de transferencia, recibo de operación y visualización correcta de importe original/devuelto. Hoy un pago devuelto se muestra como “Devuelto $0”.                                                                                                     |
| HD-029 | Decisión financiera     | Pagos/devoluciones parciales, anticipos o división por comensal. `PARTIALLY_PAID` existe, pero `payOrder` exige cubrir todo el saldo y refund revierte una línea completa.                                                                                                                                                 |
| HD-030 | Recuperación financiera | Revertir o compensar movimientos de caja, liquidaciones y asignación de repartidor con motivo, PIN, batch ID y contramovimientos auditables.                                                                                                                                                                               |
| HD-031 | Clientes                | **Corregido operativo:** paginación/búsqueda server-side, perfil con métricas e historial completo, productos y direcciones habituales, etiquetas/preferencias, archivo/reactivación, fusión auditada, acción Nuevo pedido y resolución visible de conflictos. Pendiente opcional: cuenta corriente y privacidad avanzada. |
| HD-032 | Catálogo                | Renombrar/reordenar/desactivar categorías, vista previa del lote, dry-run, contralote y cambio rápido “agotado/no disponible” desde operación.                                                                                                                                                                             |
| HD-033 | Impresión               | Centro global de cola/fallas, alerta persistente, reintento o reasignación a otra impresora, vista previa y validación de opciones declaradas de corte/alimentación.                                                                                                                                                       |
| HD-034 | Multi-terminal          | `cashSessionId/terminalId` explícito, `expectedVersion` para compare-and-swap, `idempotencyKey`, sincronización/polling y resolución visible de conflictos.                                                                                                                                                                |

### Pendientes confirmados después de la segunda regresión

1. **Clientes — expansiones opcionales:** cuenta corriente, consentimiento de
   comunicaciones, anonimización y filtros por última compra. El alcance
   operativo solicitado de perfil, calidad del padrón y conflictos está cubierto.
2. **Impresión física:** el perfil guarda cortador, modo de corte y avance, pero
   la ejecución real depende del controlador Windows. Falta vista previa, altura
   dinámica para tickets extensos y validación RAW/ESC-POS con el modelo real.
3. **Catálogo móvil:** la página ya no desborda, aunque Stock/Estado/Acciones de
   tablas anchas deberían evolucionar a tarjetas o acciones sticky para no exigir
   llegar al final del desplazamiento horizontal.
4. **Operaciones irreversibles:** faltan contralotes, contramovimientos e
   idempotency keys generalizadas para respuestas IPC ambiguas.

### Propuesta funcional para desarrollar Clientes

La ficha actual ya permite crear/editar, manejar varias direcciones con costo de
envío y consultar un resumen de compras. La evolución recomendada, en este orden,
es:

1. **P1 — directorio escalable (implementado):** endpoint paginado, total real,
   búsqueda diferida por nombre/teléfono/dirección y estados activo/archivado.
2. **P1 — calidad de datos (implementado):** fusión con PIN, motivo y auditoría;
   conserva pedidos, direcciones, etiquetas y preferencias sin borrar historial.
3. **P1 — ficha operativa (implementado):** historial completo paginado, ticket
   promedio, frecuencia, última compra, productos/direcciones más usados y
   “Nuevo pedido” preseleccionado.
4. **P2 — preferencias (implementado):** etiquetas, notas, preferencias y medio
   de pago preferido; también informa el medio usado habitualmente.
5. **P2 — cuenta corriente opcional:** límite, saldo, movimientos y cobro con
   autorización y contramovimientos; no mezclarlo con `UNPAID` sin un diseño
   contable explícito.
6. **P3 — privacidad:** consentimiento de comunicaciones, exportación,
   anonimización controlada y auditoría de quién consultó o modificó la ficha.

## Problemas de cobertura y rendimiento

### Benchmark oficial desactualizado

`BENCHMARK_ORDERS=5000 pnpm benchmark` falla antes de medir porque el fixture no
incluye teléfono —y para retirar tampoco todos los datos— ahora obligatorios:

```text
Error: Ingresá el teléfono del cliente.
```

Una variante temporal corregida, sin incorporarla al producto, obtuvo:

| Métrica             |   Resultado |
| ------------------- | ----------: |
| Pedidos persistidos |       5.000 |
| Tamaño SQLite       |   19,70 MiB |
| Carga sintética     | 11.077,8 ms |
| Bootstrap de 200    |     52,8 ms |
| Informe detallado   |     16,5 ms |
| RSS                 |   158,6 MiB |

La lectura local es rápida; el problema crítico es que la ventana de 200 sacrifica
pedidos accionables. Además, cada mutación invalida el bootstrap completo, por lo
que todavía falta medir ráfagas UI, fallas de IPC y varias terminales.

### Línea base automatizada posterior a las correcciones

- `pnpm typecheck`: 7/7 paquetes.
- Build: 7/7 paquetes.
- Dominio: 10/10.
- SQLite: 56/56.
- Web/demo: 34/34.
- Electron E2E: 9/9 sobre aplicación real.

La cobertura nueva ya incluye activos antiguos, fallas de impresión preservadas,
rollback demo, rendiciones, caja negativa, repartidor inválido, ledger cero,
reportes después de devoluciones, direcciones estables y conflictos de edición.
También cubre reclamo atómico de impresión, reembolso entre jornadas,
desactivación segura de repartidores, migración demo v6→v7, CAS entre pestañas y
carga acelerada de direcciones/devoluciones sin perder el último valor escrito.
Todavía faltan pruebas automatizadas de:

- varias terminales reales y respuesta IPC perdida con replay idempotente;
- contramovimientos/anulación de rendiciones y movimientos manuales;
- impresora física desconectada, corte y alimentación según modelo;
- soak UI prolongado con más de 250 activos y navegación sólo teclado;
- paginación completa de clientes/productos y fusión de duplicados.

## Controles existentes que sí funcionaron

1. `mutation.isPending` bloquea el doble clic normal de varios botones críticos.
2. Un segundo cobro completo, una segunda entrega y una segunda rendición son
   rechazados por el estado persistido.
3. Cobro+cierre y cobro+entrega se ejecutan en una transacción SQLite.
4. Efectivo insuficiente y suma de medios distinta del saldo se bloquean.
5. PIN erróneo de precio manual conserva la carga y “Volver sin modificar” restaura
   el precio de lista.
6. Devolución total exige motivo/PIN y deja contramovimiento de caja.
7. Cierre de caja tiene revisión de dos pasos y permite volver antes de confirmar.
8. Clic fuera del overlay no cierra el modal; el foco simple se confina y restaura.
9. Volver a datos de cliente/envío conserva los productos del borrador.
10. Mozo inexistente muestra error y devuelve el foco al campo correspondiente.

## Plan de mejora

### Fase 0 — estabilización operativa

1. **Caja segura:** fijar temporalmente una caja concurrente; diseñar después
   `terminalId + cashSessionId` explícitos.
2. **Pedidos siempre recuperables:** cambiar el bootstrap a la unión de todos los
   activos con un historial reciente acotado; agregar `getOrder(id)` y
   búsqueda/paginación del lado SQLite.
3. **Pila de modales:** un único `ModalStackProvider`, z-index por profundidad,
   Escape sólo para el superior, error local y bloqueo/confirmación para dirty o
   pending.
4. **Impresión honesta:** separar intentos de copias exitosas; actualizar
   `printedAt/successCount` sólo al confirmar el driver y conservar siempre todas
   las fallas no resueltas en bootstrap.
5. **Rendiciones seguras:** selección explícita por fila y repartidor, resumen de
   importe/dirección/neto, doble confirmación, batch ID, bloqueo/handover al cierre
   y anulación compensatoria.
6. **Paridad de demo:** ejecutar los mismos contract tests de reglas, unidades y
   atomicidad contra demo y SQLite; corregir benchmark oficial.

**Salida de fase:** ningún activo/fallo desaparece por un límite; no se puede operar
contra una caja ambigua; toda operación financiera o impresa tiene recuperación
visible.

### Fase 1 — recuperación rápida y teclado

1. Registro central de atajos con contexto: modal activo primero, navegación
   después; implementar F8 real y reaccionar a F3/F6 aunque la ruta ya esté montada.
2. Convertir cobro y acciones en formularios operables con Enter, foco inicial,
   presets por medio y referencia de transferencia.
3. Invalidar cliente seleccionado al cambiar la consulta; resolver Tab mientras el
   autocomplete está pendiente sin perder foco ni selección.
4. Coalescer doble alta del mismo producto o usar token de comando; agregar editar
   cantidad, quitar visible y undo temporal.
5. Confirmar descarte con productos y permitir corregir mesa, mozo, repartidor,
   dirección y costo sin cancelar el pedido.
6. Mostrar toda validación en el diálogo que la originó.

**Salida de fase:** un error común puede corregirse en la misma pantalla y sin
recrear el pedido.

### Fase 2 — operación gastronómica de pico

1. Bandeja ordenada por atraso/prioridad con estados `En preparación`, `Listo` y
   `En reparto`, filtros y acciones rápidas autorizadas.
2. Transferir/unir mesas, mover líneas, dividir cuenta y reasignar personal.
3. Notas por línea, favoritos/recientes y disponibilidad/agotado visible durante la
   carga.
4. Centro de impresión/KDS con fallas persistentes, reintento y reasignación.
5. Lotes con selección visible, antes/después, dry-run, auditoría completa y
   contralote.

### Fase 3 — finanzas avanzadas y varias terminales

1. Resolver decisiones sobre pagos/devoluciones parciales y anticipos.
2. Contramovimientos para gastos, ingresos, rendiciones y cierres, nunca edición o
   borrado silencioso.
3. Compare-and-swap por `order.version`, claves idempotentes y replay del resultado
   original ante timeout.
4. Sincronización entre terminales y aviso de conflicto con recarga/conciliación.
5. Prueba soak: 5.000 históricos, más de 250 activos, 3 terminales, impresora caída,
   reinicio durante cobro y recuperación posterior.

## Escenarios de aceptación obligatorios

1. Abrir una mesa, crear 250 pedidos posteriores y comprobar que la mesa aún abre
   su pedido y puede cobrarse/cerrarse.
2. Mantener un delivery impago antiguo y comprobar que Pedidos, cierre y búsqueda
   muestran el mismo registro.
3. Fallar una impresión, generar 150 posteriores y seguir viendo/reintentando la
   falla original.
4. Abrir cliente dentro de envío: un Escape cierra sólo el hijo; el segundo conserva
   datos hasta una salida confirmada.
5. Cerrar un modal durante createOrder pendiente: impedir cierre o mostrar el
   resultado inequívoco, nunca reaparecer sorpresivamente.
6. Doble clic/Enter sobre producto o movimiento: una sola operación o undo claro.
7. Seleccionar Ana, cambiar texto a Mariana antes del debounce y bloquear el submit
   hasta resolver una selección coherente.
8. Intentar liquidar varios repartidores: ver filas, importes, dirección, neto y
   resultado por batch antes de confirmar.
9. Cerrar caja con rendiciones pendientes: bloquear o registrar handover explícito.
10. Simular respuesta perdida de cobro: reintentar con la misma idempotency key y
    recibir el resultado original sin nuevo asiento.
11. Probar impresora con cambios no guardados y comprobar que la configuración
    general no se persiste.
12. Ejecutar el mismo lote inválido en demo y SQLite y comprobar rollback total y
    el mismo mensaje funcional.

## Archivos de mayor impacto

## Hallazgo mesas, caja y tickets (2026-09-06)

- **Dinero:** el cobro de mesas ya se persiste correctamente y las reglas
  monetarias SQLite no requirieron cambios.
- **Problema observado:** la UI demo contaba pedidos confirmados impagos como
  ventas y la vista principal de Caja no mostraba la composición del efectivo;
  además Comanda/Cuenta no daban feedback inequívoco ni diferenciaban una
  reimpresión por tipo de ticket.
- **Estado final:** el resumen cuenta ventas cobradas, Caja muestra cambio,
  ventas en efectivo, ingresos, gastos, retiros, devoluciones y medios no
  efectivos, y OrderEditor informa impresión simulada/real y confirma nuevas
  copias por `orderId + kind`.
- **Pruebas:** demo API cubre cobro DINE_IN en dashboard/caja y pago no efectivo
  sin aumento de efectivo esperado; typecheck web y suite demo focalizada pasan.

- `packages/database/src/sqlite-repository.ts` — ventanas, caja, cobros,
  rendiciones, impresión y control de versiones.
- `packages/contracts/src/index.ts` — terminal/caja, idempotencia, versiones y API
  de búsqueda puntual.
- `packages/ui/src/index.tsx` — pila de modales, foco y salida segura.
- `apps/gastronomy-web/src/app.tsx` — atajos contextuales.
- `apps/gastronomy-web/src/components/order-editor.tsx` — líneas, cobro, errores,
  refund, impresión y F8.
- `apps/gastronomy-web/src/components/order-customer-selector.tsx` — coherencia de
  consulta/selección.
- `apps/gastronomy-web/src/pages/tables-page.tsx` — corrección de mesa/mozo y
  autocomplete por Tab.
- `apps/gastronomy-web/src/pages/orders-page.tsx` — urgencia, estados y atajos.
- `apps/gastronomy-web/src/pages/deliveries-page.tsx` — selección y revisión de
  rendiciones.
- `apps/gastronomy-web/src/pages/catalog-page.tsx` — lotes, stock y auditoría.
- `apps/gastronomy-web/src/pages/settings-page.tsx` — prueba de impresión sin
  persistencia lateral.
- `apps/gastronomy-web/src/demo/demo-api.ts` — paridad transaccional.
- `packages/database/src/benchmark.ts` — fixture de carga vigente.

## Visibilidad de ventas cobradas (2026-09-06)

- Resumen y Caja muestran últimas ventas cobradas filtradas por cashSessionPaidId, incluyendo Salón, Para retirar y Envío.
- Caja separa ventas cobradas del efectivo esperado: medios no efectivos son informativos y no incrementan el cajón.
- Demo no mezcla ventas de cajas históricas cuando existe una caja actual.
