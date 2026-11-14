# Registro sin tarjeta y prueba de 30 días

**Implementación local, deshabilitada por defecto en el servidor. No publicada.** El registro público, la recuperación por correo y la prueba usan la autoridad existente, sin reemplazar cuentas/licencias anteriores ni activar cobros reales.

## Recorrido del cliente

1. En `/registro/`, deja su correo. Recibe un enlace de un solo uso, válido por 30 minutos.
2. Desde ese enlace elige nombre de negocio y contraseña. **Todavía no empieza la prueba.** No se solicita tarjeta.
3. `/descargas/` muestra sólo instaladores HTTPS que el operador haya configurado; sin enlaces configurados informa que no están disponibles. No genera ni publica archivos.
4. Instala el cliente actualizado e ingresa en **Configuración → Licencia → Ingresar con mi cuenta**. La primera activación exitosa en el servidor inicia exactamente **30 × 24 horas**. Necesita Internet para esa activación.
5. Desde **Configuración → Página web** solicita un subdominio disponible y carga su WhatsApp. Se incluye en la prueba, con la misma fecha de vencimiento. No se compra un dominio propio.
6. Puede operar offline con su permiso firmado durante la prueba. Reingresar, recuperar contraseña o reinstalar conservando la identidad no reinicia los días. Cambiar de PC requiere asistencia, como las cuentas anteriores.
7. Al vencer se bloquean nuevas operaciones del POS según la lista de recuperación existente; no se borra la base local. La carta muestra «Sitio pausado» y no acepta nuevos pedidos. Una renovación manual real conserva la licencia, los datos y la dirección; al verificar desde el POS se actualiza la vigencia del sitio.

**No hay tres días adicionales para el trial.** La gracia de licencias pagas/anteriores se mantiene. No se ha implementado checkout de producción, débito automático, correos programados de vencimiento ni una política automática de eliminación/reutilización de subdominios. La contratación continúa mediante administración hasta completar ese trabajo; Mercado Pago sandbox no acredita licencias reales.

## Habilitación: requisitos antes de producción

No activar el registro sólo porque compilaron los servicios. Primero validar en staging separado:

- [ ] Cliente nuevo compatible (`trialProtocol: 1`) y servicios de licencias/Pedidos de esta entrega. Clientes anteriores reciben «actualizar aplicación» sin consumir el trial. Un servicio Pedidos anterior podría ignorar la vigencia del ticket: no mezclar versiones.
- [ ] Instalar y probar los artefactos finales Windows y Mac, firma/notarización y descarga anónima HTTPS. No usar links privados de CI ni URLs temporales. Mantener updater Mac apagado; no afirmar Windows updater operativo por estos cambios.
- [ ] SMTP real, remitente autorizado, SPF/DKIM/DMARC y entrega tanto de registro como recuperación en buzones externos. No se eligió ni contrató proveedor. Validar filtros y entrega: aceptación SMTP no garantiza llegada al inbox.
- [ ] Permitir salida TLS SMTP desde la autoridad (la red Docker interna previa puede impedirla); cambiar topología sólo con autorización y sin exponer la base o administración.
- [ ] Capacidad real: memoria para hashes concurrentes, almacenamiento, tráfico y costo de cartas. No hay medición de carga ni promesa de costo cero.
- [ ] Reglas antibot del edge y observabilidad de envíos/fallos. Los límites de aplicación son conservadores para un piloto; detrás de un proxy los usuarios comparten cupo por IP del socket. No confiar ciegamente en `X-Forwarded-For` para ampliarlo.
- [ ] Textos aprobados de privacidad/condiciones, política de retención, soporte de falso positivo y condiciones/precio de contratación. No se inventaron condiciones comerciales ni consentimiento de cobro.
- [ ] Backup consistente de ambas autoridades y ensayo de retorno; smoke público sin tocar negocios existentes.

## Configuración del servicio de licencias

