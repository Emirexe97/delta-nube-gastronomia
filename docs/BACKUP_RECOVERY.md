# Backup y recuperación

## Creación

La opción **Configuración → Crear copia local** utiliza `Database#backup()`.
Esto produce una imagen SQLite consistente aunque la base principal esté en
modo WAL. Después de escribirla se ejecuta `PRAGMA integrity_check` y se valida
la presencia de las tablas estructurales.

## Restauración

Antes de reemplazar la base activa se siguen estos pasos:

1. validar `integrity_check` y tablas requeridas en el archivo seleccionado;
2. crear `gastronomy.sqlite.before-restore` mediante la API de backup;
3. cerrar la conexión activa y eliminar `-wal`/`-shm` antiguos;
4. copiar la base seleccionada y abrir una conexión nueva;
5. ejecutar migraciones pendientes;
6. si falla el reemplazo, restaurar automáticamente la copia de emergencia.

Los handlers IPC consultan los servicios actuales en cada invocación, de modo
que después de restaurar no conservan referencias a la conexión cerrada.

## Recomendaciones operativas

- crear una copia diaria y antes de actualizar la aplicación;
- guardar copias fuera del equipo de caja;
- probar una restauración periódicamente en otro perfil;
- no copiar manualmente sólo `gastronomy.sqlite` mientras la aplicación está
  abierta, porque puede haber datos pendientes en WAL.
