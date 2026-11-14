# 2026-11-13 — Sesión de mozos, notas y búsqueda de clientes

## Alcance

- Comandas recupera el acceso al volver del bloqueo, restaurar la página o recuperar red. Reabrir el QR original reconoce su huella; otro QR mantiene su ingreso independiente. Cierre de caja y revocación siguen invalidando el acceso.
- Ingreso por PIN con feedback inmediato, prevención de doble envío, carga de mesas y consulta del recibo ante un corte sin reenviar el PIN. La caja diferencia errores públicos de PIN y QR.
- Nota del catálogo personaliza una unidad pendiente sin agregar otra. Si hay dos unidades, separa la anotada conservando la cantidad total. Las pizzas mantienen su flujo de alta.
- Búsqueda de clientes con o sin tilde en SQLite y demo; el filtro se aplica antes de contar/paginar, conservando los nombres originales. No requiere migración.

## Validación

- Typecheck y build: 11/11 paquetes.
- Web: 106 pruebas de demo/clientes.
- Página, relay, cierre de caja y RPC: 32 pruebas.
- Regresión SQLite de tildes: 1 prueba.
- E2E conjunto: 14/14, directorio/selector de clientes, PIN, reconexión, revocación, notas, mitades y flujo de mesas.

## Entrega y continuidad

Sin despliegue, instaladores ni cambio adicional de versión. Antes de publicar se incorporaron por fast-forward los commits remotos 2b0b616 y 7fd4bd2, que ya registraban 0.1.36.

Commit/push no actualiza las cajas instaladas ni el servicio de mozos. El frontend móvil requiere publicar Pedidos; la búsqueda SQLite de clientes y mensajes específicos de PIN requieren distribuir escritorio.

Excluidas carpetas locales .codex-attachments y .codex-gemini-*; no se incluyen bases, claves, builds ni resultados temporales. La skill de commit apunta a POS Tienda: aquí se aplicó el flujo equivalente con selección explícita en el repositorio gastronómico.

## Rollback

Revertir los cambios de la página móvil y su guía/pruebas como una unidad. La búsqueda de clientes y sus pruebas son independientes; retirar también el registro de customer_search_text si se revierte su uso. No restaurar bases ni tocar datos operativos como parte del rollback.
