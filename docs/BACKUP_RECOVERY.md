# Backup y recuperación

## Creación

La opción **Configuración → Crear copia local** utiliza `Database#backup()`.
Esto produce una imagen SQLite consistente aunque la base principal esté en
modo WAL. Después de escribirla se ejecuta `PRAGMA integrity_check` y se valida
la presencia de las tablas estructurales.

## Restauración

1. Cerrá la caja. En Configuración, elegí restaurar e ingresá el PIN propio
   de un administrador activo de **esta instalación**. Con caja abierta, PIN
   pendiente o credenciales inválidas, no se abre el selector ni se cambia la base.
2. Elegí el archivo. El POS prepara una copia temporal, valida su integridad
   y las tablas requeridas, y pide confirmación antes de reemplazar datos.
3. Si confirmás, guarda y valida un respaldo en
   `recovery/before-restore-…/current.sqlite`. Luego cierra la conexión,
   elimina los archivos WAL/SHM obsoletos y abre la base restaurada.
4. Si falla el reemplazo, intenta recuperar la base anterior. Conservá la
   ruta del respaldo que informa el POS. Si la base activa no permite verificar
   el PIN o el estado de caja, no intentes reemplazarla con la caja en uso:
   preservá los archivos y contactá a soporte para la recuperación.

Los handlers IPC consultan los servicios actuales en cada invocación, de modo
que después de restaurar no conservan referencias a la conexión cerrada.

## Recomendaciones operativas

- crear una copia diaria y antes de actualizar la aplicación;
- guardar copias fuera del equipo de caja;
- probar una restauración periódicamente en otro perfil;
- no copiar manualmente sólo `gastronomy.sqlite` mientras la aplicación está
  abierta, porque puede haber datos pendientes en WAL.
