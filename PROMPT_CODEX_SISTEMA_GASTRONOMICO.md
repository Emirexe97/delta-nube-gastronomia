# Prompt maestro para Codex — Sistema Gastronómico local, modular e integrable con Delta Nube POS

## Rol y objetivo

Actuá como arquitecto de software senior y desarrollador principal.

Debés construir un **sistema gastronómico de escritorio, local-first, rápido y robusto**, orientado inicialmente a una pizzería con alto volumen de pedidos por teléfono y WhatsApp cargados manualmente por un operador.

El programa debe funcionar **como aplicación independiente en esta primera etapa**, pero debe estar diseñado desde el comienzo para que posteriormente pueda integrarse como un **módulo de Gastronomía dentro de Delta Nube POS** con el menor trabajo posible.

Repositorio de referencia del POS existente:

- `https://github.com/DiegoPerez-3/delta-nube-pos`

Tenés acceso a ese repositorio. Usalo como **referencia técnica y visual**, no como destino de implementación inicial salvo instrucción explícita posterior.

La nueva aplicación debe:

- usar la misma tecnología o una tecnología compatible con el POS existente;
- reutilizar, adaptar o replicar responsablemente los patrones ya existentes;
- mantener una apariencia visual coherente con Delta Nube POS;
- usar las mismas convenciones de componentes, layouts, navegación, formularios, tablas, modales, tipografías, espaciados y estilos cuando sea razonable;
- mantener conceptos compatibles para productos, usuarios, permisos, caja, pagos, impresión e informes;
- evitar dependencias directas entre ambos repositorios;
- quedar separada internamente por módulos y servicios para que en el futuro sea sencillo mover el módulo de Gastronomía al POS principal.

No construyas un sistema visual nuevo si Delta Nube POS ya posee componentes equivalentes.

---

# Regla de trabajo inicial obligatoria

## Fase 0 — Analizar Delta Nube POS antes de programar

Antes de implementar funcionalidad:

1. Inspeccioná la arquitectura del repositorio `DiegoPerez-3/delta-nube-pos`.
2. Identificá:
   - stack real;
   - estructura de carpetas;
   - React/Electron si corresponde;
   - main/preload/renderer si corresponde;
   - navegación;
   - layouts;
   - componentes reutilizables;
   - sistema visual;
   - manejo de formularios;
   - manejo de estado;
   - base de datos local;
   - SQLite y migraciones;
   - modelos/repositorios/servicios;
   - productos;
   - ventas;
   - caja;
   - medios de pago;
   - clientes;
   - usuarios;
   - permisos;
   - auditoría;
   - impresión;
   - reportes;
   - sincronización local/remota si existe;
   - manejo de errores;
   - testing;
   - build y empaquetado.

3. Documentá brevemente el resultado en un archivo similar a:
   - `docs/REFERENCE_POS_ANALYSIS.md`

4. En ese archivo indicá:
   - qué código/patrones conviene reutilizar conceptualmente;
   - qué componentes visuales pueden copiarse/adaptarse;
   - qué servicios deberían tener contratos compatibles;
   - qué partes NO deberían copiarse;
   - cómo quedará preparada la integración futura.

5. Después del análisis, **continuá con la implementación**. No te detengas únicamente en el documento salvo que exista un bloqueo técnico real.

## Restricción importante

No contamines `delta-nube-pos` con la aplicación nueva.

La aplicación gastronómica debe quedar físicamente separada en esta primera etapa.

No importes código en runtime directamente desde el otro repositorio.

Si copiás/adaptás código, dejalo incorporado correctamente dentro del nuevo proyecto y documentá su origen conceptual.

---

# Filosofía del producto

El sistema debe cumplir cinco principios:

1. **Velocidad operativa**
   - Debe poder usarse durante picos de ventas.
   - La menor cantidad posible de clics.
   - Prioridad absoluta a teclado + mouse.
   - Operaciones frecuentes accesibles con Enter, Tab, flechas, Escape y teclas rápidas.

2. **Local-first**
   - Pedidos, mesas, caja e impresión deben funcionar sin Internet.
   - Una caída de red no puede impedir tomar pedidos ni imprimir comandas.

3. **Modularidad**
   - Funciones no utilizadas deben poder deshabilitarse desde Configuración.
   - Al deshabilitar una función, debe desaparecer o simplificarse la interfaz relacionada.

4. **Auditoría sin fricción**
   - Nunca borrar operaciones sensibles.
   - Cancelaciones y cambios importantes quedan registrados.
   - El usuario cotidiano no debe sufrir formularios largos ni pasos innecesarios.

5. **Integrabilidad futura**
   - El dominio gastronómico debe estar suficientemente aislado del shell de la aplicación.
   - En el futuro debe poder integrarse en Delta Nube POS reutilizando adapters/servicios del POS.

---

# Arquitectura esperada

Adaptá los nombres y carpetas al patrón real encontrado en Delta Nube POS. No fuerces esta estructura si el POS ya tiene una convención mejor.

Conceptualmente deben existir capas equivalentes a:

```text
app/
core/
modules/
  gastronomy/
    domain/
    application/
    infrastructure/
    ui/
adapters/
database/
printing/
reports/
settings/
```

El módulo gastronómico no debe conocer detalles innecesarios de Electron, SQLite o impresoras.

Preferir contratos/interfaces para elementos que en el futuro se conectarán con el POS, por ejemplo:

```text
ProductRepository
CustomerRepository
UserRepository
CashSessionRepository
OrderRepository
PaymentService
PrintService
AuditService
ReportService
StockService
SettingsService
```

