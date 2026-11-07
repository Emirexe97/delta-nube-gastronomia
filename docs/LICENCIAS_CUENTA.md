# Licencia con cuenta del programa

La cuenta es propia de Delta Nube Gastronomía, independiente del catálogo web y de los usuarios/PIN de caja y mozos. Un administrador crea el correo y la contraseña sobre una licencia existente desde el panel privado, **Crear cuenta**. **Restablecer contraseña** exige verificar al titular y registrar un motivo; no permite consultar la contraseña anterior. No hay alta pública ni recuperación automática por correo en esta versión.

## Activación

En **Configuración → Licencia → Ingresar con mi cuenta**, ingresar correo y contraseña. El servidor valida credenciales y una prueba firmada por el equipo. La primera activación vincula atómicamente una licencia, una cuenta y una PC. Repetirla desde el mismo equipo no consume otra licencia. Una segunda instalación, otra clave que intente reutilizar el identificador o un dispositivo rechazado explícitamente no sustituyen el vínculo existente. El cambio de PC requiere intervención de administración; no hay transferencia automática.

El equipo guarda el permiso firmado y la clave privada protegida por el almacenamiento seguro del sistema; **no guarda la contraseña de la cuenta**. El permiso local se conserva al reiniciar. Sin Internet, la caja puede cargar, confirmar y cobrar pedidos durante la vigencia del permiso y sus tres días de gracia. La verificación demorada por sí sola no bloquea un período abonado. Vencimiento, suspensión recibida o problemas de integridad/reloj mantienen las restricciones existentes. Una suspensión remota no puede conocerse instantáneamente si la PC está desconectada.

Las licencias y clientes anteriores conservan sus endpoints de código y solicitud manual; no se migra ni invalida su información automáticamente. Cambiar la contraseña impide futuros ingresos con la anterior, pero no borra un permiso offline ni cambia el equipo vinculado. Para suspender una licencia se usa la acción separada **Suspender**.

## Seguridad y operación

- Contraseñas de 15–128 caracteres, hash scrypt separado del formato histórico del panel. Comparación constante, respuestas genéricas de credenciales, cuotas por IP/correo y concurrencia de hash acotada. Parámetros basados en [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt).
- API administrativa: `POST /admin/accounts` con token privado; panel: `POST /manage/api/accounts` con sesión, origen y CSRF. No copiar token ni contraseñas en argumentos de consola, QR o logs.
- Activación: `POST /v2/accounts/activate`, con desafío de propósito `lease`. Renovación posterior: prueba del dispositivo en `/v2/devices/lease`, sin reenviar contraseña.
- Una única instancia de autoridad/SQLite; respaldar base y clave firmante de forma segura. Las cuotas en memoria requieren controles adicionales del proxy si se cambia la topología.
- Cuenta de licencia y servicio Mozo no sustituyen HTTPS en producción. El teléfono nunca recibe credenciales de licencia.

## Estado de esta entrega

Implementación y pruebas locales; **no desplegada en hosting/VPS ni incluida en un instalador nuevo**. La configuración de licencia empaquetada no se cambió. Para el piloto aislado de esta PC, consultar [PRUEBA_LOCAL_CUENTA_MOZO.md](PRUEBA_LOCAL_CUENTA_MOZO.md). La autoridad y cuenta ficticias del piloto no habilitan negocios reales.

## Verificación y reversión

Las pruebas cubren activación con UI real de Electron, reinicio con autoridad apagada y pedido/cobro local; también firma, clave/instalación incorrectas, rechazo previo, carrera de dos PCs, contraseña incorrecta, timeout/body excesivo, sesiones/CSRF, persistencia y compatibilidad legacy. El circuito Mozo existente prueba respuesta perdida, agregados, impresión fallida, revisión >60 s y confirmación repetida con impresora simulada. Papel y conectividad del teléfono físico se validan aparte.

Reversión de esta unidad: retirar los métodos de cuenta, UI de cuenta y rutas/tablas nuevas (con respaldo previo); conservar rutas legacy y permisos firmados. El piloto es independiente y se detiene cerrando su ventana; no sobrescribe datos ni configuración de la aplicación habitual.
