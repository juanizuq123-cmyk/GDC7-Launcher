# Avisos de terceros

## Electron

Runtime Windows x64 de Electron 44.5.1 reutilizado desde la distribución local
del launcher de referencia. Se incluyen LICENSE y LICENSES.chromium.html
con el portable.

## Prism Launcher

Se incluye el archivo portable oficial de Prism Launcher 11.1.1 que ya venía
en el launcher de referencia, junto con LICENSE-Prism.txt,
COPYING-Prism.md y SOURCE.txt. El launcher lo usa para importar y ejecutar el
perfil cliente y para gestionar cuentas; no inspecciona sus archivos de sesión.

## Mods del perfil cliente GDC7

El archivo `.mrpack` conserva versiones, URLs oficiales de Modrinth, tamaños,
SHA-1 y SHA-512; Prism descarga los JAR desde `cdn.modrinth.com`. Los JAR no se
redistribuyen en el portable. Los mods y sus marcas pertenecen a sus autores.
Consultá las licencias de cada versión en los metadatos de Modrinth.

La lista exacta, las dependencias, la clasificación cliente/servidor y las
builds excluidas por incompatibilidad están en el manifiesto fuente que acompaña
la entrega alpha.3 y en `docs/PACK-DECISION.md`.

## Imágenes del launcher

`app/assets/gdc7-hero.png` y `app/assets/boreal-hero.png` son ilustraciones
generadas para este launcher, no capturas del juego. Los prompts y la
procedencia están documentados en `app/assets/ART-PROVENANCE.md`.

## yauzl y pend

yauzl 3.4.0 y pend 1.2.0 se usan para leer de forma controlada el ZIP
local de Prism. Sus avisos de licencia están incluidos en los paquetes bajo
resources/app/node_modules/.

## Sora

La interfaz incluye Sora variable, distribuida bajo SIL Open Font
License 1.1. El texto completo de la licencia se incluye en
resources/app/app/assets/SORA-OFL.txt. Fuente de Google Fonts:
https://github.com/google/fonts/tree/main/ofl/sora.
