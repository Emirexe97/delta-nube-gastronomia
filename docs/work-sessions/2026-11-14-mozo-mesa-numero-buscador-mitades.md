# 2026-11-14 — Mesa por número y buscador de mitades en Comandas

## Entrega

- El teléfono permite escribir el número de mesa y confirmar con Enter o **Abrir mesa**, sin recorrer la lista. Coincidencia exacta; si no existe o es ambiguo, no cambia el destino. Se conservan el selector y **Mis mesas**, así como los bloqueos mientras hay un borrador o envío pendiente.
- **Buscar otra mitad** filtra pizzas compatibles por nombre, sin distinguir tildes o mayúsculas. Excluye la primera pizza, selecciona automáticamente solo una coincidencia y limpia selecciones que ya no corresponden a la consulta.
- **Agregar productos** lleva al catálogo y mantiene el buscador y los primeros productos visibles en móvil.
- Guía actualizada y prueba móvil nueva con Enter, números similares, bloqueo con borrador, búsquedas ambiguas/inexistentes, normalización e IDs enviados. La prueba anterior usa el nombre exacto del selector para distinguirlo del nuevo buscador.

## Validación

- Typecheck y build: 11/11 paquetes.
- Página, relay y cierre: 28/28 pruebas.
- Regresión completa durante implementación: 16/16 E2E, incluido circuito Electron/servicio local.
- Repetición previa al commit: 9/9 E2E de mesa, mitades y reconexión.
- Captura de 390 px inspeccionada sin desbordamiento; resultados locales excluidos.

## Publicación y continuidad

Base: 22e177d. Commit/push no publica el servicio de Comandas ni actualiza instaladores. Este cambio requiere publicar el servicio móvil; no modifica contratos, base de datos ni lógica de escritorio.

No se cambió la versión 0.1.37 ni se generaron instaladores. Excluidas las carpetas locales .codex-*. La skill de commit apunta a POS Tienda; se aplicó el flujo equivalente con selección explícita en el repositorio gastronómico.

## Rollback

Revertir la página móvil, su guía y las pruebas de esta unidad, sin restaurar datos operativos ni tocar las correcciones anteriores de sesión/PIN/notas.
