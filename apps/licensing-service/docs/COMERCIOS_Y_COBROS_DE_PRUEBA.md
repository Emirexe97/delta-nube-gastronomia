# Panel por comercio y cobros de prueba

## 1. Administrar licencias

En el panel privado, **Comercios** incluye las licencias anteriores, aunque no tengan correo o equipo asociado. Buscá por negocio, correo, equipo o ID. En **Ver detalle** se distinguen la vigencia efectiva, el último pago real registrado y el historial.

- **Alta de comercio** crea la licencia, sin inventar un pago. Elegí una fecha (o explícitamente “Sin vencimiento”). **Crear cuenta** permite asociar el correo y contraseña de acceso a esa licencia.
- **Registrar pago ARS** es para un pago **ya recibido**, por ejemplo una transferencia verificada. Ingresá importe, fecha hasta la que habilita y motivo. **Cargar cortesía** permite extender la fecha sin registrar dinero.
- **Suspender / Reactivar acceso** es una decisión aparte: una renovación nunca levanta una suspensión. La PC conocerá el cambio al volver a verificar. Se conserva el período vigente y la regla de tres días de gracia por vencimiento.
- El historial conserva motivo, momento y operador de las nuevas acciones del panel. Las licencias históricas sin comprobantes no figuran como pagos recibidos. Las escrituras manuales verifican revisión y clave de operación para no duplicar reintentos.

### Vista previa en esta PC

Desde la raíz del proyecto, con las dependencias ya instaladas:

```powershell
pnpm --filter @gastronomy/licensing-service... build
node apps/licensing-service/scripts/preview-merchants.mjs
```

Abrí la dirección local que imprime el segundo comando. El usuario y contraseña de esa sesión aparecen en la misma terminal. Sólo escucha en 127.0.0.1, usa SQLite en memoria y tres comercios ficticios. **Ctrl+C** descarta todo. No lee credenciales de Mercado Pago ni toca el software instalado. Esta vista previa tiene los cobros automáticos apagados.

**Para probar las dos etapas sin configurar nada**, iniciá el mismo comando con `--simular-cobros`. En la ficha de un comercio, creá la adhesión con `comprador_prueba@testuser.com`. En esa misma terminal escribí `rechazar`, luego `aprobar` y finalmente `reintegrar`; actualizá el panel después de cada comando. Los comandos actúan sobre la última adhesión creada, enviando una notificación firmada **sólo al servidor local**. No se abre ningún checkout. Escribí `salir` para descartar el ensayo.

## 2. Ensayar una suscripción de Mercado Pago

**Nunca cambia la licencia real ni el historial de pagos manuales.** La adhesión, el último resultado y la fecha de cobertura **simulada** se guardan por separado. No se recopilan números de tarjeta ni códigos de seguridad. El comercio no se adhiere automáticamente al crear la cuenta.

1. En una instancia **de pruebas aislada**, abrí la ficha de un comercio ficticio y creá su adhesión de prueba con el correo del comprador de prueba configurado y el importe mensual en ARS.
2. Abrí el enlace oficial de adhesión sólo con la cuenta y tarjeta de prueba. Que se autorice la suscripción, o que el navegador vuelva al sitio, **no acredita el mes**.
3. El servidor verifica la firma de la notificación y consulta la cuota, la suscripción y, si existe, el pago a Mercado Pago. Sólo un pago canónico aprobado de prueba (`live_mode: false`) por el importe, moneda y período correctos otorga vigencia **simulada**. Los eventos repetidos no suman días. Un rechazo no corta un mes anterior; un reintegro revierte el crédito afectado.
4. **Verificar ensayo** permite consultar la suscripción y, opcionalmente, una cuota si faltó una notificación. Usá el ID de la cuota recurrente (`authorized_payment`), no el número de tarjeta ni el ID del pago. Una creación sin respuesta concluyente queda en revisión: verificá por ID antes de reintentar.
5. **Cancelar prueba** detiene la suscripción de prueba en el proveedor, sin borrar los períodos ya confirmados. Suspender la licencia y cancelar el débito son acciones distintas.

