# Análisis de referencia: Delta Nube POS

Fecha del análisis: 2026-08-31  
Repositorio observado: `DiegoPerez-3/delta-nube-pos`  
Commit de referencia: `e669d4079592b8aa66a76483ceca371167b1930b`

## Alcance y regla de separación

Delta Nube POS se usa únicamente como referencia técnica y visual. El sistema
gastronómico vive en este repositorio, no importa código del POS en runtime y no
escribe archivos en el repositorio de referencia.

## Stack real observado

- Monorepo administrado con `pnpm` y Turbo.
- TypeScript en todas las capas.
- Renderer POS en React 18 + Vite 5.
- Navegación con React Router 6.
- Estado remoto con TanStack Query y estado de sesión con Zustand.
- Formularios con React Hook Form y Zod.
- Estilos con Tailwind CSS y un paquete compartido `@pos/ui`.
- Íconos Phosphor.
- Shell de escritorio con Electron y `contextIsolation` mediante preload/IPC.
- Persistencia central con PostgreSQL + Prisma.
- Persistencia desktop local con SQLite: una ruta histórica basada en `sql.js`
  y una ruta nativa con `better-sqlite3-multiple-ciphers`.
- Base local protegida, transacciones serializadas, backups, verificación de
  integridad y una migración progresiva al backend nativo.
- Pruebas unitarias con Vitest/`node:test`, UI con Testing Library y E2E con
  Playwright, incluido un proyecto para Electron.
- Empaquetado Windows con `electron-builder` y NSIS.

## Estructura y responsabilidades

| Área | Ubicación en el POS | Patrón relevante |
| --- | --- | --- |
| Renderer operativo | `apps/pos-web` | Rutas diferidas, shell persistente y páginas por dominio |
| Shell desktop | `apps/desktop-shell` | Main/preload aislados; el renderer no accede a Node |
| Dominio | `packages/domain` | Reglas puras, dinero en minor units y tests cercanos |
| Runtime local | `packages/desktop-runtime` | Base local, servicios y contratos HTTP/desktop |
| UI | `packages/ui` | Tokens, primitivas compactas y Tailwind preset |
| Tipos | `packages/types` | DTO y contratos compartidos |
| Web común | `packages/web-core` | Búsqueda, fechas, permisos y utilidades de formulario |
| Persistencia central | `packages/database` | Prisma y migraciones versionadas |
| Sincronización | `packages/sync-engine` | Outbox, idempotencia, cursores y recuperación |

## Shell, navegación y densidad visual

El POS usa una barra lateral blanca de 220 px, colapsable a 60 px, agrupada por
secciones (`General`, `Operación`, `Control`). El área principal ocupa toda la
altura de la ventana y evita scroll horizontal. Las rutas se cargan de forma
diferida y el shell mantiene navegación, sesión, notificaciones y ayuda de
atajos.

La nueva aplicación replica conceptualmente:

- sidebar colapsable con navegación por módulos;
- header operativo persistente con caja, usuario, reloj y estado local;
- páginas densas y legibles a 1366×768;
- tablas con encabezado sticky y acciones visibles;
- foco visible y jerarquía basada en tamaño/peso, no en decoración excesiva;
- rutas en español y nombres operativos breves.

## Sistema visual observado

Tokens principales:

```text
background       #F5F7FA
surface          #FFFFFF
surfaceSecondary #F8FAFC
text             #0F172A
textBody         #334155
textMuted        #64748B
border           #E2E8F0
primary          #7C3AED
primaryHover     #6D28D9
primarySoft      #F5F3FF
primaryBorder    #DDD6FE
success          #059669
warning          #D97706
danger           #DC2626
```

La tipografía del POS es Inter, con controles de 40 px, radio de 8–12 px,
sombras discretas y transiciones rápidas de 120 ms. En Gastronomía se conservan
esos tokens porque la compatibilidad visual solicitada prima sobre introducir
un lenguaje visual nuevo.

## Formularios y estado

- Primitivas `Input`, `Select`, `Textarea`, `Button` y `Toast` compartidas.
- Sanitización por tipo de entrada y límites explícitos.
- React Hook Form + Zod para formularios compuestos.
- TanStack Query para lectura/invalidation y Zustand para estado de interacción.
- Confirmaciones específicas para acciones destructivas; las tareas normales
  no se sobreconfirman.
- Atajos globales registrados en un provider y ayuda contextual.

Gastronomía adopta el mismo reparto: Query para datos persistidos, Zustand sólo
para borradores/foco/paneles, React Hook Form + Zod para formularios y reglas de
dominio fuera de React.

## Productos, ventas, caja, clientes y pagos

El POS separa catálogo, ventas, turnos, clientes, permisos y medios de pago. Las
ventas guardan snapshots de nombre, presentación y precio; los turnos tienen
movimientos de caja; los medios de pago son dinámicos. Esa separación es
compatible con la necesidad gastronómica de mantener `Order` abierto antes de
generar la operación económica final.

Se mantienen compatibles estos conceptos:

- dinero como enteros en centavos;
- IDs UUID en texto;
- permisos por capability y no sólo por rol;
- turno/caja como agregado separado;
- medios de pago configurables;
- snapshots históricos en líneas;
- auditoría de acciones sensibles;
- operaciones locales transaccionales;
- número visible separado del ID técnico.

