# 2026-10-18 — Versión 0.1.29: ingredientes y recetas

El usuario solicitó commit/push, la siguiente versión del instalador y la actualización de esta PC. La entrega incluye también la corrección de variantes y la pestaña Combos, publicadas después de la fuente del instalador 0.1.28.

## Cambios y validación de fuente

- Pestaña Ingredientes en Productos, con presentación, contenido por peso/volumen/unidades y costo de presentación.
- Costo del producto configurable mediante receta de varios ingredientes, conversión exacta kg/g y l/ml, cantidades fraccionarias y cálculo proporcional sin redondear previamente el costo por kg.
- Los cambios de ingredientes recalculan el costo vigente; las ventas confirmadas conservan sus costos históricos. Se puede volver a costo manual o últimas compras.
- Migración SQLite 41 agrega ingredientes/recetas y permite el origen RECIPE en los snapshots, conservando las filas anteriores.
- Validación previa al cambio de versión: dominio 45 pruebas, SQLite focalizado 31 pruebas, demo de ingredientes, 14 pruebas web de catálogo/conversión, typecheck y build de los nueve paquetes aprobados. Tres E2E aprobados: receta con cambio de precio e historial, costo manual con centavos y búsqueda con 260 productos.

## Distribución

- Versión raíz y desktop 0.1.29. El instalador Windows se genera localmente y los DMG Mac arm64/x64 desde el mismo commit/etiqueta mediante GitHub Actions.
- El updater permanece deshabilitado. No se configura un feed firmado ni se activa el updater de macOS.
- Antes de instalar: verificar paquete/ASAR, ensayar la migración sobre una copia consistente, respaldar el perfil y la licencia, cerrar normalmente la aplicación y comprobar integridad y conservación de los datos después de actualizar.
- Artefactos, respaldos, datos y evidencia privada quedan fuera de Git. Los resultados finales se registrarán al completar la entrega.
