# Compras, combos y repetición de pedidos

Fecha: 2026-10-16. Fuente local sobre 0.1.24; no commit/push, despliegue, versión ni instalador.

## Alcance aprobado

Implementar corrección documental de compras equivocadas, combos reales y repetición de pedidos de clientes. **Excluidos:** rendiciones (se revisarán en la PC afectada), backups automáticos y Agotado por hoy. Se preserva la opción mitad y mitad de la pasada anterior. No se amplía a devoluciones físicas, pagos a proveedores ni gastos mensuales pendientes de US18.

## Unidades entregables y uso

### 1. Recuperación documental de compras

Compras → historial → **Corregir producto** / **Anular compra**. Vista previa, motivo y PIN obligatorios; revisión optimista e idempotencia protegen concurrencia/reintentos. El original queda visible y no se borra. Las anuladas no integran totales vigentes ni costos de referencia para nuevas ventas. La corrección de producto cambia la atribución documental futura; compone con cantidad/costo corregidos sin revaluar ventas históricas.

**No modifica existencias ni caja.** Un conteo de stock o devolución real de dinero son operaciones separadas, nunca se infieren del error documental.

Persistencia: migración39, ledgers inmutables y estado/revisión de compra; DTO opcional compatible con fixtures legados. Tests SQLite `purchase-document-recovery.test.ts` y demo `purchase-document-corrections.test.ts`.

### 2. Combos reales

Crear un producto normal con el precio del combo, **sin stock propio**. Productos → **Configurar combo** → definir grupos, cantidad por grupo y productos/variantes permitidos. El pedido abre un selector de componentes y extras. El precio es base del combo + extras por cantidad de componente; no suma los precios individuales ni simula un descuento.

Stock y costos se calculan por componentes elegidos; confirmar, agregar sobre confirmado, aumentar/disminuir cantidad, quitar y anular usan snapshots guardados. Cambiar o retirar la configuración no altera pedidos anteriores. No se permiten combos anidados ni usarlos como producto común o mitad de pizza.

Persistencia: migración40 añade JSON de definición y de selección por línea. Campos DTO opcionales conservan compatibilidad. Tickets de cocina/cuenta muestran componentes y extras con escape HTML. No se ensayó impresora física.

Tests: dominio `combos.test.ts`, SQLite/demo `combos.test.ts`, shell `combo-ticket.test.ts`.

### 3. Repetir pedido

Clientes → ficha → historial completo → **Repetir**. Elegir retiro/envío y una dirección guardada vigente. Se crea un borrador para revisar, con catálogo, extras, precios y datos del cliente actuales; el envío usa el costo vigente de la dirección. Se pueden volver a editar los datos mediante el formulario existente y confirmar después.

No copia cobros, señas, descuentos, mesa, repartidor, programación ni instrucciones generales del pedido anterior. Las notas por producto se muestran para revisión. Se rechazan clientes archivados/unificados, productos/extras sin referencia vigente, mitades deshabilitadas y opciones de combo incompatibles; no se omiten silenciosamente ni se crea un borrador parcial. Los extras legados sin ID de catálogo deben cargarse manualmente.

SQLite envuelve todo en una transacción idempotente. Demo usa almacenamiento candidato aislado y una única publicación; conserva pedidos preexistentes para evitar que la normalización cambie sus timestamps.

Tests: dominio `repeat-order.test.ts`, SQLite/demo `repeat-order.test.ts`, elegibilidad web `repeat-order.test.ts` y Electron.

## Evidencia y estado de validación

- `pnpm test`: 9/9 tareas; dominio38/38, SQLite236/236, web300/300, shell50/50, protocolo7/7 y servicio14/14.
- SQLite compras+repetición10/10 y combos3/3 focales aprobados; fixtures de migración reales4/4 y archivos de recuperación previos28/28.
- Web demo compras22/22 (nuevas2 + costo/cantidad20); combos+repetición5/5; elegibilidad2/2.
- `pnpm typecheck` y `pnpm build`: 9/9 finales. Advertencia no bloqueante de bundle web mayor a500kB.
- Electron final5/5: `pnpm exec playwright test tests/e2e/operational-improvements.spec.ts tests/e2e/half-and-half-settings.spec.ts tests/e2e/desktop-flow.spec.ts --grep 'settings persist|purchase product correction|configure and order|repeat from customer|protege modales anidados'` (2,1min). Incluye las tres mejoras, configuración mitad y mitad con reinicio y regresión de modales/atajos. Perfiles temporales aislados descartados; capturas en `test-results/` ignorado por Git.
- Nuevo `tests/e2e/operational-improvements.spec.ts`: corrección/anulación con PIN erróneo y conservación de formulario; configurar y vender combo de variante+extra con stock real; repetir cliente, revisar datos y confirmar.
- Revisión independiente readonly: sin P1 en compras/repetición; omisión de componentes en previsualización de repetición corregida.

Incidencias de integración: traducciones de acciones nuevas agregadas al filtro de auditoría; snapshot de prueba mitad y mitad movido después de guardar settings para no confundir normalización previa con mutación rechazada; candidato demo restauraba timestamps históricos al normalizar, corregido antes de publicar. Revisión independiente detectó que precio unitario seguro no garantiza importe de línea seguro: guardas backend BigInt para agregar/cambiar cantidad antes de afectar stock o persistencia. Se rechaza comprar el padre combo para evitar crear stock propio; el alta de compra sólo ofrece productos comunes. Primer E2E usaba PIN de fixture SQLite2468 en vez del PIN de escritorio1234 y un label abreviado incorrecto: corregidos fixtures sin cambiar producto; pasada final5/5. Capturas de compra anulada, combo y repetición revisadas.

## Límites y reversión por unidad

No certifica suite E2E integral, Mac/impresoras reales, rendimiento de catálogos grandes ni uso productivo. Módulo nativo Node/Electron requiere reconstrucción secuencial; no correr pruebas de ambos ABIs en paralelo.

- Compras: revertir sólo comandos/proyecciones/UI de recuperación y sus tests; **conservar ledgers39 y auditoría**, no borrar correcciones ni restaurar un backup viejo sobre ventas nuevas.
- Combos: se puede retirar una configuración desde el catálogo; conservar snapshots40 para imprimir/consultar y manejar stock de pedidos existentes. No quitar columnas o restaurar stock histórico como rollback.
- Repetición: retirar acción UI/puente/comando/plan y sus tests no altera pedidos ya creados; éstos siguen siendo pedidos normales y se descartan/anulan por los flujos existentes si corresponde.

No reset global: todos los cambios previos de mitad y mitad y adjuntos del usuario son ajenos a esta unidad y deben conservarse.
