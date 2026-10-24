# GDC7 Launcher

<!-- impeccable:product-schema 1 -->

## Platform

Windows x64 desktop app using Electron. This platform choice follows the requested portable Windows deliverable.

## Stack

Electron 44.5.1 with Node CommonJS and native HTML, CSS, and JavaScript, plus an isolated official Prism Launcher installation for importing and starting the client profile.

## Users

Players who need to choose and prepare a Minecraft event instance.

## Product Purpose

Provide one launcher for GDC7 and other Minecraft events while keeping each event's profile, game version, loader, Java runtime, mods, instance folder, and installation state isolated.

## Capabilities and Constraints

- Event selection and writable profiles remain separate per event.
- The active GDC7 mod project targets Minecraft 26.1.2, NeoForge 26.1.2.95, and Java 25.
- The GDC7 client pack fixes the active repository target: Minecraft 26.1.2, NeoForge 26.1.2.95, and Java 25. It contains only individually verified compatible client/both-side mods, not the GDC7 gameplay mod or a configured server.
- Estación Boreal has no confirmed repository or manifest. Its versions, mods, server, player count, connection status, and news are unknown.
- Prism handles Minecraft account access and game launch. The launcher does not inspect Prism's account files or tokens. Managed Java selection and download are enabled in the isolated Prism profile.
- The launch profile is imported into a Prism root owned by this app, separate from the user's regular Prism data.
- This first portable is installed manually from a versioned ZIP. The old self-updater is not part of the new app.

## Evidence on Hand

- User-provided launcher reference image: `/launcher.png` in the request context. It is a hierarchy and mood reference only; its NyxStudio brand and assets are not part of this product.
- Local GDC7 project documents identify the active mod version as 26.1.2 / NeoForge 26.1.2.95 / Java 25.
- Alpha.2's erroneous Fabric 1.21.11 pack and its two source manifests were archived, with verified copies, outside the active provider pack directory. The isolated Prism root had no imported GDC7 instance and no JARs to remove or back up.
- Alpha.3 builds its Modrinth `.mrpack` from `pack/source/gdc7-client-26.1.2-neoforge-v0.3.0.json`. The selected JARs were downloaded from Modrinth and checked against published size, SHA-1, SHA-512, loader metadata, and NeoForge version ranges. The pack does not assert that Minecraft itself has been tested.
- The source manifest records excluded candidates and exact reasons, including dependency ranges above the pinned NeoForge version and a More Culling/Sodium conflict.

## Product Principles

- Keep event data and writable files separate by event.
- Show unknowns as unavailable instead of filling them with plausible values.
- Keep credentials in protected storage and keep tokens out of renderer state, logs, manifests, and Git.
- Launch only the exact installed profile marker from the app-managed Prism root; do not join a server or create a world automatically.