La aplicación independiente tendrá adapters locales.

En Delta Nube POS, a futuro, esos adapters podrán reemplazarse por los servicios existentes.

---

# Alcance actual

Implementar:

- apertura y cierre de caja;
- múltiples cajas/turnos;
- movimientos de caja;
- salón y mesas;
- takeaway;
- delivery;
- clientes;
- productos;
- listas de precios;
- pizza mitad y mitad;
- modificadores/extras;
- usuarios;
- roles/permisos;
- autorización mediante PIN;
- comandas térmicas de 80 mm;
- impresión de cuenta;
- reimpresión;
- repartidores;
- pagos;
- pagos mixtos;
- descuentos;
- cancelaciones;
- auditoría;
- informes;
- exportaciones;
- configuración modular;
- soporte opcional de stock;
- operación offline/local.

## Fuera de alcance por ahora

NO implementar:

- lectura automática de WhatsApp;
- WhatsApp Business API;
- IA para interpretar mensajes;
- bots;
- toma automática de pedidos desde mensajes;
- delivery con geolocalización;
- facturación fiscal compleja salvo que ya exista una abstracción trivial reutilizable;
- recetas/escandallos avanzados salvo preparación de arquitectura;
- sincronización cloud obligatoria.

La carga de pedidos desde llamadas y WhatsApp será **manual pero extremadamente rápida**.

---

# Modelo conceptual principal

No mezclar "pedido abierto" con "venta finalizada".

Debe existir una entidad central `Order` o equivalente.

Flujo:

```text
Pedido abierto
→ puede editarse
→ puede imprimirse
→ puede permanecer pendiente
→ puede cancelarse
→ puede cobrarse
→ al finalizar genera/representa la operación económica definitiva
```

Tipos:

```text
DINE_IN
TAKEAWAY
DELIVERY
```

La futura integración con Delta Nube POS debería permitir que el cierre/cobro de un pedido utilice el motor de ventas existente del POS.

---

# Día comercial y cajas

## Día comercial

Cada caja pertenece al día calendario en que fue abierta.

Ejemplo:

```text
Apertura: 31/08/2026 18:00
Cierre:   01/09/2026 03:30
business_date = 2026-08-31
```

Todo el turno pertenece al día comercial `2026-08-31`.

No reclasificar automáticamente al día siguiente al pasar medianoche.

## Varias cajas

Debe soportarse:

- varias cajas durante el mismo día;
- varias cajas abiertas simultáneamente.

Configuración inicial:

```text
max_concurrent_cash_sessions = 1
```

pero el usuario debe poder aumentarla desde Configuración.

Cada cobro y movimiento debe quedar asociado a una caja/turno concreto.

Una orden puede haber sido creada durante una caja y eventualmente cobrarse en otra si hubo cambio de turno; conservar trazabilidad.

## Apertura

Registrar:

- fecha/hora;
- día comercial;
- usuario;
- cambio/fondo inicial;
- terminal si corresponde;
- observación opcional.

## Movimientos

Como mínimo:

```text
OPENING
SALE
INCOME
EXPENSE
WITHDRAWAL
REFUND
ADJUSTMENT
CLOSING
```

Los movimientos manuales sensibles deben registrar:

- importe;
- usuario;
- fecha/hora;
- motivo;
- caja;
- autorización por PIN cuando corresponda.

## Cierre

Debe calcular:

- cambio inicial;
- ventas en efectivo;
- ingresos manuales;
- gastos;
- retiros;
- devoluciones;
- ajustes;
- efectivo esperado;
- efectivo contado;
- diferencia;
- totales por medio de pago;
- total vendido;
- salón;
- takeaway;
- delivery;
- pedidos anulados;
- descuentos.

Ejemplo:

```text
Cambio inicial        $50.000
Ventas efectivo      $420.000
Gastos               -$25.000
Retiros             -$100.000
Efectivo esperado    $345.000
Efectivo contado     $343.500
Diferencia            -$1.500
```

La diferencia nunca debe desaparecer: registrar en auditoría.

### Cierre con pedidos pendientes

Por defecto:

```text
allow_close_with_pending_orders = false
```

Si existen pedidos asociados operativamente al turno aún pendientes, mostrar una advertencia clara y la lista.

Un usuario autorizado puede forzar el cierre mediante PIN si la configuración lo permite.

Los pedidos no deben perderse; pueden continuar y cobrar en otra caja, conservando trazabilidad.

---

# Usuarios, empleados, mozos y repartidores

Crear un modelo reutilizable de empleados/usuarios.

Roles iniciales sugeridos:

```text
ADMIN
MANAGER / SUPERVISOR
CASHIER
WAITER
DELIVERY_DRIVER
```

Adaptar al sistema de permisos del POS si existe uno reutilizable.

No depender únicamente del rol: usar permisos/capabilities.

Ejemplos:

```text
orders.create
orders.edit
orders.cancel
orders.reprint
orders.discount
orders.override_price
tables.manage
cash.open
cash.close
cash.expense
cash.withdraw
reports.view
reports.export
settings.manage
users.manage
prices.bulk_update
```

## PIN

Las autorizaciones rápidas deben poder hacerse con PIN corto.

Requisitos:

- no guardar PIN en texto plano;
- reutilizar mecanismo seguro del POS si existe;
- identificación del usuario autorizante;
- entrada rápida;
- Enter confirma;
- Escape cancela.

Ejemplo:

```text
PIN AUTORIZACIÓN
[ _ _ _ _ ]

Motivo:
[ Cliente canceló ▼ ]

ENTER confirmar
ESC cancelar
```

Registrar:

- operador que inició la acción;
- usuario que autorizó;
- permiso utilizado;
- fecha/hora;
- entidad afectada;
- motivo.

---

# Salón y mesas

No registrar cantidad de comensales.

## Mesas

Cada mesa tiene:

- ID;
- número visible;
- nombre opcional;
- activa/inactiva;
- orden visual.

Estados visuales simples:

```text
LIBRE
OCUPADA
```

Otros estados solo si son realmente útiles.

## Pantalla de salón

Mostrar tarjetas/lista con información útil:

```text
Mesa 1
Libre

Mesa 2
$28.500
Mozo: Juan
42 min
```

Permitir:

- abrir por número de mesa;
- abrir haciendo clic/doble clic;
- navegar con teclado;
- búsqueda rápida de mesa;
- crear mesas;
- editar numeración;
- deshabilitar mesas.

## Pedido de mesa

Una mesa abierta debe:

- autoguardarse;
- permanecer cargada aunque se navegue a otra sección;
- permitir agregar/eliminar/editar productos;
- permitir editar observaciones;
- registrar mozo;
- mostrar total en tiempo real;
- conservar snapshots de precios.

Debe permitir:

- cambiar una mesa de número;
- unir mesas;
- mover productos entre mesas, si no complica excesivamente la primera versión;
- pago mixto.

Dividir cuenta por persona NO es obligatorio inicialmente, pero la arquitectura no debe impedir agregarlo después.

## Imprimir cuenta

Acción:

```text
IMPRIMIR CUENTA
```

NO debe cerrar ni cobrar automáticamente la mesa.

Flujo:

```text
Mesa abierta
→ imprimir cuenta
→ mesa sigue abierta
→ cobrar
→ seleccionar pago
→ confirmar
→ cerrar mesa
```

Al cerrar:

- pasa a historial;
- mostrarla dentro de una vista denominada preferentemente `Consumo de salón`;
- conservar detalle completo y auditoría.

## Reabrir mesa cerrada

Solo mediante permiso + PIN.

Nunca alterar silenciosamente ventas históricas.

Registrar evento de reapertura/anulación/ajuste según corresponda.

---

# Takeaway y Delivery

Deben compartir una **única pantalla de pedidos**, diferenciándose claramente de manera visual.

Filtros rápidos:

```text
TODOS
TAKEAWAY
DELIVERY
PENDIENTES
ENTREGADOS
PAGO PENDIENTE
```

No saturar la interfaz.

## Datos del pedido

### Comunes

- número de pedido;
- tipo;
- cliente;
- teléfono;
- productos;
- observaciones;
- hora de creación;
- hora prometida;
- estado operativo;
- estado de pago;
- total;
- operador.

### Takeaway

- cliente;
- teléfono;
- hora prometida;
- observaciones.

### Delivery

Además:

- dirección;
- repartidor;
- costo de delivery;
- forma de cobro;
- estado de rendición si corresponde.

---

# Clientes

Base local de clientes.

Campos:

- nombre;
- teléfono;
- observaciones;
- múltiples direcciones;
- direcciones etiquetables, por ejemplo Casa/Trabajo/Otra;
- historial de pedidos.

El teléfono debe ser una vía principal de búsqueda, pero no asumir de forma rígida que siempre es único si la realidad del negocio exige duplicados.

Al buscar un cliente:

- búsqueda rápida por teléfono;
- búsqueda por nombre;
- autocompletar datos.

Si tiene dirección guardada:

- cargarla automáticamente;
- permitir editarla para ese pedido;
- no sobrescribir la dirección maestra accidentalmente;
- permitir guardar la nueva dirección si el operador lo elige explícitamente.

Agregar acción útil:

```text
REPETIR ÚLTIMO PEDIDO
```

Debe crear un nuevo pedido basado en el anterior, usando precios vigentes y validando productos activos.

---

# Estados del pedido

Separar **estado operativo** y **estado del pago**.

## Estados operativos

Por defecto habilitar solamente:

```text
IN_PREPARATION
DELIVERED
```

La interfaz inicial debe ser muy simple.

Desde Configuración permitir habilitar opcionalmente:

```text
PENDING
IN_PREPARATION
READY
OUT_FOR_DELIVERY
DELIVERED
```

Si un estado está deshabilitado:

- no mostrarlo;
- no obligar al operador a pasar por él;
- simplificar la interfaz.

## Estado de pago

Mantener siempre separado:

```text
UNPAID
PARTIALLY_PAID
PAID
```

Un delivery puede estar `DELIVERED` y `UNPAID`.

---

# Horario prometido y pedidos programados

Al cargar Takeaway/Delivery ofrecer dos modos:

## 1. Demora

Botones rápidos configurables:

```text
20 min
30 min
40 min
45 min
60 min
```

y un valor editable.

Ejemplo:

```text
Hora actual: 21:10
Demora: 40 min
Prometido: 21:50
```

## 2. Horario específico

Permitir seleccionar:

- hora;
- y opcionalmente otra fecha.

Ejemplo:

```text
Cliente llama 18:00
Pedido programado: 22:30
```

Debe quedar visualmente diferenciado.

No usar un slider si empeora la velocidad de teclado. Podés usar slider únicamente si aporta valor; priorizar controles rápidos + campo editable.

## Alertas

Mostrar:

- faltan X minutos;
- en horario;
- atrasado +X min.

Sin animaciones molestas.

---

# Productos

