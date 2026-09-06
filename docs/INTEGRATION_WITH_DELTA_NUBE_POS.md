# Integración futura con Delta Nube POS

## Paquetes conservables

- `packages/contracts`
- `packages/domain`
- `packages/application`
- páginas/componentes gastronómicos del renderer

## Adapters a reemplazar

| Standalone                            | Delta Nube POS                             |
| ------------------------------------- | ------------------------------------------ |
| `SqliteGastronomyRepository` catálogo | servicio/repositorio real de productos     |
| usuario local/PIN                     | usuarios, roles y permisos del POS         |
| `cash_sessions` local                 | turnos/cajas del POS                       |
| pagos locales                         | motor de ventas y medios dinámicos del POS |
| impresión Electron local              | perfil/bridge de impresión del POS         |
| `domain_events`                       | outbox/sync-engine del POS                 |
| settings JSON local                   | StoreSettings/feature flags del POS        |

## Límite de autenticación

La aplicación standalone local **no implementará una pantalla de login ni una
sesión paralela**. Funciona como una estación local y conserva PIN breve sólo
para autorizar acciones sensibles y registrar al autorizante.

Al integrar el módulo:

- reutilizar exactamente el login, sesión y usuario activo de Delta Nube POS;
- obtener roles/capabilities desde el mecanismo del POS;
- asociar operador y autorizante del módulo a IDs reales del POS;
- no migrar el usuario administrador local como una identidad del POS;
- mantener el PIN operativo únicamente si resulta compatible con el sistema de
  autorizaciones rápidas del POS.

## Secuencia de integración

1. Incorporar dominio, contratos y casos de uso al monorepo del POS.
2. Reemplazar el contexto local por el usuario/sesión autenticada del POS e
   implementar adapters contra catálogo, roles y permisos existentes.
3. Mapear el cobro final de `Order` al motor de ventas sin convertir un pedido
   abierto en `Sale` prematuramente.
4. Reutilizar caja, medios de pago e impresión.
5. Publicar eventos gastronómicos en la outbox del POS.
6. Montar rutas y navegación dentro de `apps/pos-web`.
7. Migrar datos standalone con IDs y snapshots intactos.

## Compatibilidad deliberada

- TypeScript, React 18, Vite, Electron, pnpm.
- IDs string UUID.
- timestamps ISO y dinero en minor units.
- permissions por capability.
- Métricas compactas compatibles con el POS y paleta propia naranja/Slate para gastronomía.
- transacciones, audit log y eventos idempotentes.

No existe import runtime ni submódulo Git del POS de referencia.
