# Delta Nube Gastronomía

Aplicación gastronómica desktop, local-first e independiente, diseñada para
integrarse más adelante como módulo de Delta Nube POS.

## Estado actual

Candidato funcional local:

- Electron + React/Vite con apariencia compatible con Delta Nube POS;
- SQLite local en WAL y migración inicial versionada;
- apertura, movimientos y cierre protegido de caja;
- día comercial fijado por apertura;
- salón con mesas libres/ocupadas;
- pedidos de salón, para retirar y envío, con borrador separado del estado operativo;
- productos, categorías y tres listas de precios;
- snapshots históricos de producto/precio;
- pizza mitad y mitad (`HALF_PLUS_HALF` / `MOST_EXPENSIVE`);
- modificadores completos o por media pizza, con snapshot de precio;
- descuentos porcentuales o fijos autorizados por PIN;
- stock opcional en milésimas, con descuento y restitución transaccional;
- clientes y direcciones principales, con alta directa desde un pedido para retirar o envío;
- horario prometido con demoras rápidas o fecha/hora programada, alertas y
  autocompletado de clientes con espera de 1 segundo, primera coincidencia y navegación por flechas, `Tab`, `Enter` o clic;
- cobros simples y mixtos con efectivo recibido, cálculo de vuelto y acciones atómicas de cobro/cierre o cobro/entrega;
- devolución total por línea de pago con PIN, movimiento inverso de caja, auditoría e idempotencia;
- impresión térmica desacoplada con perfiles Comanda/Cuenta, papel 58/80 mm, impresora, copias, plantilla, cola/historial y reintento idempotente;
- cancelación con PIN, auditoría y eventos de dominio;
- configuración modular;
- dashboard e informes básicos;
- exportación de ventas a CSV UTF-8 con BOM;
- repartidores como identidades operativas sin pantalla ni PIN propio, asignación en envíos y panel de caja con entregas, ganancias y horarios de rendición;
- usuarios por rol/capacidad, cambios protegidos y auditoría consultable;
- informes por rango, producto, categoría, hora, mozo, caja y envíos;
- backup SQLite consistente y restauración con rollback de emergencia;
- navegación, atajos y búsqueda clasificada por código/prefijo/palabras;
- carga rápida con autocompletado alfabético por nombre, espera de 1 segundo y lista navegable con flechas, Tab o clic;
- operaciones masivas transaccionales para categoría, estado y variación de precios por canal;
- benchmark reproducible de 2.500 pedidos;
- instalador NSIS x64 generado y smoke testeado.

La base arquitectónica queda lista para pruebas con impresoras físicas y la
integración posterior dentro de Delta Nube POS.

## Requisitos

- Node.js 22 o superior.
- pnpm 10.33 (`corepack enable`).
- Windows para el instalador desktop.

## Instalación

```powershell
pnpm install
```

## Desarrollo

Para revisar rápidamente el frontend con datos de prueba, sin Electron ni reinstalaciones:

```powershell
pnpm dev:demo
```

Luego abrir [http://localhost:5173](http://localhost:5173). Los cambios se actualizan en caliente y los datos quedan aislados en el navegador.

En dos terminales:

```powershell
pnpm dev:web
pnpm dev:desktop
```

`dev:desktop` recompila el módulo nativo SQLite para la ABI de Electron. En
desarrollo se carga un catálogo inicial genérico. Producción comienza sin
productos y conserva sólo categorías, mesas, listas y medios configurables.

## Verificación

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm benchmark
pnpm test:e2e
```

`test:e2e` compila la aplicación, reconstruye SQLite para la ABI de Electron y
ejecuta flujos reales de escritorio en un perfil temporal aislado.
`benchmark` crea y elimina una base temporal de alto volumen.

## Instalador Windows

```powershell
pnpm --filter @gastronomy/desktop-shell dist:win
```

El artefacto se genera en
`apps/desktop-shell/release/Delta Nube Gastronomía Setup 0.1.0.exe`. El comando
recompila primero SQLite para la ABI exacta de Electron.

## Autorizaciones locales

El modo standalone no presenta login. El PIN se usa únicamente para autorizar
operaciones sensibles; el administrador inicial usa temporalmente `1234` y se
puede sustituir antes del primer inicio:

```powershell
$env:GASTRONOMY_ADMIN_PIN="PIN-SEGURO"
```

Nunca se persiste el PIN en claro; SQLite guarda un hash bcrypt con costo 12.
Cuando el módulo se integre con Delta Nube POS, deberá reutilizar su login,
sesión, roles y permisos en lugar de crear una autenticación paralela.

## Documentación

- [Referencia del POS](docs/REFERENCE_POS_ANALYSIS.md)
- [Arquitectura](docs/ARCHITECTURE.md)
- [Base de datos](docs/DATABASE.md)
- [Impresión](docs/PRINTING.md)
- [Atajos](docs/KEYBOARD_SHORTCUTS.md)
- [Integración futura](docs/INTEGRATION_WITH_DELTA_NUBE_POS.md)
- [Pruebas de aceptación](docs/ACCEPTANCE_TESTS.md)
- [Backup y recuperación](docs/BACKUP_RECOVERY.md)
- [Matriz de cobertura](docs/COVERAGE_MATRIX.md)
- [Benchmark](docs/PERFORMANCE.md)
- [Modo demostración en navegador](docs/MODO-DEMO.md)
- [Auditoría integral de flujos](docs/FUNCTIONAL_FLOW_AUDIT.md)