No usar variantes para los tamaños en la primera versión.

Los tamaños serán productos distintos:

```text
Muzzarella chica
Muzzarella grande
Muzzarella familiar
```

Campos mínimos:

- ID;
- categoría;
- nombre;
- código opcional;
- activo/inactivo;
- orden;
- precios por lista;
- stock opcional;
- destino de impresión opcional;
- modificadores compatibles.

La carga de productos debe ser extremadamente rápida.

---

# Categorías

Ejemplos:

```text
Pizzas
Empanadas
Lomos
Hamburguesas
Bebidas
Postres
Otros
```

Deben ser configurables:

- crear;
- editar;
- eliminar si no hay referencias o desactivar;
- reordenar.

---

# Listas de precios

Implementar listas de precios configurables.

Por defecto:

```text
SALON
TAKEAWAY
DELIVERY
```

Un producto puede tener distinto precio en cada lista.

## Operaciones masivas

Permitir:

- copiar precios de una lista a otra;
- aplicar descuento porcentual;
- aplicar recargo porcentual;
- subir/bajar toda una lista un porcentaje;
- redondear precios;
- editar individualmente después.

Ejemplos:

```text
Copiar SALON → TAKEAWAY con -10%
Copiar TAKEAWAY → DELIVERY con +5%
Aumentar SALON +8%
```

Antes de aplicar:

- vista previa;
- cantidad de productos afectados;
- precio anterior;
- precio nuevo;
- confirmar.

Configurar redondeo, por ejemplo:

```text
sin redondeo
a $10
a $50
a $100
a $500
```

## Historial

Registrar cambios masivos/importantes.

## Snapshot de precio

Una orden abierta debe guardar el precio utilizado.

Si cambia una lista:

- líneas existentes no cambian automáticamente;
- nuevos productos cargados posteriormente toman el precio vigente;
- toda modificación manual queda auditada si requiere permiso.

---

# Pizza mitad y mitad

Debe ser una funcionalidad de primer nivel y muy rápida.

No modelarla como dos pizzas independientes.

Ejemplo:

```text
1 Pizza Grande
½ Napolitana
½ Especial
Sin aceitunas
```

## Regla de precio configurable

Configuración:

```text
half_and_half_pricing_mode
```

Valores:

### Por defecto

```text
HALF_PLUS_HALF
```

Precio base:

```text
50% del precio de la variedad A
+
50% del precio de la variedad B
```

### Alternativa configurable

```text
MOST_EXPENSIVE
```

Cobrar el precio completo de la variedad más cara.

## Extras

Un extra puede aplicarse a:

```text
FULL_PIZZA
FIRST_HALF
SECOND_HALF
```

Regla:

- extra para pizza completa → sumar 100% del precio del extra;
- extra para media pizza → sumar 50% del precio del extra.

Los extras/modificadores pagos deben tener precio configurable.

Evitar errores por redondeo: trabajar internamente con una representación monetaria segura y redondear únicamente según la política monetaria configurada.

## Informes

Para popularidad:

- una pizza mitad y mitad cuenta como 1 pizza total;
- cada sabor puede computar 0,5 unidad para el ranking de sabores.

---

# Modificadores rápidos y extras

Deben poder:

- crearse;
- editarse;
- eliminarse/desactivarse;
- reordenarse;
- asociarse a categorías/productos;
- ser gratuitos o pagos;
- aplicarse a producto completo o media pizza cuando corresponda.

Ejemplos:

```text
Sin aceitunas
Sin cebolla
Extra queso
Bien cocida
Poco cocida
Sin mayonesa
```

Si un modificador tiene costo:

- almacenar precio;
- snapshot en el pedido;
- aplicar regla de media pizza cuando corresponda.

La interfaz debe permitir selección rápida por teclado.

---

# Edición de pedidos y comandas

## Antes de imprimir

Permitir editar libremente de acuerdo con permisos.

## Después de imprimir

Si una comanda ya fue impresa y se modifica el pedido:

- permitir modificar;
- exigir observación/motivo obligatorio;
- guardar auditoría digital;
- no imprimir automáticamente diferencias parciales salvo configuración futura;
- permitir reimprimir la comanda completa.

La operación de cocina elegida es deliberadamente simple:

> Se reimprime la comanda completa y el cajero/operador se encarga de reemplazar la anterior en cocina.

Esto prioriza velocidad y claridad operativa.

## Reimpresión

Debe decir claramente:

```text
******** REIMPRESIÓN ********
PEDIDO #XXXX
```

Registrar:

- usuario;
- fecha/hora;
- número de reimpresión;
- impresora;
- motivo si aplica.

---

# Cancelaciones

Nunca eliminar físicamente un pedido cancelado.

Al cancelar:

- pedir PIN si el permiso lo requiere;
- motivo obligatorio;
- marcar `CANCELLED`;
- conservar productos;
- conservar precios;
- conservar total;
- guardar quién operó;
- quién autorizó;
- fecha/hora;
- si ya se había impreso;
- cantidad de impresiones.

Si stock está habilitado, revertir adecuadamente.

Los cancelados deben ser visibles en auditoría e informes.

No permitir editar un pedido cancelado como si estuviera activo.

---

# Stock — opcional y modular

Debe existir una configuración:

```text
stock_enabled = false
```

Por defecto puede estar desactivada para simplificar la pizzería.

Si se activa:

- usar el sistema de stock compatible con Delta Nube POS;
- al confirmar el pedido, reservar/descontar según el patrón más seguro encontrado;
- no esperar al cobro, porque el producto puede estar ya en preparación;
- si se cancela, revertir el movimiento;
- si se modifica cantidad, ajustar;
- evitar stock negativo si la configuración lo prohíbe.