## Base local, migraciones y resiliencia

El runtime desktop del POS hace que Electron main sea dueño de SQLite. El
renderer accede a servicios mediante un bridge explícito de preload. La ruta
nativa usa transacciones, `BEGIN IMMEDIATE`, cola de escritura, verificación de
integridad y backups atómicos. El POS también modela una outbox para sincronizar
operaciones sin acoplar la UI a la red.

Para Gastronomía se adopta una versión deliberadamente más pequeña del mismo
patrón:

1. SQLite nativo en Electron main.
2. WAL, foreign keys y busy timeout.
3. migraciones SQL versionadas con checksum;
4. transacción por caso de uso monetario;
5. IPC allow-list con payloads validados;
6. backups locales desde main;
7. tabla `domain_events` lista para outbox futura.

## Usuarios, permisos y PIN

Delta Nube POS define un catálogo explícito de permisos, roles con permisos por
defecto y una lista de capacidades sensibles. Usa bcrypt para secretos locales.
Gastronomía conserva este enfoque, con permisos de dominio `orders.*`,
`cash.*`, `reports.*`, `settings.*` y `prices.*`. Los PIN se guardan como hash
bcrypt y toda elevación registra operador, autorizante y permiso utilizado.

## Impresión

El POS contiene un pipeline ESC/POS con:

- perfiles de papel (58/80 mm y formatos de hoja);
- ancho configurable por caracteres;
- sanitización y codificación CP850;
- soporte de corte y diálogo/silent mode;
- perfil de impresora expuesto por preload.

Gastronomía reutiliza el patrón conceptual, pero no copia el servicio entero.
`PrintService` recibe documentos semánticos y un adapter Electron los convierte
en HTML/ESC-POS. Se persiste un `print_job` antes de imprimir para que un fallo no
borre ni duplique silenciosamente una comanda.

## Informes, auditoría y sincronización

- Los reportes del POS se calculan sobre operaciones persistidas, no sobre
  estado de pantalla.
- La auditoría es una entidad propia con índices y política de retención.
- La sincronización usa outbox, idempotencia, cursores y receipts.

La primera versión gastronómica no sincroniza con la nube. Sí registra eventos
locales después de cada transacción relevante, con `event_id`, `aggregate_id`,
`event_type`, payload y fecha. Esto permite adaptar luego esos eventos al motor
de sincronización del POS.

## Manejo de errores y pruebas

El POS prioriza mensajes recuperables, preservación de sesión, reintento y tests
de reglas puras. Gastronomía sigue esa estrategia:

- errores de infraestructura traducidos a códigos de aplicación;
- fallos de impresión posteriores al commit del pedido;
- transacciones atómicas para caja/cobro/cancelación;
- tests unitarios de precios, caja, día comercial, permisos y liquidación;
- tests de repositorio sobre una SQLite temporal;
- Playwright para los flujos críticos cuando el shell esté estable.

## Qué conviene reutilizar conceptualmente

1. Monorepo pnpm y paquetes por responsabilidad.
2. React/Vite/Electron/TypeScript.
3. Shell lateral compacto y tokens Delta Nube.
4. Main dueño de SQLite + preload mínimo.
5. Dinero en centavos, UUID y snapshots.
6. Permisos explícitos y PIN con hash.
7. Migraciones versionadas, transacciones y outbox/eventos.
8. Impresión como servicio desacoplado con historial persistido.
9. Formularios validados y atajos registrados centralmente.
10. Pruebas de dominio cercanas a las reglas.

## Componentes visuales a adaptar

- `Button`, `Input`, `Select`, `Textarea`, `Card`, `Toast` y `Tooltip`.
- Sidebar colapsable y grupos de navegación.
- Data cards compactas sólo para indicadores que realmente lo ameriten.
- Tabla Delta Nube (`dn-table`) con header sticky.
- Diálogos de confirmación y PIN.
- Indicadores de estado con tonos violet, emerald, amber y rose.
- Ayuda de atajos y foco visible.

La adaptación se incorpora a este repositorio. No se importa `@pos/ui` desde el
repositorio de referencia.

## Contratos que deben permanecer compatibles

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
DomainEventPublisher
```

Los contratos usan IDs string, timestamps ISO, importes en centavos y resultados
serializables. Esto reduce traducciones al integrar el módulo en Delta Nube POS.

## Qué no debe copiarse

- El runtime de sincronización central, billing, WooCommerce y ARCA.
- La complejidad de migración histórica SQL.js → native-v2.
- Tokens de despliegue, configuración remota y recovery del producto principal.
- Modelos fiscales complejos fuera del alcance actual.
- Servicios gigantes del desktop runtime o singletons globales.
- Pantallas completas del POS cuando el flujo gastronómico requiere una
  interacción más rápida y específica.

## Preparación de la integración futura

El paquete de dominio gastronómico no importa Electron, React ni SQLite. Los
casos de uso dependen de contratos. La aplicación standalone inyecta adapters
SQLite/Electron. Una integración futura deberá conservar `domain` y
`application`, reemplazar adapters de productos/usuarios/caja/pagos/impresión y
montar las rutas del renderer dentro del shell del POS.

