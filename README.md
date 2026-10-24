# GDC7 Launcher

Launcher Electron para perfiles locales aislados. El perfil GDC7 conserva
Minecraft 26.1.2, NeoForge 26.1.2.95 y Java 25.

## Inicio de sesión

El botón **Iniciar sesión Premium** abre Prism para conectar una cuenta
Microsoft con acceso a Minecraft Java. Esa es la cuenta que usa Jugar. 
El vínculo opcional del Vestidor solo muestra el perfil oficial dentro del
launcher.

## Perfil Estación Boreal

El instalador local incluye `provider/packs/Estacion-Boreal-Client-0.1.0.mrpack`.
Prism crea una instancia propia de Boreal para Minecraft 26.1.2, NeoForge
26.1.2.95 y Java 25. El pack contiene únicamente el mod
`borealexpedition` 0.1.0 del proyecto `C:\Minecraft\EstacionBoreal`; no
incluye GDC7 ni archivos del servidor. El launcher verifica el SHA-256 del
pack incluido antes de importarlo.

El launcher comprueba dos canales firmados separados: Boreal y Constructor. El
manifiesto y el `.mrpack` se verifican con Ed25519 y SHA-256 antes de importar;
las versiones se descargan en cachés distintas. Cada importación crea una
instancia Prism nueva y conserva mundos, ajustes e instancias anteriores.
`boreal-channel-config.json` se incluye en el instalador y debe contener las
URLs de GitHub Pages y el repositorio Boreal dedicado antes de publicar una
build que active estos canales. Hoy sus valores están vacíos porque el repo de
actualizaciones no existe.

## Perfil Boreal Constructor

`provider/packs/Boreal-Constructor-Client-0.1.0.mrpack` es una instancia de
construcción separada con el mismo JAR Boreal que usa el perfil del evento y
WorldEdit 7.4.3-beta-01. El pack final `Estacion-Boreal-Client` no contiene
WorldEdit. El perfil Constructor fija Minecraft 26.1.2, NeoForge 26.1.2.95 y
Java 25; su archivo, hash y compatibilidad están auditados en
`pack/source/boreal-constructor-26.1.2-neoforge-v0.1.0.json`. Las futuras
versiones usan un canal firmado propio y la misma preservación de instancias.

## Desarrollo y paquetes locales

- `npm start` abre el launcher con Electron local.
- `npm run package:installer` crea un instalador NSIS por usuario en `dist/`,
  junto al SHA-256, `latest.yml` validado y un `latest.json` firmado para
  revisión local. No publica una release.
- `npm run package:portable` conserva el flujo de ZIP portable anterior para
  migración manual.
- `npm run verify:mod-sources` verifica las builds fijadas de Modrinth.
- `npm run build:pack` regenera el `.mrpack` base auditado.

La guía de firma/publicación está en `channels/estacion-boreal/README.md`; el
workflow `.github/workflows/publish-boreal-profile.yml` valida cada pack y
actualiza Pages al publicar una release en el repositorio dedicado.

## Dos canales separados

El launcher consulta `site/updates/launcher/stable/latest.json` y `latest.yml`.
El primero firma con Ed25519 la versión, el enlace, el tamaño y el SHA-512 del
instalador; el segundo es la metadata que consume `electron-updater`. Ambos
deben coincidir antes de descargar y antes de instalar. Las releases usan tags
`launcher-v<versión>`.

El perfil consulta `site/channels/gdc7/stable.json`, un manifiesto Ed25519 que
declara cada ruta, categoría, tamaño y SHA-256/SHA-512. El cliente descarga y
verifica todos los archivos antes de modificar la instancia. Mantiene una
copia de la versión anterior y revierte una transacción incompleta. Las
releases usan tags `gdc7-profile-<versión>` y assets inmutables.

Los canales aún no están activos en Internet. El repo `GDC7-Launcher` al que
apunta el canal de la app responde 404; el repo público `GDC7` publica otro
launcher para Fabric 1.21.11 y no se reutiliza. Boreal también requiere un repo
dedicado cuyo nombre no contenga `GDC7`. Habilitá Pages con fuente `GitHub
Actions`, configurá los secretos de firma y publicá la primera release para
activar las actualizaciones remotas. La instalación local continúa usando los
packs incluidos; las instalaciones anteriores conservan sus perfiles si el
canal falla.

