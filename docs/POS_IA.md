# Consultar con IA: configuración del servidor

Las diez preguntas de **Preguntale al POS** funcionan sin internet, credencial de Google ni cupo. El botón **Consultar con IA** es optativo: envía el texto escrito por el operador para que Gemini elija una pregunta conocida. El POS verifica el permiso de esa persona y calcula la respuesta con los informes locales. No es un chat abierto ni ejecuta operaciones.

## Activar en el servicio de licencias

1. Creá una clave dedicada para Gemini en [Google AI Studio](https://aistudio.google.com/apikey). Revisá el proyecto y su facturación antes de activarla. No compartas la clave por chat ni la copies al POS.
2. En el **servidor**, guardá únicamente el valor de la clave en un archivo de secretos legible por el proceso del servicio, no por otros usuarios. Para el despliegue documentado, la ruta en el host es `/home/deploy/gastronomy-licensing/licensing-secrets/gemini-api-key`. No agregues este archivo a Git, a la imagen ni al instalador.
3. En Docker, agregá **`docker/licensing/pos-ai.override.yml`** al mismo conjunto de archivos Compose que ya usa tu despliegue, sin quitar los del panel u otros servicios habilitados. El montaje existente de solo lectura expone el archivo como `/run/credentials/gemini-api-key`; el override define `GEMINI_API_KEY_FILE` y agrega una red de salida sin publicar puertos. Desde esa red se necesitan DNS y HTTPS hacia `generativelanguage.googleapis.com`; si usás firewall de egreso, permití ese destino.
4. Publicá el servicio actualizado y recreá el contenedor `api` con esa configuración. Si ejecutás Node sin Docker, definí `GEMINI_API_KEY_FILE` apuntando al archivo o inyectá `GEMINI_API_KEY` desde el gestor de secretos y reiniciá el proceso. El archivo tiene prioridad. `POS_AI_MODEL` es opcional; el predeterminado es `gemini-3.1-flash-lite`. Para rotar la clave reiniciá el servicio luego de reemplazar el secreto.
5. Probá con el POS actualizado y una instalación aprobada, con licencia activa. En la barra superior escribí, por ejemplo, «¿cuánta plata entró por ventas hoy?», elegí **Consultar con IA** e identificá al operador con su número de personal y PIN. Para la primera prueba usá datos ficticios. Si usás un proxy con lista de rutas permitidas, debe admitir los POST de `/v2/devices/challenge` y `/v2/pos/ai`; no abras rutas de administración.

## Qué consume y qué se guarda

- Una consulta remota admitida consume **una** de 20 por usuario y 100 por comercio al día, con **60 segundos** entre consultas del mismo usuario. Los cupos diarios se reinician a las 00:00 de Buenos Aires; cerrar caja, cambiar la hora de la PC o reiniciar no reinicia el contador.
- Los contadores se reservan en SQLite del servidor, antes de llamar a Gemini. Una consulta despachada cuenta aunque no encuentre coincidencia o falle el proveedor. No hay reintentos automáticos de pago. Buscar, responder preguntas locales, estar sin conexión o recibir un rechazo previo a la reserva no consume.
- La identidad comercial se obtiene de la licencia de la instalación aprobada; el usuario se identifica con el padrón y PIN del POS. El PIN se valida en la caja, nunca se envía. Ni tickets, ni tablas, ni totales ni historiales se agregan al mensaje: **sí se envía a Google lo que escribas**, por eso no incluyas datos personales ni secretos. Los contadores no guardan preguntas ni respuestas.
- Para volver al modo exclusivamente local, quitá la configuración de Gemini y recreá/reiniciá el servicio. No borres la base de licencias. Las funciones de caja no dependen de Google.
