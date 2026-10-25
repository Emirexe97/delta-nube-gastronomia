# 2026-10-25 — Versión 0.1.30: comandas y cargas pendientes

El usuario autorizó publicar los cambios, generar la siguiente versión y actualizar esta PC conservando datos y licencia.

## Cambios

- Reimpresión de cocina con selección de comanda completa o sólo cantidades agregadas; parcial predeterminada cuando hay novedades. Cada trabajo conserva su snapshot y sólo una impresión exitosa actualiza la referencia. Los pedidos históricos sin referencia requieren una impresión completa inicial.
- Salón y Pedidos conservan formularios y modales pendientes al navegar; la barra lateral sigue accesible. Se preservan datos y foco, y los formularios ocultos no interceptan atajos.
- Ocultar la notificación de impresión no vuelve a mostrar notificaciones anteriores; una nueva impresión vuelve a avisar.
- Pizza mitad y mitad muestra ambas variedades como detalle de cocina. OBS conserva exclusivamente notas manuales y no se eliminan notas existentes.
- Migración SQLite 42 aditiva: snapshot de trabajos de impresión e índice para consultar impresiones exitosas.

## Distribución y validación

Versión raíz y desktop 0.1.30. Windows NSIS x64 local y DMG Mac arm64/x64 desde el mismo commit mediante GitHub Actions. Actualizaciones automáticas deshabilitadas; Mac mantiene distribución manual.

La entrega requiere pruebas focalizadas, typecheck y build, verificación del paquete real y migración sobre copia consistente antes de instalar. Los respaldos, artefactos y evidencia privada permanecen ignorados fuera de Git. No se incluyen archivos personales ajenos a la entrega.
