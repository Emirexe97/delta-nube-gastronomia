# Estética y rendimiento — segunda iteración

## Objetivo y límites

Refinar escritorio y página de mozo conservando todas las funciones. Mantener
la identidad naranja/pizarra, textos sencillos y aclaraciones en ayudas de hover,
teclado y toque. No cambiar cálculos, permisos, impresión ni la sincronización.

Esta iteración trabaja sobre la anterior, ya distribuida. No autoriza por sí
misma otro instalador, cambio de versión, commit, push ni actualización remota.
Las pruebas usan perfiles y servicios temporales, nunca datos del comercio.

## Cambios

- Jerarquía más clara en Resumen: métricas legibles, números alineados, actividad
  en curso antes del historial y sombras discretas; se conserva toda la información.
- Configuración en ocho pestañas: contenido cargado al visitar, sin desmontarlo
  al cambiar de sección. Contenedores accesibles presentes desde el inicio.
  Los cambios de pestaña reemplazan el fragmento de la URL, sin llenar el historial
  ni interferir con la confirmación de cambios sin guardar al salir.
- Actualizaciones de datos no pisan borradores. Guardar envía una copia y una
  respuesta tardía no reemplaza lo escrito después de iniciar el guardado.
- Pantallas del escritorio cargadas al necesitarlas; Resumen disponible al inicio.
  Los espacios Salón y Pedidos conservan su estado. Un error de carga se aísla a
  su sección, sin recargar la aplicación ni descartar borradores.
- Reloj del encabezado aislado para que no vuelva a dibujar toda la aplicación.
  Sin alterar frecuencias de control de licencia, actualización o pedidos.
- Formateadores de importes reutilizados en un caché acotado (16 monedas), con
  idéntica salida y sin almacenar importes ni cambiar cálculos.
- Mozo reutiliza nodos de categorías, mesas y productos si no cambiaron sus datos;
  preserva foco al agregar productos, refleja cambios reales y conserva notas.
  Evita escrituras redundantes de borradores vacíos.
- Ayudas cerradas sin listeners globales innecesarios; controles táctiles amplios
  y estados visibles de foco. Fuente local para no agregar descargas externas.
- Modo demostración carga su API por separado; restablecer espera el borrado antes
  de recargar. Fallos de inicio muestran un mensaje en lugar de pantalla vacía.

## Mediciones reproducibles

Evidencia ignorada por Git:
`docs/qa/evidence/aesthetic-performance-20261106/`.

- Entrada JavaScript: **1.016.424 → 331.160 bytes (−67,4%)**. La reducción corresponde
  al archivo principal inicial, no a eliminar funciones ni al tamaño completo instalado.
- Nodos de Configuración al abrir: **500 → 242 (−51,6%)**, sin ejecutar la búsqueda
  de impresoras hasta visitar Impresión. Las ocho secciones siguen disponibles.
- `measure-desktop.cjs`: tres arranques con perfiles nuevos, hasta el título Resumen
  y cantidad de nodos de Configuración. No representa todos los equipos ni cargas.
  Mediana local del arranque **697 → 688 ms**: se mantiene alrededor de 0,7 segundos;
  la diferencia no permite afirmar una mejora concluyente del arranque total.
- `measure-money.mjs`: cinco rondas de 1.000 precios, verifica igualdad exacta de
  cada salida; medianas locales **17,28 ms → 0,39 ms**. No representa el tiempo
  total de un catálogo. La prueba unitaria verifica 1 constructor en vez de 1.000.
- Catálogo móvil sintético de 120 productos: cinco agregados no reemplazan los
  nodos del catálogo; cambiar categoría o datos sí actualiza la lista. Comprueba
  foco, notas, ausencia de desborde a 320/390 px y desconexión visible.

## Validación

