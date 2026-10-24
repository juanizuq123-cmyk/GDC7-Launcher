# Publicación de releases del perfil GDC7

Cada publicación es un conjunto completo de archivos administrados por el
launcher. No incluyas mundos, cuentas, `options.txt`, `servers.dat`, datos
personales ni archivos que no tengas derecho a redistribuir.

## Estructura de `profile-input.zip`

Al extraer el ZIP, `release.json` y `files/` deben estar en su raíz:

```text
release.json
GDC7-Client-26.1.2-NeoForge-<versión>.mrpack  # opcional
files/
  mods/
    mod-a.jar
  config/
    gdc7/
      ajustes.json
  resourcepacks/
    GDC7-visual.zip
```

Ejemplo de `release.json`:

```json
{
  "schema": 1,
  "eventId": "gdc7",
  "channel": "stable",
  "publishedAt": "2026-10-22T12:00:00.000Z",
  "minLauncherVersion": "0.1.0",
  "target": {
    "minecraft": "26.1.2",
    "loader": "neoforge",
    "loaderVersion": "26.1.2.95",
    "javaMajor": 25,
    "installSide": "client"
  },
  "notes": "Resumen breve de cambios visibles para el jugador.",
  "categories": {
    "mods/mod-a.jar": "mod",
    "config/gdc7/ajustes.json": "config",
    "resourcepacks/GDC7-visual.zip": "resource"
  },
  "mods": [
    { "path": "mods/mod-a.jar", "projectId": "ID_DE_MODRINTH", "versionId": "ID_DE_VERSION" }
  ],
  "installPack": "GDC7-Client-26.1.2-NeoForge-<versión>.mrpack"
}
```

`mods` tiene una entrada por cada JAR de `files/`. El publicador consulta la
API oficial de Modrinth y comprueba la versión exacta de Minecraft y NeoForge,
el hash del archivo, el rango declarado por el JAR, el lado cliente y el cierre
de dependencias obligatorias. Una dependencia requerida debe estar incluida
en `files/mods/` con su versión fijada. El `.mrpack` opcional debe declarar el
mismo objetivo y los mismos hashes de mods.
El `.mrpack` puede incluir únicamente los JAR de `mods/` y la marca interna
`config/gdc7-launcher-profile.json`. Los demás overrides deben publicarse en
`files/` para quedar enumerados, hash-verificados y aplicarse después de la
importación. El publicador rechaza rutas de mundos, capturas, logs,
configuración personal y carpetas reservadas del launcher antes de copiar
assets a la release.

Si el manifiesto no trae `installPack`, la primera importación usa el `.mrpack`
base incluido en el launcher; los archivos de la release se aplican después de
que Prism termina la importación.

## Publicar

1. Comprueba el contenido y crea un ZIP con la estructura anterior. No incluyas
claves privadas.
2. En GitHub, crea un borrador con el tag `gdc7-profile-<semver>` y adjunta el
   asset `profile-input.zip`.
3. Publica el borrador. El workflow valida las fuentes, hashes, dependencias y
   objetivo; firma un manifiesto con la clave del perfil; sube assets
   inmutables y hace avanzar `site/channels/gdc7/stable.json` solo al final.
4. Si la validación falla, corrige el ZIP y publica una nueva versión/tag. No
   reutilices una versión ya publicada.

El secreto de Actions `GDC7_PROFILE_SIGNING_KEY` debe ser el PEM de
`%LOCALAPPDATA%\GDC7-Launcher-Secrets\gdc7-profile-private.pem`. El launcher
incluye solo la clave pública de este canal, distinta de la clave del launcher.

El objetivo de este build está fijado a Minecraft 26.1.2, NeoForge 26.1.2.95
y Java 25. Una release con otro objetivo queda pendiente; este updater todavía
no crea una instancia Prism versionada para migrarlo.
