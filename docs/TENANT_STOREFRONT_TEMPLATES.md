# Plantillas del storefront multi-tenant

Cada comercio se identifica por el **Host HTTP de entrada** (`slug.<sufijo-configurado>`), nunca por `X-Forwarded-Host`, parámetros ni datos del cliente. Reservá los labels de hosts de API/operación al montar el handler. El slug es una única etiqueta DNS exacta; hosts desconocidos responden 404.

La apariencia STANDARD permite nombre, descripción breve y color de acento (`#RRGGBB`). El renderer escapa texto y descarta cualquier color fuera de la forma hexadecimal; no admite HTML, CSS ni JavaScript del comercio.

El operador puede activar `CUSTOM` sólo con una clave de plantilla versionada en código (`midnight-market-v1` hoy). Para añadir un diseño, implementá su variación como CSS estático del renderer y agregá una allowlist explícita; no cargues plantillas, recursos ejecutables ni estilos arbitrarios desde tenant_sites. Volver a STANDARD limpia la clave mediante la herramienta privada `tenant:design`.

Las páginas usan los mismos endpoints same-origin (`/api/catalog`, `/api/checkout`). El backend deriva store/site exclusivamente del Host resuelto y lee/escribe mediante OrdersStore local.
