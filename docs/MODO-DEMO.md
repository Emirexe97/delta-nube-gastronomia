# Modo demostración en navegador

Permite revisar cambios visuales y funcionales del frontend sin reinstalar la aplicación de escritorio.

## Iniciar

Desde la raíz del proyecto:

```powershell
pnpm dev:demo
```

Abrir [http://127.0.0.1:5173](http://127.0.0.1:5173). Vite actualiza la pantalla automáticamente al guardar cambios.

## Datos y seguridad

- Los datos de prueba se guardan únicamente en `localStorage` del navegador.
- No se abre ni se modifica la base SQLite del programa instalado.
- La impresión, la exportación y las copias de seguridad están simuladas.
- El PIN de demostración para descuentos, cancelaciones y otras acciones protegidas es `1234`.
- El botón **Modo demostración · Restablecer** borra los cambios de prueba y recupera el escenario inicial.

El comando normal de escritorio no activa este adaptador. La compilación e instalación continúan usando la API real de Electron.
