# 2026-10-17 — Versión 0.1.27: búsqueda de productos

El usuario autorizó expresamente cambio de versión, commit/push, generación y publicación de instaladores Windows y Mac y actualización manual de esta PC conservando la caja abierta y todos los datos.

## Cambio y comprobaciones de fuente

- El catálogo prepara los precios y el stock visibles cuando cambia `data.products`, reutilizándolos al escribir la búsqueda. Evita construir cientos de formateadores monetarios por tecla.
- Conserva nombre/código/categoría, filtros, variantes, formatos monetarios y stock y selección de productos. No cambia la base, movimientos, precios guardados, identidad de aplicación ni licencia.
- Detalle y límites de las mediciones en [la investigación de rendimiento](2026-10-17-catalog-search-performance.md): mejora del trabajo repetido, sin prometer la desaparición de todos los picos bajo carga.
- Pruebas previas del mismo cambio: 12 unitarias de catálogo/filtros y una prueba browser sobre bundle de producción aprobadas. Build web incluido typecheck aprobado. La prueba usa 260 productos sintéticos y CPU ralentizada; no accede al programa operativo.
- Revisión independiente de código y prueba sin regresiones concretas identificadas de precio, stock ni variantes. El memo depende del reemplazo inmutable de `data.products`, coherente con bootstrap/React Query.
- Versión 0.1.27 en los manifests raíz y desktop. Validaciones de entrega, hashes y resultado de instalación se completarán al finalizar cada etapa.

## Procedimiento de distribución e instalación

- Windows y Mac se publican como instaladores manuales en GitHub Releases. El updater permanece deshabilitado: no hay certificado Authenticode configurado. No se publican metadatos automáticos para binarios sin firma.
- Mac: generar DMG Apple Silicon arm64 e Intel x64 desde la misma etiqueta/commit, con las verificaciones del workflow. Firma ad-hoc y arranque en CI no sustituyen notarización o impresión física. Mantener updater Mac deshabilitado.
- Instalación Windows con caja abierta autorizada por el usuario: pausar operaciones cerrando el programa, respaldar SQLite consistentemente y conservar licencia/identidad, verificar hashes del instalador, instalar, comparar todas las tablas antes de reabrir y verificar integridad, caja abierta, licencia y arranque normal.
- No modificar sesiones ni movimientos para instalar. La autorización manual no relaja las condiciones del updater automático. Mantener respaldo, datos, evidencias privadas y binarios fuera de Git; excluir el respaldo local ajeno a la entrega.