No implementar recetas/ingredientes complejos en esta fase salvo que el POS ya tenga una solución reutilizable y el costo sea bajo.

Preparar la arquitectura para agregar recetas en el futuro.

---

# Delivery y repartidores

## Costo de delivery

El costo de envío es configurable por pedido.

Ejemplos:

```text
$0
$2.500
$3.000
```

El costo pertenece al repartidor, no a la venta neta del negocio.

Separar:

```text
restaurant_subtotal
delivery_fee
customer_total
```

Ejemplo:

```text
Comida           $20.000
Delivery          $3.000
Total cliente    $23.000
```

## Cobro en efectivo por repartidor

Si el repartidor cobra $23.000:

```text
Retiene delivery   $3.000
Debe rendir caja  $20.000
```

El sistema debe poder registrar la rendición.

## Cliente transfiere al negocio

Si transfiere los $23.000:

```text
Ingresó al negocio     $23.000
Venta restaurante      $20.000
A pagar repartidor      $3.000
```

Generar saldo/liquidación a favor del repartidor.

## Liquidación

Vista simple:

```text
Repartidor: Juan

Pedido #189   $3.000
Pedido #194   $2.500
Pedido #198   $3.000

A PAGAR       $8.500
```

Permitir marcar liquidaciones como pagadas y auditar.

No volver esta función obligatoria si el negocio la deshabilita.

Configuración:

```text
delivery_settlement_enabled
```

---

# Cobros

Medios iniciales:

```text
Efectivo
Transferencia
Débito
Crédito
```

Deben ser configurables.

## Pago mixto

Ejemplo:

```text
Total          $40.000
Efectivo       $20.000
Transferencia  $20.000
```

Validar que la suma coincida con el total salvo pagos parciales explícitamente soportados.

## Efectivo y vuelto

```text
Total      $28.500
Paga con   $30.000
Vuelto      $1.500
```

## Descuentos

Permitir:

- porcentaje;
- importe fijo;
- línea individual si corresponde;
- pedido completo.

Descuento manual:

- exige permiso;
- puede exigir PIN;
- motivo;
- auditoría.

No permitir que un descuento deje totales negativos.

---

# Impresión térmica de 80 mm

La impresión es crítica.

Reutilizar el sistema de impresión de Delta Nube POS si resulta técnicamente adecuado, pero mantener un `PrintService` desacoplado.

Debe funcionar localmente.

## Tipos

Como mínimo:

```text
KITCHEN_ORDER
CUSTOMER_BILL
CASH_CLOSE_SUMMARY
REPORT_SUMMARY
```

## Comanda de cocina

Sin precios por defecto.

Debe destacar:

- número de pedido;
- tipo TAKEAWAY/DELIVERY/SALON;
- mesa si aplica;
- horario prometido grande;
- productos;
- mitad y mitad;
- modificadores;
- observaciones;
- hora de carga;
- cliente/teléfono/dirección donde sea útil.

Ejemplo conceptual:

```text
================================
          PEDIDO #0187
            DELIVERY
================================

RETIRAR / ENTREGAR: 21:50

2 MUZZARELLA GRANDE
  - 1 sin aceitunas

1 PIZZA GRANDE
  1/2 NAPOLITANA
  1/2 ESPECIAL
  + EXTRA QUESO MEDIA

6 EMPANADAS CARNE

OBS:
Tocar timbre lateral

Cliente: Juan
Tel: ...
Dirección: ...

Tomado por: Carla
20:43
================================
```

## Cuenta del cliente

Puede incluir:

- precios;
- subtotal;
- descuentos;
- delivery;
- total.

Imprimir cuenta NO implica cobro.

## Copias

Configuración por tipo de documento:

```text
printer
copies
cut_between_copies
```

Si:

- hay una sola impresora configurada; o
- múltiples copias van a la misma impresora;

realizar corte entre impresiones cuando la impresora lo soporte y la configuración lo indique.

## Múltiples impresoras

Preparar desde el comienzo:

```text
Pizzas → Cocina
Bebidas → Barra
Lomos → Cocina caliente
```

No es obligatorio usar múltiples impresoras al inicio, pero el modelo/configuración no debe impedirlo.

## Falla de impresión

Nunca perder el pedido.

Flujo:

```text
guardar pedido
confirmar transacción local
intentar impresión
```

Si falla:

- pedido queda guardado;
- mostrar error claro;
- botón reintentar;
- registrar incidente;
- no duplicar impresión silenciosamente.

---

# Fluidez y uso por teclado

Prioridad absoluta a teclado + mouse.

No diseñar una UI que requiera pantalla táctil.

## Principios

- buscador enfocado automáticamente;
- Enter confirma/selecciona;
- Tab siguiente;
- Shift+Tab anterior;
- Escape vuelve/cierra;
- flechas navegan listas;
- evitar diálogos que roben foco de manera impredecible;
- recordar foco al volver de un modal;
- no obligar al operador a tocar el mouse para las tareas frecuentes.

## Atajos sugeridos

Validar conflictos con el POS de referencia.

Ejemplo:

```text
F2  Nueva mesa
F3  Takeaway
F4  Delivery
F6  Buscar pedido
F8  Cobrar
F9  Imprimir/Reimprimir
Ctrl+P Buscar producto
Esc Volver
```

Los atajos deben ser configurables si es razonable.

