# Canal de actualizaciones del perfil GDC7

**Estado:** diseño aprobado e implementación local terminada el 2026-10-22; publicación remota pendiente.

## Propósito

Permitir que el responsable de GDC7 publique versiones firmadas del perfil cliente. Al abrir el launcher, este consulta el canal estable, detecta versiones nuevas y las instala automáticamente. Una publicación del perfil puede cambiar mods, configuraciones, resource packs, shaders y otros archivos visuales del juego. La aplicación también se autoactualiza, con su propia versión, metadatos y mecanismo de instalación. Ningún canal instala contenido del otro.

## Estado actual y límites

- La versión fuente anterior era `0.1.0-alpha.3`; el paquete local actualizado es `0.1.0`. El perfil incluido fija Minecraft `26.1.2`, NeoForge `26.1.2.95` y Java `25`.
- La aplicación importa y lanza una instancia GDC7 administrada por una copia aislada de Prism.
- El portable actual se actualiza manualmente por ZIP. La cuenta conectada es `juanizuq123-cmyk`; ya tiene `GDC7` público y `GDC7-source` privado. No hay un repositorio ni URL de actualizaciones del launcher configurados.
- La alpha.3 portable no contiene código de auto-update. No puede descargar ni instalar por sí sola el primer NSIS; esa transición inicial requiere ejecutar una vez el instalador nuevo.
- El repo público autorizado `juanizuq123-cmyk/GDC7-Launcher` no se creó: la integración GitHub disponible no expone la operación de crear repositorios y GitHub respondió 404. Las URLs y flujos están preparados, pero los feeds no están publicados ni activos.
- El directorio del perfil de Prism contiene tanto archivos del juego como datos personales. La actualización debe trabajar sólo sobre la instancia GDC7 identificada por el marcador del launcher.
- El paquete inicial Modrinth sirve de línea base para instalaciones alpha.3 que todavía no tengan un recibo de archivos administrados.

## Comportamiento propuesto

### Canal y publicación

La fuente será un manifiesto JSON servido por HTTPS desde GitHub Pages en un repositorio público nuevo, propuesto como `juanizuq123-cmyk/GDC7-Launcher`. Los artefactos grandes e inmutables se descargarán de GitHub Releases. El manifiesto incluirá:

- `schema`, `eventId: gdc7`, `channel: stable`, `releaseId`, fecha, notas y versión mínima del launcher.
- Un objetivo explícito de Minecraft, NeoForge y Java. Si una publicación conserva los valores actuales, los repite sin cambios. Una diferencia debe aparecer expresamente en el nuevo manifiesto y pasar la verificación de publicación.
- La lista completa de archivos administrados: ruta relativa dentro de `.minecraft`, tamaño, SHA-256 y URL de descarga. Los archivos pueden incluir mods, configuraciones, resource packs, shaders y recursos visuales.
- Una firma Ed25519 sobre el manifiesto canónico. El launcher incluye sólo la clave pública; la clave privada queda fuera del repositorio y del portable.

Un comando de publicación debería validar el manifiesto de entrada, comprobar archivos, hashes y objetivo, generar el manifiesto firmado y dejar una carpeta lista para publicar. El canal estable del perfil vive en `channels/gdc7/stable.json` y enlaza artefactos versionados de GitHub Releases. La primera versión parte de la línea base alpha.3 y permite calcular diferencias fiables desde esa instalación. El launcher no lleva credenciales de GitHub.

### Consulta e instalación

Al iniciar, el proceso principal consulta en paralelo los feeds de la app y del perfil. La ventana no recibe acceso de red ni a las rutas locales; sólo recibe estado, progreso, notas y resumen de cambios por IPC validado. Si hay una actualización de app, se prepara e instala primero y el proceso reinicia el launcher; luego se procesa el perfil con la versión nueva. Si falla un canal, el otro puede continuar salvo que la versión del perfil exija una versión más nueva del launcher.

El launcher verifica HTTPS, firma, evento/canal, versión, límites de tamaño, rutas seguras y cada hash SHA-256. Descarga todo a staging antes de tocar la instancia. Si el manifiesto es inválido, la red falla o un archivo no coincide, conserva la versión instalada y muestra un aviso comprensible.

Si el perfil GDC7 ya está instalado, la actualización sólo se aplica a esa instancia. El launcher compara la publicación con el recibo anterior y presenta los cambios: archivos agregados, actualizados y retirados, más las notas del responsable. No modifica mundos, capturas, logs, cuentas ni archivos que el canal no administre.

