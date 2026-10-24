# Perfil cliente GDC7 NeoForge

## Objetivo confirmado

El proyecto real en `C:/GDC7/mod` fija Minecraft 26.1.2, NeoForge 26.1.2.95
y Java 25. Se contrastaron `mod/build.gradle`, el manifiesto NeoForge generado
y `AGENTS.md`. El perfil del launcher usa esas mismas versiones; no se bajó el
objetivo para acomodar mods.

## Corrección del pack anterior

La alpha.2 referenciaba por error manifiestos Fabric para Minecraft 1.21.11.
En el Prism aislado del launcher no había instancia GDC7 importada ni JARs de
mods instalados. Por eso no se retiró ni se respaldó ningún JAR de usuario.

Se conservaron copias verificadas de los manifiestos y del `.mrpack` anterior
en `pack/archive/gdc7-fabric-1.21.11-20261021/`. Esos archivos ya no forman
parte del pack que se genera ni del portable alpha.3. Los SHA-256 de esas
copias están guardados en el registro de corrección de la entrega.

## Mods incluidos

El manifiesto fuente es `pack/source/gdc7-client-26.1.2-neoforge-v0.3.0.json`.
El `.mrpack` incluye ocho mods, descargados desde Modrinth y fijados por
versión, URL, tamaño, SHA-1 y SHA-512:

- Cliente: Sodium 0.9.2, ImmediatelyFast 1.15.3, ModernFix 5.27.24,
  Xaero's World Map 1.47.1 y Easy Building 1.1.0.
- Cliente y servidor: TrashSlot 26.1.2.4 y su dependencia Balm 26.1.2.15;
  Construction Sticks 3.2.1 beta.

TrashSlot, Balm y Construction Sticks se marcan para ambos lados. El pack es
solo cliente y no cambia el servidor; antes de usarlos en el servidor GDC7
deben instalarse allí las mismas builds de esos tres mods. Easy Building es
solo cliente y su autor advierte que algunos servidores pueden prohibir la
colocación rápida. JEI no está incluido; las dependencias opcionales a JEI se
mantienen fuera del pack.

El JAR de cada mod se descargó del CDN oficial de Modrinth en una carpeta de
auditoría temporal, se cotejó tamaño/SHA-1/SHA-512 con el registro de la API y
se inspeccionó su `META-INF/neoforge.mods.toml`. Los JAR no se redistribuyen:
el índice Modrinth del `.mrpack` guarda sus hashes y Prism los descarga al
importar. La lista conserva el tipo de release; Construction Sticks es beta.

## Revisiones y pendientes

- Pick Up Notifier tiene una build NeoForge que declara 26.1.2, pero depende de
  Puzzles Lib 26.1.16, cuyo JAR requiere NeoForge 26.1.2.99 o superior. Se
  excluyeron ambos porque el objetivo del repositorio sigue en .95.
- More Culling 1.7.3 también declara el juego/loader objetivo, pero su JAR
  impone Sodium `<0.6.7`; el perfil fija Sodium 0.9.2. Se excluyeron More
  Culling y su dependencia Cloth Config para no crear ese conflicto.
- No hay build NeoForge 26.1.2 declarada para Chipped, Immersive Hotbar,
  Immersive Damage Indicators, Embeddium, Axiom, Litematica, MaLiLib ni
  Litematica RawMaterials. No se renombró ni reutilizó ningún JAR Fabric.
- Beyond & More 4.1.0 NeoForge 26.1.2 es una alternativa posible a Chipped,
  pero no se instaló ni se presentó como el mismo mod.
- Highly Customizable Damage Numbers tiene build NeoForge para 26.1.2, es
  cliente y no declara dependencias requeridas. Es una alternativa distinta a
  Immersive Damage Indicators; quedó fuera para no sustituirlo sin decisión.
- WorldEdit 7.4.3 declara NeoForge 26.1.2, pero su página oficial indica
  entornos server-side/singleplayer. No se añadió al perfil de cliente.
- Las builds y hashes están verificadas; Minecraft no se abrió. No se afirma
  funcionamiento en juego. Los archivos que requieren ambos lados también
  quedan pendientes de instalación en el servidor, fuera de este encargo.

## Reconstrucción

`npm run build:pack` crea el Modrinth `.mrpack` desde el manifiesto fijado.
`npm run verify:mod-sources` vuelve a consultar los filtros exactos sin build,
comprueba los registros oficiales, baja las builds seleccionadas y los
candidatos anotados, valida tamaño/SHA-1/SHA-512 y examina la metadata
NeoForge, dependencias y rangos del JAR.