Mostrar una ayuda de atajos accesible sin ocupar pantalla permanentemente.

---

# Pantalla táctil opcional

Configuración:

```text
touch_product_panel_enabled = false
```

Por defecto apagado.

Si se activa:

- mostrar categorías y botones grandes;
- reutilizar exactamente el mismo motor de pedido;
- no duplicar lógica;
- teclado sigue funcionando.

---

# Interfaz visual

Debe verse como parte de la misma familia de Delta Nube POS.

Antes de crear componentes:

- buscar componente equivalente en POS;
- copiar/adaptar estilos cuando corresponda;
- respetar convenciones visuales.

Objetivo:

- moderno;
- profesional;
- simple;
- denso cuando sea necesario;
- legible a 1366×768;
- sin espacios desperdiciados;
- sin animaciones decorativas innecesarias;
- no usar tarjetas para absolutamente todo;
- colores de estado coherentes;
- buena jerarquía visual.

No sacrificar velocidad por estética.

---

# Autoguardado y resiliencia

Todo pedido abierto debe autoguardarse.

Requisitos:

- si el programa se cierra inesperadamente, recuperar mesas/pedidos;
- operaciones monetarias en transacciones;
- evitar estados parcialmente escritos;
- SQLite local;
- activar WAL si es compatible con el stack y beneficioso;
- manejo correcto de concurrencia local;
- migraciones versionadas;
- backups locales razonables si el POS ya posee ese patrón.

Nunca requerir Internet para:

- abrir mesa;
- cargar pedido;
- editar;
- imprimir;
- cobrar;
- abrir/cerrar caja.

---

# Preparación para sincronización futura

No implementar cloud obligatorio ahora.

Pero preparar límites claros.

Si Delta Nube POS utiliza una arquitectura de sincronización/outbox, mantener compatibilidad conceptual.

Idealmente, las operaciones importantes pueden emitir eventos de dominio/locales:

```text
OrderCreated
OrderUpdated
OrderCancelled
OrderPaid
CashOpened
CashClosed
PaymentRecorded
DeliverySettled
```

No acoplar UI a una API remota.

---

# Auditoría

Implementar un registro append-only o funcionalmente equivalente.

Auditar al menos:

- apertura de caja;
- cierre;
- diferencia;
- ingreso;
- gasto;
- retiro;
- ajuste;
- cancelación de pedido;
- reapertura;
- descuento;
- cambio de precio manual;
- edición posterior a impresión;
- reimpresión;
- cambio de repartidor después de despacho si aplica;
- liquidación de delivery;
- cambios críticos de configuración;
- operaciones autorizadas por PIN.

Campos sugeridos:

```text
id
timestamp
business_date
operator_user_id
authorizer_user_id
permission_used
entity_type
entity_id
action
before_json
after_json
reason
metadata
```

No guardar datos innecesariamente enormes si afecta rendimiento.

---

# Informes

El sistema debe ofrecer informes filtrables.

Como mínimo:

## Ventas

- por día comercial;
- rango de fechas;
- caja/turno;
- Salón;
- Takeaway;
- Delivery;
- por medio de pago;
- por mozo;
- por operador;
- por producto;
- por categoría;
- por hora;
- ticket promedio;
- cantidad de pedidos.

## Productos

- más vendidos;
- facturación;
- sabores de pizza;
- mitad y mitad computando 0,5 por sabor para ranking;
- extras/modificadores frecuentes.

## Caja

- aperturas;
- cierres;
- cambio inicial;
- esperado;
- contado;
- diferencias;
- gastos;
- retiros;
- ingresos;
- ajustes.

## Auditoría

- cancelaciones;
- descuentos;
- reimpresiones;
- modificaciones post-impresión;
- reaperturas;
- autorizaciones.

## Delivery

Si está habilitado:

- pedidos por repartidor;
- delivery fees;
- efectivo pendiente de rendición;
- saldos a favor;
- liquidaciones.

---

# Exportaciones

Cada informe debe poder exportarse individualmente cuando sea razonable.

Formatos objetivo:

```text
PDF
XLSX o CSV
```

También crear un resumen general.

El informe principal/cierre debe poder imprimirse en 80 mm.

Las exportaciones no deben bloquear la operación principal.

---

# Configuración modular

Este punto es crítico.

Crear Configuración de Gastronomía organizada por secciones.

Funciones deshabilitables:

- Salón;
- Takeaway;
- Delivery;
- stock;
- repartidores;
- liquidación de delivery;
- estados avanzados;
- panel táctil;
- modificadores;
- descuentos;
- múltiples impresoras;
- pedidos programados;
- funciones avanzadas futuras.

Cuando algo se deshabilita:

- ocultar controles relacionados;
- simplificar pantallas;
- no destruir datos existentes;
- mantener compatibilidad si se vuelve a habilitar.

## Configuraciones importantes

Incluir:

```text
half_and_half_pricing_mode
stock_enabled
max_concurrent_cash_sessions
allow_close_with_pending_orders
touch_product_panel_enabled
delivery_settlement_enabled
enabled_order_statuses
quick_delay_minutes
printer mappings
copies per print type
cut_between_copies
price rounding policy
```

---

# Numeración

Separar conceptos.

Ejemplo:

```text
Pedido #1542
Comanda vinculada a Pedido #1542
Venta #8821
Mesa #7
Caja #146
```

Pedidos:

- correlativos;
- no reiniciar diariamente por defecto;
- legibles;
- únicos localmente.

La comanda puede usar el mismo número de pedido, evitando números innecesarios.

---

# Base de datos — entidades mínimas esperadas

