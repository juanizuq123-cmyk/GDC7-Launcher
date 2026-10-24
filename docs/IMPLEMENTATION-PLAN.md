# Estado de implementación

## Disponible en alpha.3

- Interfaz de Inicio, Eventos, Vestidor y Ajustes para dos eventos aislados.
- Ilustraciones conceptuales locales para GDC7 y Estación Boreal.
- Pack cliente GDC7 fijado a Minecraft 26.1.2, NeoForge 26.1.2.95 y Java 25.
- Ocho archivos de mods con URLs, tamaños, hashes, lados y dependencias
  registrados en `pack/source/gdc7-client-26.1.2-neoforge-v0.3.0.json`.
- Importación, gestión de cuenta y lanzamiento delegados a Prism Launcher
  11.1.1 dentro de un directorio de datos aislado.
- Java gestionado por Prism. Boreal continúa en Acceso anticipado sin pack.

## Corrección de manifiestos

La alpha.2 apuntaba a dos manifiestos Fabric 1.21.11 añadidos por error. El
proyecto real GDC7 fija 26.1.2 / NeoForge 26.1.2.95 / Java 25; ese objetivo se
conservó. Las copias anteriores verificadas están archivadas fuera de las
rutas activas de origen y empaquetado. El Prism aislado no contenía instancia
ni JARs GDC7 importados.

El manifiesto alpha.3 registra las incompatibilidades y las dependencias
excluidas. Los JARs seleccionados se hash-checkearon e inspeccionaron, pero
Minecraft no se abrió; su funcionamiento dentro del juego y la instalación de
las dependencias de ambos lados en el servidor quedan sin probar.

## Canales de actualización (implementación local 0.1.0)

- El launcher tiene canales separados y firmados para el instalador NSIS y el
  perfil cliente GDC7. El instalador local se genera y valida con
  `npm run package:installer` y `npm run verify:installer`.
- Las actualizaciones del perfil se descargan a staging, se verifican por hash,
  hacen copia de archivos administrados y revierten transacciones incompletas.
  Inicio muestra el resumen agregado/cambiado/retirado; Ajustes muestra rutas y
  notas.
- El repositorio `juanizuq123-cmyk/GDC7-Launcher` sigue sin existir (HTTP 404).
  El repo público `juanizuq123-cmyk/GDC7` corresponde a otro launcher
  1.21.11/Fabric y no es un destino compatible. La publicación requiere
  aprovisionar un repo de launcher válido y otro dedicado a Boreal; ningún
  feed, release, Pages deployment o secreto se publica desde este checkout.
- El objetivo está fijado a Minecraft 26.1.2, NeoForge 26.1.2.95 y Java 25.
  Una release que proponga otro objetivo queda pendiente; este build todavía no
  crea una instancia versionada para cambiar de Minecraft/NeoForge.
- La alpha.3 portable necesita una instalación manual única del nuevo NSIS.
  No se inició Minecraft, no se ejecutó `runClient` y no se modificaron servidor,
  mundos, EULA, cuenta ni configuración personal.
