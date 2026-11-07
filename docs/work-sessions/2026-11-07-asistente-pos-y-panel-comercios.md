# Asistente del POS y panel de comercios

## Objetivo y alcance

Sincronizar el asistente de caja (consultas locales y clasificación remota opcional) y el panel por comercio. Los cobros de Mercado Pago son un ensayo aislado: no registran dinero ni renuevan la licencia real. La cuenta del comercio no es el usuario de caja.

## Verificaciones antes de publicar

- Typecheck y build del workspace: 11/11 cada uno (Turbo, con caché).
- Web: 370 pruebas. Servicio de licencias y protocolo: 53. Cliente de licencias de escritorio: 19.
- Playwright: 9 escenarios focalizados de comercios, cobros simulados y asistente (bridge y escritorio). No se ejecutó la suite E2E completa ni una operación de Mercado Pago real.

## Continuidad

Base: `8bd2586`, destino: `origin/main` de Gastronomía. El push no despliega el panel, no crea cuentas, no publica instaladores ni cambia el feed. Los respaldos de instalaciones y las credenciales se mantienen fuera de Git. Para revisar o revertir el código, comparar con la base; los datos de comercios y los despliegues se gestionan por separado.