Adaptar nombres al patrón existente.

Conceptualmente se necesitarán entidades equivalentes a:

```text
users
roles
permissions
user_permissions
cash_sessions
cash_movements
customers
customer_addresses
categories
products
price_lists
product_prices
modifier_groups
modifiers
product_modifiers
restaurant_tables
orders
order_items
order_item_halves / composite_order_items
order_item_modifiers
payments
delivery_drivers / employee role mapping
delivery_settlements
print_jobs / print_history
audit_log
settings
```

No crear tablas redundantes si el patrón de Delta Nube POS ofrece una solución mejor.

Usar migraciones.

Agregar índices para búsquedas frecuentes:

- order number;
- business date;
- status;
- payment status;
- customer phone;
- table number;
- cash session;
- created_at;
- promised_at.

---

# Snapshots históricos

No depender de datos mutables para reconstruir una venta antigua.

En líneas de pedido guardar snapshots suficientes:

```text
product_id
product_name_snapshot
unit_price_snapshot
price_list_id
quantity
discount_snapshot
modifier_name_snapshot
modifier_price_snapshot
```

Para mitad y mitad guardar referencias + snapshots.

Cambiar un producto mañana no puede alterar el pedido de ayer.

---

# Rendimiento

Objetivo: funcionamiento fluido con alto volumen.

Evitar:

- queries N+1;
- recargar listas enteras innecesariamente;
- renders globales;
- búsquedas sin debounce cuando corresponda;
- serialización pesada en cada tecla;
- escrituras excesivas de auditoría por eventos irrelevantes;
- bloqueos síncronos de impresión en UI.

El autoguardado debe ser seguro sin perjudicar la escritura rápida.

---

# Búsqueda de productos

Debe aceptar búsqueda parcial y rápida.

Ejemplo:

```text
muz g
```

podría localizar:

```text
Muzzarella grande
```

Orden sugerido:

1. coincidencia por código;
2. prefijo;
3. palabras;
4. coincidencia parcial.

Soportar teclado completamente.

---

# Búsqueda de clientes

Optimizada para:

- teléfono;
- nombre.

Al crear un delivery/takeaway, permitir:

```text
teléfono → Enter → cliente encontrado → Enter
```

sin pasos adicionales cuando los datos son correctos.

---

# Seguridad operativa

No pedir PIN para cada acción normal.

PIN solo para acciones sensibles según permisos/configuración.

No introducir confirmaciones innecesarias.

Ejemplo de acción normal:

```text
Agregar producto → inmediato
```

Ejemplo sensible:

```text
Cancelar pedido → PIN + motivo
```

---

# Manejo de errores

Errores deben:

- explicar qué pasó;
- preservar datos;
- ofrecer reintento;
- no cerrar la app.

Especialmente:

- impresora desconectada;
- falla de base;
- cierre inesperado;
- precio faltante;
- caja no abierta;
- usuario sin permiso;
- pedido ya modificado desde otra ventana;
- intento de cerrar caja con pendientes.

---

# Pruebas obligatorias

Agregar unit tests para reglas críticas.

Como mínimo:

## Mitad y mitad

1. A = 15000, B = 18000, modo HALF_PLUS_HALF:
   - base = 16500.

2. mismo ejemplo, MOST_EXPENSIVE:
   - base = 18000.

3. extra $2000 pizza completa:
   - +2000.

4. extra $2000 media pizza:
   - +1000.

## Día comercial

Apertura:

```text
2026-08-31 18:00
```

Cierre:

```text
2026-09-01 03:00
```

Debe pertenecer a:

```text
2026-08-31
```

## Caja

Verificar:

- esperado;
- contado;
- diferencia;
- gastos;
- retiros;
- pagos mixtos.

## Precio snapshot

Cambiar precio de producto no modifica pedido previo.

## Cancelación

- conserva pedido;
- registra auditoría;
- revierte stock si está habilitado.

## Delivery

- efectivo: repartidor retiene fee;
- transferencia: negocio debe fee al repartidor.

## Reimpresión

- no crea otro pedido;
- incrementa contador;
- marca REIMPRESIÓN.

## Permisos

- operación sensible bloqueada sin permiso;
- PIN autorizado permite;
- auditoría identifica operador y autorizante.

---

# Pruebas de flujo / aceptación

Crear pruebas integradas o manuales documentadas para estos escenarios:

## Escenario 1 — Mesa

1. Abrir caja con $50.000.
2. Abrir Mesa 4.
3. Asignar mozo.
4. Agregar 2 pizzas y 2 bebidas.
5. Imprimir cuenta.
6. Verificar que Mesa 4 siga abierta.
7. Agregar otra bebida.
8. Cobrar con efectivo + transferencia.
9. Cerrar.
10. Verificar en `Consumo de salón`.
11. Verificar caja.

## Escenario 2 — Takeaway

1. Crear cliente por teléfono.
2. Cargar pedido.
3. Seleccionar demora 40 minutos.
4. Imprimir comanda.
5. Cliente agrega una pizza.
6. Editar pedido.
7. Exigir motivo por edición post-impresión.
8. Reimprimir comanda completa.
9. Cobrar.
10. Entregar.

## Escenario 3 — Delivery efectivo

1. Cargar cliente existente.
2. Autocompletar dirección.
3. Cambiar dirección para este pedido.
4. Cargar comida $20.000.
5. Delivery $3.000.
6. Asignar repartidor.
7. Repartidor cobra $23.000.
8. Debe rendir $20.000.
9. Registrar rendición.
10. Verificar informes.