### Configuración sólo en staging

Usá una autoridad con **base de datos, clave de firma, credenciales y origen del panel distintos** de producción. Para probar desde una PC, usá también un perfil de escritorio aislado. Nada de este procedimiento requiere alterar la autoridad productiva o el sitio de mozos.

| Variable                                      | Uso                                                                                                                                                                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MP_SANDBOX_ENABLED=true`                     | Opt-in del servidor. Si se omite, no hay conexión al proveedor ni webhook habilitado.                                                                                                                            |
| `MP_SANDBOX_ACCESS_TOKEN_FILE`                | Archivo privado con el token del entorno **Prueba** de Mercado Pago. También admite `MP_SANDBOX_ACCESS_TOKEN`; preferí el archivo.                                                                               |
| `MP_SANDBOX_BUYER_EMAIL`                      | Correo de la cuenta compradora de prueba con dominio `@testuser.com`.                                                                                                                                            |
| `MP_SANDBOX_SELLER_ID`, `MP_SANDBOX_BUYER_ID` | IDs distintos de las cuentas de prueba argentinas. Obligatorios para el prefijo ambiguo `APP_USR-`. También conviene configurar el ID de comprador con `TEST-`, porque algunas respuestas traen sólo `payer_id`. |
| `MP_SANDBOX_WEBHOOK_SECRET_FILE`              | Archivo privado con la clave de firma del webhook de pruebas (mínimo 32 caracteres). También admite `MP_SANDBOX_WEBHOOK_SECRET`.                                                                                 |
| `MP_SANDBOX_BACK_URL`                         | URL HTTPS de retorno del sitio de prueba. No acredita ni recibe pagos.                                                                                                                                           |
| `MP_SANDBOX_NOTIFICATION_URL`                 | URL HTTPS de staging terminada en `/billing/test/mercadopago/webhook`. Configurar también las notificaciones y firma de prueba en la aplicación del proveedor.                                                   |

El prefijo `APP_USR-` **no identifica por sí solo el entorno**. Antes de operar con esa credencial, el adaptador exige que el proveedor identifique al titular del token y al comprador como las cuentas de prueba esperadas de Argentina (`MLA`, etiqueta `test_user`). Si no puede comprobarlo, se detiene. No usar tokens de producción para intentar sortear un rechazo.

El staging necesita HTTPS entrante para ese único webhook y salida a `api.mercadopago.com` (y `api.mercadolibre.com` para verificar las identidades). No exponer `/admin`, ni abrir la red interna de producción. Configurá eventos de actualización de suscripción, cuota recurrente y pago. Guardá secretos fuera de Git; nunca pegarlos en el chat, en argumentos de comandos o capturas.

### Validación sin credenciales

```powershell
pnpm --filter @gastronomy/licensing-service... build
pnpm --filter @gastronomy/licensing-service test
```

La suite levanta la API local y prueba notificaciones firmadas, aprobación, rechazo, duplicados, cancelación y reintegro contra respuestas de proveedor **simuladas**. Compara la licencia real antes/después. No demuestra conectividad con una aplicación de Mercado Pago real: para esa última validación hacen falta la configuración de staging, las cuentas y las credenciales de prueba. No existe un interruptor de cobro en vivo en esta implementación.

Referencias del proveedor: [Suscripción con pago pendiente](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/integration-configuration/subscription-no-associated-plan/pending-payments), [compra de prueba](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/integration-test/payment-approval), [credenciales](https://www.mercadopago.com.ar/developers/es/docs/your-integrations/credentials), [identidad de usuarios de prueba](https://developers.mercadolibre.com.ar/consulta-usuarios), [notificaciones](https://www.mercadopago.com.ar/developers/es/docs/links-and-debts/additional-content/your-integrations/notifications/webhooks).
