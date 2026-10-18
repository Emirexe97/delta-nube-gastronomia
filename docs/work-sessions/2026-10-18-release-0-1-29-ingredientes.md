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
- Artefactos, respaldos, datos y evidencia privada quedan fuera de Git. Fuente y etiqueta publicadas en GitHub; instaladores entregados localmente.

## Resultados de entrega

- Fuente de los instaladores: `007d192abe88e90cb0ce5eb6a09744686e58cfc4`, etiqueta `v0.1.29`.
- Typecheck y build de la versión final: nueve paquetes aprobados. Doce verificaciones de empaquetado, licencia y configuración de actualizaciones aprobadas.
- Windows NSIS x64: `apps/desktop-shell/release/Delta Nube Gastronomía Setup 0.1.29.exe`, 97.960.708 bytes, SHA256 `E4BEEED8DCB223979D0998C6F4B5126D661A7A91D388E088C0686671487E280F`. Entrega manual; Authenticode `NotSigned`.
- El paquete real se abrió en un perfil aislado con una copia consistente de la base operativa: migración 40 → 41, integridad y claves foráneas correctas, tablas existentes conservadas salvo el nuevo registro de migración, y las dos tablas nuevas vacías. ASAR y renderer coinciden con el build validado. La prueba aislada usa un perfil sin la licencia operativa.
- Mac: [CI 39165107301](https://github.com/Emirexe97/delta-nube-gastronomia/actions/runs/39165107301), arm64 y x64 `success`, mismo commit. Verificaciones de DMG, firma ad-hoc, arquitectura SQLite, licencia ASAR y arranque aprobadas en CI. Los ZIP descargados coinciden con los hashes y tamaños de GitHub Actions.
- Carpeta Mac absoluta: `C:\Users\Bonis\Documents\ChatGPT\Delta Nube Gastronomía\apps\desktop-shell\release\mac-build\run-39165107301`.
- DMG arm64: 116.627.460 bytes, SHA256 `79E6ABA65303FF48FDC5EC54865EC2CA9E48974D102EA6C5C4F51BE0D3351B81`.
- DMG x64: 141.000.309 bytes, SHA256 `51505013CB01E3F96B604BF2A6AC971A5AAF0B9E46C016967878FC0ED46B28A5`.

## Actualización de esta PC

- Cierre normal de la aplicación y respaldo consistente en `%LOCALAPPDATA%\DeltaNubeBackups\antes-instalar-0.1.29-2026-10-18T20-59-40-659Z`, con copia del perfil y de la identidad/licencia cifrada.
- Instalación NSIS silenciosa, salida 0. Ejecutable instalado: `C:\Users\Bonis\AppData\Local\Programs\@gastronomydesktop-shell\Delta Nube Gastronomía.exe`, versión `0.1.29.0`; ASAR idéntico al paquete verificado.
- Antes del arranque, todas las tablas coincidían con el respaldo. Después del arranque normal, sólo cambiaron el registro de migración y las dos tablas nuevas; los datos anteriores y el estado de caja se conservaron. Integridad y claves foráneas aprobadas.
- Licencia activa, firma válida, inscripción aprobada y misma identidad de instalación/dispositivo. Ventana normal observada y actualización de Windows aprobada para trabajar. Evidencia privada en `apps/desktop-shell/release/qa-0.1.29/`.
- Mac conserva distribución manual y firma ad-hoc; las verificaciones de CI no equivalen a pruebas de impresión en una Mac física ni a notarización.
