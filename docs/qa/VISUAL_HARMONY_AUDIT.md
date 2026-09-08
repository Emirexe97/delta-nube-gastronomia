# Auditoría de armonía visual

Fecha: 2026-09-08
Alcance: aplicación gastronómica completa (Operación, Gestión, Control, Sistema y UI compartida).

## Resumen ejecutivo

Se auditó la interfaz con cuatro subagentes en áreas independientes y se corrigieron los defectos visuales reproducibles de alineación, densidad y adaptación responsive. La causa principal del ejemplo reportado era sistémica: `Field` podía estirar sus filas internas cuando compartía una grilla con otro campo que sí tenía texto de ayuda.

## Hallazgos corregidos

| Área                                        | Defecto                                                                    | Corrección                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| UI compartida                               | Inputs vecinos desalineados cuando sólo uno tenía `hint`                   | `Field` ahora compacta su contenido al inicio y admite clases de composición responsive      |
| Salón                                       | Carga rápida apilada y demasiado alta                                      | Grillas compactas de 12 columnas para mesa/mozo y productos; acciones redundantes eliminadas |
| Clientes                                    | Teléfono y nombre desalineados; etiqueta principal desplazaba la dirección | Alineación común de controles y badge principal debajo del input                             |
| Catálogo, clientes, repartidores y usuarios | Tablas comprimidas o recortadas en anchos reducidos                        | Ancho mínimo legible y contenedores con desplazamiento horizontal                            |
| Pedidos                                     | Buscador y filtros envolvían de forma irregular                            | Toolbar responsive y control de overflow                                                     |
| Editor de pedidos y plano                   | Cambio abrupto de columnas y panel lateral rígido                          | Breakpoints intermedios, gaps y alturas adaptativas                                          |
| Caja, informes y auditoría                  | Cabeceras/filtros con alturas o columnas desbalanceadas                    | Alturas comunes, columnas flexibles y acciones agrupadas                                     |
| Configuración                               | Hints dinámicos y fila del cortador provocaban saltos                      | Espacio estable de ayuda y alineación vertical común                                         |

## Cobertura de regresión

- `tests/e2e/visual-harmony.spec.ts` comprueba geométricamente que los controles de Cliente y Producto comparten coordenada vertical y altura aunque sólo uno tenga ayuda.
- La suite E2E focalizada de carga rápida conserva navegación por mouse, Enter, Shift+Enter, selección de productos y autorización de precios.
- Las tablas conservan contenido completo mediante scroll horizontal en lugar de comprimir columnas.

## Validación

- `corepack pnpm typecheck`: 7/7 paquetes.
- `corepack pnpm build`: 7/7 paquetes.
- Suite focalizada visual/funcional: 20/20 pruebas.
- `corepack pnpm exec playwright test`: 39/44 pruebas pasaron, incluida la nueva regresión visual. Cinco casos de `desktop-flow.spec.ts` fallaron por estado/diálogos del flujo integral; los specs focalizados visuales y funcionales afectados pasaron.

## Estado

- Correcciones visuales solicitadas: completas.
- Commit, push, cambio de versión e instalador: no realizados.