| Comprobación | Resultado |
| --- | --- |
| Typecheck del workspace | 11/11 tareas correctas |
| Build del workspace | 11/11 tareas correctas |
| Dominio, incluido formato de importes | 51/51 pruebas |
| Interfaz de escritorio | 358/358 pruebas en 45 archivos |
| Servicio de pedidos/mozo | 44/44 pruebas |
| E2E seleccionados | 64 escenarios distintos aprobados, en 20 archivos |
| Diferencias de Git | Sin errores de espacios |

La validación E2E fue incremental: ejecución amplia de 61 escenarios; corrección
de expectativas antiguas y del harness; ejecución de 19 escenarios focalizados;
última ejecución de 4/4 tras ajustar el selector de dirección y el espaciado.
No se afirma haber ejecutado la suite completa del repositorio.

Los fallos intermedios fueron selectores que también encontraban la ayuda,
una expectativa antigua de overlay/cierre de caja, un import faltante del servidor
de prueba y un selector de select que incluía el texto de sus opciones. Se corrigieron
los tests sin eliminar las comprobaciones funcionales. Las correcciones de lógica
de esta iteración (demo, borradores, historial y paneles) tienen cobertura propia.

Cobertura: crear/cobrar/devolver pedidos, envíos y direcciones, precios y stock,
mesas, teclado y modales, impresión, cierre de caja, copias de seguridad, licencias,
actualizaciones, ocho paneles de Configuración, visibilidad/contraste a 1100/1366 px,
Mozo con QR/dos tandas/revocación, catálogos a 320/390 px, carga diferida y fallo
aislado de sección. Demo verifica restablecimiento y recuperación de una carga fallida.

Registros locales: `.codex-refine-final-typecheck.log`, `.codex-refine-final-build.log`,
`.codex-refine-final-web.log`, `.codex-refine-waiter-tests.log`,
`.codex-refine-regressions.log`, `.codex-refine-verified.log`,
`.codex-refine-last-check.log`. Capturas finales en `after/` y `last-check/`.

## Revisión y distribución

Revisiones independientes detectaron y corrigieron dos riesgos del cambio:
reset de demo sin esperar import dinámico y relaciones ARIA hacia paneles ausentes.
También se simplificó el historial de pestañas para no consumir el guard de borrador.

El árbol contiene trabajo previo de licencias, VPS, base de datos y Mozo que no
pertenece a esta iteración. No revertir archivos completos ni incluir esos cambios
en un futuro commit de estética por accidente. Si se requiere revertir, hacerlo
por bloques de esta iteración; las compilaciones son regenerables. No se tocaron
perfiles reales, instalación normal ni VPS durante estas pruebas.

**Estado de entrega:** implementado, compilado y probado localmente. Esta segunda
tanda todavía no fue distribuida a las aplicaciones instaladas ni a la página
pública de mozo; continúan con la primera iteración ya entregada. Pendiente sólo
si el usuario solicita esa actualización, preservando datos y respaldos existentes.

## Distribución solicitada y verificada · 7 de noviembre de 2026

- **PC:** actualización local 0.1.31 sin instalador ni cambio de versión. Se reemplazó sólo `resources/app.asar` con la caja normal cerrada. Respaldo de aplicación y perfil: `C:\Users\Emir\AppData\Local\DeltaNubeGastronomiaBackups\refinamiento-20261107`. Integridad SQLite comprobada; los 47 archivos nativos se conservaron. Se probaron Salón, Resumen y las ocho pestañas de Configuración en un perfil aislado. La ventana instalada abrió y respondió.
- **Caja de prueba:** se reabrió el perfil existente `hosted-aVsXlC` con su impresora simulada, en Configuración → Modo Mozo. Caja #2 abierta, un pedido y dos tandas previas, cero pendientes. No se generaron pedidos, impresiones ni QR nuevos.
- **Mozo público:** el HTML de `https://mozos.gastronomia.deltanubeweb.com/waiter` coincide byte por byte con el build. Respaldos y verificación remota: `/home/deploy/gastronomy-account-waiter-pilot/operations/waiter-page-update-20261107T190000Z/`. Sólo se reinició el contenedor de mozos; los otros 14 permanecieron iguales. Para la prueba física hay que escanear un QR nuevo.