## Primera instalación desde alpha.3 portable

La alpha.3 no contiene el updater del launcher. Abrí una vez el instalador NSIS
de la versión nueva para activar las actualizaciones automáticas del programa.
La instalación es por usuario, conserva el mismo `appId` y `dataName`, y por
eso reutiliza las carpetas existentes de Prism, cuenta y configuración. El
ZIP portable extraído queda intacto. Las actualizaciones posteriores del
launcher se instalan y reinician automáticamente.

## Publicar el launcher

1. Fijá la versión en `package.json` y confirmá que coincida con el tag
   `launcher-v<versión>`.
2. Creá y publicá ese tag. `.github/workflows/release-launcher.yml` genera el
   instalador, valida el SHA-512, firma `latest.json`, crea la release y
   actualiza `site/updates/launcher/stable/` en Pages.
3. El secreto de Actions se llama `GDC7_LAUNCHER_SIGNING_KEY` y contiene la
   clave privada `launcher-update-private.pem`.

## Publicar una versión del perfil GDC7

Prepará `profile-input.zip` con `release.json`, una carpeta `files/` que
contenga el conjunto completo de archivos que administrará el perfil y, de
forma opcional, el `.mrpack` fijado al objetivo exacto. Todos los JAR deben
tener entrada de auditoría oficial Modrinth en `release.json`; el publicador
consulta el juego, loader, archivo, hash, lados y dependencias requeridas, y
lee el rango NeoForge del JAR. No puede faltar una dependencia obligatoria.
La carpeta `files/` se publica en la release y debe contener solo contenido
que se pueda distribuir públicamente.
El `.mrpack` puede incluir solo los JAR de `mods/` y la marca interna
`config/gdc7-launcher-profile.json`; las demás configuraciones y recursos se
declaran en `files/` para que su hash y destino formen parte del manifiesto.

Creá un borrador de release con el tag `gdc7-profile-<versión>` y subí el asset
`profile-input.zip`. Al publicar el borrador, el workflow comprueba el paquete,
firma el manifiesto, sube los assets versionados, elimina el ZIP de entrada y
actualiza el puntero estable en Pages. Si algo falla, el puntero no avanza.
El secreto de Actions se llama `GDC7_PROFILE_SIGNING_KEY` y contiene
`gdc7-profile-private.pem`.

La clave local de cada canal se creó en
`%LOCALAPPDATA%\GDC7-Launcher-Secrets`. `node scripts/generate-update-keys.cjs`
solo se usa una vez para crear pares nuevos; no lo ejecutes de nuevo para
rotar claves. No subas claves privadas al repositorio ni a una release. Para
rotar una clave hay que actualizar primero la clave pública incluida en el
launcher y publicar una versión del launcher con esa clave.

El primer importador de Prism usa el `.mrpack` firmado más reciente si el
manifiesto lo incluye. Después de importar, el launcher aplica los archivos
verificados al perfil marcado como GDC7. No abre Minecraft automáticamente.
Rutas con archivos locales distintos o archivos no administrados se conservan
y la actualización completa se detiene antes de escribir.

Las releases actuales deben declarar Minecraft 26.1.2, NeoForge 26.1.2.95 y
Java 25. Una propuesta de otro objetivo queda pendiente: este build no crea
instancias nuevas para cambios de Minecraft/NeoForge. No copia mundos ni cambia
el servidor, EULA, cuentas, lista de servidores o archivos personales.

## Alcance del perfil

El pack base contiene ocho mods cliente/ambos-lados con hashes fijados. No
incluye el mod de gameplay GDC7, no instala mods solo-servidor y no configura
un servidor. JEI sigue excluido. Estación Boreal permanece en Acceso anticipado.

Leé `PRODUCT.md`, `DESIGN.md` y `docs/PACK-DECISION.md` para el alcance y las
limitaciones de las builds de mods.