| Variable                           | Requisito                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_REGISTRATION_ENABLED=true` | Opt-in explícito. Ausente: formularios informan indisponibilidad; API de escritura responde 503. No afecta las activaciones de cuentas existentes. |
| `PUBLIC_REGISTRATION_ORIGIN`       | Origen HTTPS exacto donde se sirven formularios y API, sin path ni slash final. HTTP sólo loopback para ensayos. No se permiten POST cross-origin. |
| `REGISTRATION_SMTP_HOST`           | Host SMTP del operador.                                                                                                                            |
| `REGISTRATION_SMTP_PORT`           | 465 (TLS directo, predeterminado) o 587 (STARTTLS obligatorio). Certificado verificado; nunca TLS inseguro.                                        |
| `REGISTRATION_SMTP_USER`           | Usuario SMTP.                                                                                                                                      |
| `REGISTRATION_SMTP_PASSWORD_FILE`  | Archivo de secreto fuera del repositorio/imagen. No contraseña en argumentos de consola.                                                           |
| `REGISTRATION_MAIL_FROM`           | Dirección simple del remitente autorizado.                                                                                                         |
| `PUBLIC_DOWNLOAD_WINDOWS`          | URL pública HTTPS del instalador Windows compatible.                                                                                               |
| `PUBLIC_DOWNLOAD_MAC_ARM64`        | URL pública HTTPS del DMG Apple Silicon compatible.                                                                                                |
| `PUBLIC_DOWNLOAD_MAC_X64`          | URL pública HTTPS del DMG Intel compatible.                                                                                                        |

La dependencia SMTP está fijada a Nodemailer 10.5.0; no agrega SDK de un proveedor. Se deshabilitan lectura de archivos/URLs de mensajes y logging SMTP. No se imprimen enlaces de recuperación, claves ni contraseñas. El ensayo automatizado captura correos sólo en memoria, **sin enviar correos reales**.

La autoridad sirve `/registro/`, `/recuperar/`, `/descargas/`, `/public-assets/account.{js,css}` y `/public/api/*`. El fragmento estático del portal no captura esas rutas, por lo que siguen al proxy de licencias existente. Conservar `/admin*` bloqueado, `/manage/` privado y las rutas de otros servicios. La web comercial del repositorio `Deltanubeweb` no fue modificada: conectar allí el CTA cuando se autorice publicar.

## Seguridad y límites explícitos

- Flujo email-first: nunca se toma una contraseña elegida por un tercero antes de verificar el correo. Tokens aleatorios, hash en SQLite, TTL, consumo transaccional y borrado de hermanos. El enlace va en fragmento y la página lo quita de la barra; nunca localStorage.
- 20 solicitudes públicas/minuto por IP del socket, 100 solicitudes de envío/24 h globales por instancia de autoridad, cooldown persistente de correo de 60 s, hasta 10.000 tokens vivos. Hashes públicos y envíos tienen concurrencia acotada. Respuestas de solicitud son genéricas, incluso ante fallo SMTP, para no revelar cuentas.
- La contraseña de cuenta se guarda con el scrypt existente, no en texto plano. El inicio del trial y la vinculación del dispositivo son una sola transacción: una carrera entre PCs no concede dos pruebas.
- La identidad criptográfica existente evita volver a probar con otra cuenta **en la misma identidad/instalación**. No es una huella de hardware y no impide que alguien borre su perfil y cambie de correo. No se implementó verificación telefónica ni identificación fiscal ni detección de hardware; no prometer «una prueba por persona/comercio» infalible.
- Para licencias nacidas del trial, `accessUntil` viaja firmado en el ticket de sitio y se persiste en Pedidos. Actualizaciones de vigencia sólo pueden extenderlo; un ticket viejo o legacy no lo acorta ni elimina. Sitios anteriores sin fecha conservan su comportamiento.
- Una suspensión administrativa no implica despublicación inmediata del sitio antes de `accessUntil`; el cambio implementado cierra **vencimiento**, no revocación instantánea. Pago/renovación del sitio requiere que el POS obtenga y transmita ticket fresco. Si falla, reintenta con backoff; no reinicia el trial.

## Unidades de revisión y reversión

| Unidad                       | Archivos / frontera de reversión                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registro verificado y correo | `public-registration.ts`, `public-account-http.ts`, `registration-mail.ts`, rutas públicas/SMTP en `server.ts`, assets públicos y dependencia. Desactivar altas con `PUBLIC_REGISTRATION_ENABLED` sin borrar tablas ni cuentas.             |
| Trial y activación           | `license_trials`, activación y firma en `server.ts`, protocolo `packages/licensing`, DTO/cliente/panel. **No volver al cliente previo para trials activos**: rechaza su permiso sin gracia. Preservar registros de elegibilidad/vigencia.   |
| Subdominio con vencimiento   | Claim `accessUntil`, columna aditiva `tenant_sites.access_until`, guards y refresh. Revertir a Pedidos antiguo retiraría el bloqueo de trial: pausar altas y preservar protección antes de cualquier rollback. No borrar catálogos/pedidos. |

No hacer rollback general de bases ni instalar sobre perfiles reales para comprobarlo. Las pruebas usan puertos loopback, perfiles temporales y claves ficticias.

## Verificación local

```powershell
pnpm typecheck
pnpm build
pnpm --filter @gastronomy/licensing-service test
pnpm --filter @gastronomy/orders-service test
pnpm --filter @gastronomy/web-orders test
node --test apps/desktop-shell/src/licensing.test.ts apps/desktop-shell/src/web-site-provisioning.test.ts
pnpm exec playwright test tests/e2e/public-registration.spec.ts tests/e2e/self-service-journey.spec.ts
```

El journey real une formulario web → correo capturado → cuenta SQLite → UI Electron → licencia trial → subdominio en servicio Pedidos → reinicio offline. No demuestra entrega SMTP externa, descarga/instalación comercial, funcionamiento físico Mac ni cobro real.

### Resultado de esta entrega local (2026-11-14)

- Typecheck y build generales: 11/11 paquetes correctos en ambos.
- Pruebas: licencias/registro 64, Pedidos 52, protocolo web-orders 11, protocolo licensing 9, escritorio 26 y panel web 6, todas aprobadas.
- E2E: 7 aprobadas (4 de registro público, 2 de cuentas existentes y 1 del recorrido real web → Electron → subdominio → reinicio offline).
- Evidencia local en `docs/qa/evidence/self-service-real/` y `docs/qa/evidence/self-service-regression/` (directorios ignorados por Git).
- Sin despliegue, commit, push, cambio de versión ni generación de instaladores. El alta pública continúa sujeta al opt-in y a los requisitos anteriores.