## Escenario 4 — Delivery transferencia

1. Comida $20.000.
2. Delivery $3.000.
3. Cliente transfiere $23.000 al negocio.
4. Venta restaurante = $20.000.
5. Saldo a pagar al repartidor = $3.000.
6. Liquidar repartidor posteriormente.

## Escenario 5 — Cancelación

1. Crear pedido.
2. Imprimir.
3. Cancelar.
4. Solicitar PIN.
5. Solicitar motivo.
6. No eliminar.
7. Mostrarlo en informes.
8. Revertir stock si está activo.

## Escenario 6 — Medianoche

1. Abrir caja 31/08 18:00.
2. Tomar pedidos hasta 01/09 02:00.
3. Cerrar 01/09 03:00.
4. Todo debe reportar al día comercial 31/08.

## Escenario 7 — Sin Internet

1. Desconectar Internet.
2. Abrir mesa.
3. Crear takeaway.
4. Imprimir comanda.
5. Cobrar.
6. Cerrar caja.
7. Todo debe funcionar.

---

# Migración futura a Delta Nube POS

La aplicación independiente debe diseñarse para que, en el futuro, el trabajo sea aproximadamente:

```text
1. mover/incorporar modules/gastronomy
2. conectar ProductRepository al servicio real del POS
3. conectar User/Permissions al POS
4. conectar Cash/Payments al POS
5. conectar PrintService al POS
6. conectar StockService al POS
7. conectar Reports/Sync al POS
8. reutilizar shell/navegación
```

Evitar que el dominio gastronómico dependa de:

- rutas absolutas;
- ventana Electron concreta;
- un singleton global difícil de reemplazar;
- APIs remotas;
- nombres específicos de esta pizzería;
- una impresora única;
- una lista de precios fija;
- estados hardcodeados.

---

# No hardcodear el negocio

El software debe poder usarse por otras pizzerías/restaurantes.

No hardcodear:

- nombre del comercio;
- cantidad de mesas;
- categorías;
- precios;
- mozos;
- repartidores;
- demora;
- impresoras;
- costo de delivery;
- estados;
- modificadores;
- medios de pago.

Todo lo relevante debe salir de datos/configuración.

---

# Estrategia de implementación

Trabajar en etapas pequeñas y comprobables.

## Etapa 0
Análisis de Delta Nube POS y diseño.

## Etapa 1
Shell, base local, migraciones, settings, usuarios/permisos.

## Etapa 2
Productos, categorías y listas de precios.

## Etapa 3
Caja, movimientos y día comercial.

## Etapa 4
Motor de pedidos.

## Etapa 5
Salón/mesas.

## Etapa 6
Takeaway/Delivery + clientes.

## Etapa 7
Mitad y mitad + modificadores.

## Etapa 8
Impresión térmica.

## Etapa 9
Cobros, descuentos y pagos mixtos.

## Etapa 10
Repartidores y liquidaciones.

## Etapa 11
Auditoría.

## Etapa 12
Informes/exportación.

## Etapa 13
Configuración modular y refinamiento UX.

## Etapa 14
Pruebas integrales, recuperación y rendimiento.

No esperar necesariamente una aprobación manual entre cada etapa. Continuar mientras no exista un bloqueo o una decisión que pueda causar una reescritura grande.

---

# Regla para preguntas

No hagas preguntas por detalles que puedan resolverse razonablemente inspeccionando Delta Nube POS o aplicando estas reglas.

Si falta una decisión menor:

- elegí una opción sensata;
- hacela configurable;
- documentala.

Preguntar únicamente cuando una ambigüedad pueda:

- cambiar significativamente el modelo de datos;
- provocar pérdida de información;
- comprometer seguridad;
- impedir integración futura;
- generar una reescritura importante.

---

# Documentación que debe mantenerse

Crear/actualizar:

```text
README.md
docs/REFERENCE_POS_ANALYSIS.md
docs/ARCHITECTURE.md
docs/DATABASE.md
docs/PRINTING.md
docs/KEYBOARD_SHORTCUTS.md
docs/INTEGRATION_WITH_DELTA_NUBE_POS.md
```

`INTEGRATION_WITH_DELTA_NUBE_POS.md` debe explicar concretamente cómo integrar esta app como módulo en el futuro.

---

# Definition of Done

No considerar una funcionalidad terminada solo porque "se ve".

Debe cumplir:

- persistencia correcta;
- validaciones;
- permisos;
- auditoría cuando aplica;
- navegación por teclado;
- manejo de error;
- tests críticos;
- coherencia visual;
- compatibilidad offline;
- migraciones;
- datos históricos estables.

---

# Prioridad máxima

Si existe conflicto entre:

1. estética;
2. sofisticación técnica;
3. velocidad de operación;

priorizar:

```text
correctitud
→ velocidad de operación
→ resiliencia
→ mantenibilidad
→ estética
```

La aplicación debe sentirse rápida y sencilla aunque internamente sea completa.

---

# Resultado esperado de esta tarea

Comenzá analizando `DiegoPerez-3/delta-nube-pos`.

Luego construí una **aplicación gastronómica local e independiente**, visual y arquitectónicamente compatible con ese POS, cumpliendo todas las reglas anteriores y dejando una ruta clara para convertirla posteriormente en el módulo de Gastronomía de Delta Nube POS.

No implementar integración automática con WhatsApp en esta etapa.

No sacrificar simplicidad operativa por funciones opcionales: cualquier función avanzada debe poder ocultarse/desactivarse desde Configuración.
