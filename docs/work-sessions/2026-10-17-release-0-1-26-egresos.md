# 2026-10-17 — Versión 0.1.26: detalle de egresos en el ticket de caja

El usuario solicitó versión 0.1.26, commit/push, instaladores Windows y Mac, publicación y actualización de esta PC.

## Cambio

- El ticket de caja y su vista previa incluyen siempre el detalle de las salidas de efectivo del turno: tipo, concepto registrado, importe, fecha y hora de Buenos Aires.
- Incluye gastos, pagos vinculados a envíos/rendiciones, retiros, devoluciones y ajustes de salida. Identifica anulaciones, conserva los registros originales y no modifica los totales del arqueo.
- Usa los movimientos completos de la sesión aunque se filtren las ventas. Los históricos sin detalle muestran un aviso; no se inventan conceptos. No se incluyen movimientos que no afecten efectivo.
- Conceptos escapados en HTML, con ajuste de línea para tickets de 58 y 80 mm.
- Versión coherente en el manifest raíz y el shell: 0.1.26. No cambia identidad de aplicación, base de datos ni licencia.

## Validación de fuente

- Dominio: 41 pruebas aprobadas.
- Ticket: 8 pruebas aprobadas, incluido render de conceptos extensos y comprobación de ancho/solapamiento en 58 y 80 mm. Captura de 58 mm revisada.
- Typecheck y build de dominio, web y shell aprobados. Después del cambio de versión se recompiló el shell.
- Suite desktop: 76 pruebas aprobadas.
- Los archivos de evidencia, bases, instaladores y el respaldo local ajeno a esta entrega se mantienen fuera del commit.

## Distribución e instalación

- El usuario confirmó que no dispone de certificado Authenticode. `updates-config.json` permanece deshabilitado. No se habilita ni se considera validado el canal automático: requiere firma, feed HTTPS configurado y un ensayo real entre versiones.
- Se preparan instaladores manuales y publicación de descarga en GitHub Releases. Mac conserva el workflow arm64/x64 con firma ad-hoc y verificaciones dentro del DMG; no equivale a notarización ni prueba física de impresión.
- Antes de instalar se detectó caja #33 del 17/10 abierta; se informó al usuario que la actualización de esta PC espera el cierre real del turno. No se cierra caja ni se cambian movimientos desde herramientas.
- La instalación requiere respaldo consistente nuevo, comprobación de integridad, comparación de datos antes/después, versión instalada y licencia operativa. Estado y hashes finales se registrarán al completar esas etapas.
