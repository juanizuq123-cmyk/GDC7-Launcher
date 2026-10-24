# Canal firmado de Estación Boreal

Estación Boreal y Boreal Constructor son perfiles cliente separados. La app
comprueba ambos manifiestos al iniciar y descarga cada `.mrpack` a su caché
privada de Prism. Firma Ed25519, objetivo y hash del paquete se verifican antes
de ofrecer la importación. Prism crea una instancia nueva por release y deja
intactas las anteriores, los mundos y los ajustes. GDC7 usa otro updater y otra
clave.

## Estado de publicación comprobado el 24/10/2026

El repositorio configurado por la versión local del launcher,
`juanizuq123-cmyk/GDC7-Launcher`, responde HTTP 404. El repositorio público
`juanizuq123-cmyk/GDC7` publica otro launcher con Minecraft 1.21.11/Fabric; no
se usa ni se modifica. El perfil Boreal no tiene una URL pública ni release
firmada en este momento. Por eso una instalación previa que no lleve los packs
no puede recibirlos todavía desde Internet.

El launcher fuente ya incluye importación local y la verificación de los dos
packs. Para futuras instalaciones, configurá `boreal-channel-config.json` en
el código que vayas a empaquetar con:

```json
{
  "schema": 1,
  "releaseRepository": "<owner>/<repositorio-boreal-dedicado>",
  "channelUrl": "https://<owner>.github.io/<repositorio-boreal-dedicado>/channels/estacion-boreal/stable.json",
  "constructorChannelUrl": "https://<owner>.github.io/<repositorio-boreal-dedicado>/channels/boreal-constructor/stable.json"
}
```

El nombre del repositorio y su ruta no pueden contener `GDC7`; los validadores
rechazan canales Boreal alojados bajo el perfil GDC7. No empaquetes con estas
URLs hasta que el repositorio exista, Pages esté habilitado y los dos archivos
`stable.json` estén publicados.

## Publicar un perfil

1. Compila/elige el `.mrpack` cliente y confirma Minecraft 26.1.2, NeoForge
   26.1.2.95 y Java 25. Para Boreal Constructor, conserva WorldEdit solo allí.
2. Prepara `profile-input.zip` con `manifest.json` y el `.mrpack` en la raíz.
   El manifiesto sin firma declara `schema: 1`, `eventId` igual a
   `estacion-boreal` o `boreal-constructor`, `channel: stable`, `releaseId`,
   `minLauncherVersion`, el objetivo cliente, el `.mrpack` (URL, nombre,
   tamaño y SHA-256), `modCount` y notas.
3. En el repositorio Boreal dedicado crea una release publicada con tag
   `estacion-boreal-<releaseId>` o `boreal-constructor-<releaseId>` y adjunta
   `profile-input.zip`. El workflow comprueba objetivo, tag, tamaño y SHA-256;
   luego firma el manifiesto con `ESTACION_BOREAL_PROFILE_SIGNING_KEY`, sube el
   pack y manifiesto como assets y despliega el `stable.json` del perfil a
   GitHub Pages.
4. Conserva la clave privada fuera del código. El secreto de Actions debe
   corresponder a la clave pública incluida en `boreal-channel.cjs`; el
   workflow la elimina del runner al terminar. No se reutiliza ninguna clave
   GDC7.
5. Para que instalaciones existentes reciban estos cambios, primero tienen
   que estar en una versión del launcher que conoce estos dos canales y lleva
   sus URLs en `boreal-channel-config.json`. El feed actual de actualización del
   launcher apunta a un repositorio inexistente; la primera corrección exige
   una publicación inicial en el canal oficial válido. Después de esa
   transición, la comprobación e instalación del launcher es automática y cada
   catálogo Boreal puede avanzar sin reenviar el portable.

El workflow no configura por sí solo el repositorio, Pages ni el secreto. Esos
pasos aún requieren el repositorio Boreal dedicado y el acceso de administrador
correspondiente. No apuntes este proceso al repo público `GDC7`.