Antes de reemplazar o retirar un archivo administrado, guarda una copia verificable en el área de respaldos de GDC7. La aplicación se realiza como transacción: si falla una escritura, una verificación o la actualización del marcador, restaura los archivos anteriores. Mantiene al menos la última versión confirmada para recuperación. Sólo elimina archivos presentes en el recibo confiable previo y ausentes en la publicación nueva; nunca hace limpieza amplia de carpetas.

Si el usuario todavía no instaló el perfil en Prism, el launcher descarga y valida la versión nueva en su caché; el primer importador de Prism usa esa versión. No abre Minecraft ni inicia una partida durante una actualización.

### Cambios de versión del juego

Este build fija Minecraft `26.1.2`, NeoForge `26.1.2.95` y Java `25` tanto en el cliente como en el publicador. Una release firmada que declare otro objetivo queda en estado `target-change-pending`; el perfil actual se conserva. La creación y validación de una instancia GDC7 versionada para otra versión sigue pendiente. Los mundos y datos personales no se copian ni se migran.

La publicación actual rechaza cualquier objetivo distinto del confirmado. Antes de admitir una nueva versión del juego, queda por implementar la validación de metadatos oficiales de Minecraft/NeoForge, builds oficiales de cada mod, dependencias y la creación de instancia versionada. No se presupone que el juego se ejecutó.

### Actualización de la aplicación

La distribución pasa de ZIP portable a instalador NSIS de ámbito usuario, sin privilegios de administrador. `electron-builder` genera el instalador y el metadato `latest.yml`; `electron-updater` consulta exclusivamente el feed `updates/launcher/stable/` en GitHub Pages y descarga el instalador de la release `launcher-v<versión>`. Como la línea estable de `electron-builder` compatible con el proyecto no firma criptográficamente `latest.yml`, GitHub Pages publica además un `latest.json` firmado con una clave Ed25519 propia del canal del launcher. Ese documento liga la versión, URL, tamaño y SHA-512 del instalador a la misma versión y hash de `latest.yml`. El proceso principal valida la firma y la correspondencia antes de iniciar la descarga, y comprueba el hash firmado del instalador antes de permitir la instalación. `electron-updater` aporta además su comprobación SHA-512 de `latest.yml` y la instalación NSIS. Al iniciar, una versión nueva se descarga, verifica, instala y relanza sin que el usuario tenga que buscar un ZIP.

La primera transición desde alpha.3 es manual: se descarga y ejecuta una vez el instalador NSIS inicial porque el portable viejo no incorpora el actualizador. El instalador conserva los datos actuales de Prism y del launcher al mantener el mismo `appId` y `BRAND.dataName`, y no borra la carpeta portable vieja. Desde esa instalación, las siguientes versiones del launcher se aplican automáticamente.

El feed de la app no consulta la lista de releases de GitHub: el manifiesto estable apunta a un artefacto de release específico. Así, las releases del perfil no pueden confundirse con versiones de la aplicación. La versión del launcher y la versión de GDC7 evolucionan por separado.

El canal del perfil contiene exclusivamente archivos del perfil del evento. Nunca instala ejecutables, `app`, fuentes o binarios del launcher. El canal de la app nunca instala mods, configuraciones ni recursos del evento.

La clave privada Ed25519 de `latest.json` y la clave privada Ed25519 del perfil se guardan separadas en secretos de publicación; sólo las claves públicas se distribuyen con el launcher. El repositorio, GitHub Actions y los comandos locales no escriben credenciales ni claves privadas en el código, el portable previo o los releases. La implementación usa una versión estable de `electron-builder`/`electron-updater` verificada como compatible con Electron 44.5.1; no depende de funciones disponibles únicamente en una versión preliminar.

## Fuera de alcance

- Publicar contenido en GitHub, CDN u otro hosting desde este cambio.
- Cambiar el mod de gameplay, el servidor, EULA, mundos o credenciales.
- Aceptar archivos sin firma, hash, ruta de destino o versión de perfil verificables.
- Mezclar las versiones del launcher con las del perfil GDC7 o con Estación Boreal.

## Decisiones confirmadas

- El responsable aprobó el diseño y autorizó crear `juanizuq123-cmyk/GDC7-Launcher` como repositorio público. La creación sigue pendiente porque el control del navegador no pudo verificar la URL de la ventana de GitHub; no se subió contenido.
- El responsable eligió actualización automática tanto para launcher como para perfil y reemplazar el portable por un instalador NSIS. La transición inicial desde alpha.3 sigue siendo manual.

## Referencias técnicas

- [Seguridad de Electron](https://www.electronjs.org/docs/latest/tutorial/security/): contenido remoto por HTTPS, aislamiento y validación de IPC.
- [Targets de electron-builder](https://www.electron.build/v26/docs/targets/): diferencia entre portable manual y el instalador NSIS con auto-update.
