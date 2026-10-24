# GDC7 Launcher Auto-update Implementation Plan

> **Implementation status (2026-10-22):** Local installer, updater, feed-signing workflow, and documentation are complete. The authorized GitHub repo is not yet present, so no release, Pages deployment, or Actions secret setup has happened. The alpha.3 portable still needs a one-time manual installer run.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual portable ZIP distribution with a per-user NSIS installer that checks, verifies, installs, and relaunches launcher releases independently of GDC7 profile releases.

**Architecture:** The installed app uses a signed Ed25519 `latest.json` channel pointer on GitHub Pages plus `electron-updater` metadata and immutable GitHub Release installer assets. The launcher verifies the signed version, URL, size, and SHA-512 against `latest.yml` before download and rechecks the signed SHA-512 before install. The alpha.3 portable requires a one-time manual transition to the first installer; subsequent app updates are automatic.

**Tech Stack:** Electron 44.5.1, Node CommonJS, `electron-builder` NSIS, `electron-updater`, GitHub Actions, GitHub Pages, GitHub Releases.

**Spec:** `docs/superpowers/specs/2026-10-22-gdc7-profile-update-channel-design.md`

## Global Constraints

- Windows x64, per-user install with no administrator requirement.
- Keep existing `BRAND.appId` and `BRAND.dataName` so Prism and account data remain discoverable.
- First migration from alpha.3 portable is a manual one-time installer run; leave old portable files untouched.
- App releases and profile releases have separate versions, feeds, tags, signing keys, and user-visible status.
- The app updater uses only `updates/launcher/stable/latest.json` and its matching `latest.yml`; it must not enumerate GitHub releases or consume profile releases.
- GitHub repository proposal is `juanizuq123-cmyk/GDC7-Launcher`, public; no runtime GitHub token or private key is shipped.
- Do not publish a release or replace prior release assets until explicitly requested; build local artifacts only.
- Do not add or execute test suites unless the user explicitly asks; use package/build outputs for implementation verification.

## Review Focus

- Missing or malformed update feed must let the current app open and show a recoverable status.
- Invalid `latest.json` signature, mismatch with `latest.yml`, or installer SHA-512 mismatch must never execute an installer.
- Profile release tags must not affect app version detection.
- First NSIS install must preserve `%APPDATA%` Prism/auth/settings data and leave the extracted portable intact.
- A downloaded installer must not be installed while the app is still using files; auto-install/relaunch behavior must be deterministic.

---

### Task 1: NSIS packaging and per-user install configuration

**Files:**
- Modify: `package.json`
- Create: `electron-builder.config.cjs`
- Create: `scripts/package-installer.cjs`
- Modify: `scripts/package-portable.cjs`
- Modify: `.gitignore`

**Interfaces:**
- New script: `npm run package:installer` produces the x64 NSIS installer, blockmap, and update metadata under `dist/`.
- Installer-only resource marker `launcher-install-mode.json` enables auto-update only for the new NSIS build; the existing portable packaging path omits it.
- Keep the product version sourced from `package.json`.

- [x] Pin stable `electron-builder`/`electron-updater` versions compatible with Electron `44.5.1`; preserve CommonJS support.
- [x] Add and pin a direct YAML parser dependency to validate `latest.yml`.
- [x] Configure NSIS per-user install, Windows x64, stable appId, no mandatory elevation, exact generic feed, stable channel, and no prerelease/downgrade selection.
- [x] Add the install-mode marker only for the NSIS build; keep it out of portable output.
- [x] Package production files and Prism assets; exclude work archives, signing keys, diagnostics, and user data.
- [x] Document the one-time alpha.3-to-NSIS migration.

### Task 2: Launcher updater lifecycle in the main process

**Files:**
- Create: `launcher-updater.cjs`
- Create: `launcher-channel.cjs`
- Create: `update-signature.cjs`
- Create: `update-keys.cjs`
- Modify: `main.cjs`
- Modify: `preload.cjs`
- Modify: `diagnostics.cjs`

**Interfaces:**
- `LauncherChannel({ channelUrl, publicKey, request })` verifies Ed25519 over canonical UTF-8 JSON with `signature` omitted; `latest.json` fields are `{ schema, channel, version, assetUrl, size, sha512, latestYmlUrl, notes, signature }`. It parses `latest.yml` and compares version, absolute artifact URL, size, and SHA-512.
- `LauncherUpdater({ updater, channel, onChange, installAndRestart })`.
- State: `{ status, currentVersion, latestVersion, percent, releaseNotes, error }`.
- Only the main process owns `autoUpdater`; renderer commands cannot supply feed URLs or installer paths.

- [x] Configure automatic check/download only when the installer-mode marker exists.
- [x] Require signed pointer and `latest.yml` agreement on version, URL, size, and SHA-512 before download.
- [x] Use the v26 `NsisUpdater.verifyUpdateCodeSignature` hook, disable differential download, and verify the completed installer against the signed channel hash.
- [x] Install and relaunch after full verification; prevent duplicate installs.
- [x] On offline/error/invalid metadata, keep the current app running and expose a localized status.
- [x] Run app and profile checks independently and honor the profile minimum launcher version.

### Task 3: GitHub Pages launcher feed and release workflow

**Files:**
- Create: `.github/workflows/release-launcher.yml`
- Create: `scripts/sign-launcher-channel.cjs`
- Create: `updates/launcher/stable/README.md`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Static channel pointer: `updates/launcher/stable/latest.json` on GitHub Pages, signed with a launcher-only Ed25519 key.
- `updates/launcher/stable/latest.yml` contains the matching electron-updater metadata and is checked against the signed pointer.
- Immutable app tag prefix: `launcher-v<packageVersion>`.
- The `latest.json` channel pointer is Ed25519-signed with a launcher-only key, separate from the GDC7 profile Ed25519 key. Electron-builder v26 `latest.yml` is cross-checked against that signed pointer and its SHA-512.

- [x] Build installer and metadata only on an explicit version tag/manual workflow dispatch; not on ordinary packaging.
- [x] Create canonical signed `latest.json` with exact version, asset URL, size, SHA-512, notes, and metadata URL.
- [x] Keep launcher and profile signing keys separate.
- [ ] Run the workflow after the public repo is created; it will upload the installer/blockmap and publish signed metadata to Pages.
- [x] Require explicit workflow permissions and a signing secret; keep tokens and private keys out of source and artifacts.
- [x] Reject a release when version, owner/repo, installer hash, signature, metadata, or tag does not match.
- [x] Keep profile release tags out of app version detection using the generic static feed.

### Task 4: Update status and settings UI

**Files:**
- Modify: `app/renderer.js`
- Modify: `app/index.html`
- Modify: `app/styles.css`
- Modify: `main.cjs`
- Modify: `preload.cjs`

**Interfaces:**
- Distinct state blocks: `launcherUpdate` and `profileUpdate`; no shared version comparison.

- [x] Show app current/latest version, download/install progress, and restart state separately from profile version and file diff.
- [x] Explain the one-time alpha.3-to-NSIS transition.
- [x] Keep launcher available during ordinary checks; never open Minecraft or Prism as part of updater restart.

### Task 5: Local build handoff and migration notes

**Files:**
- Modify: `README.md`
- Modify: `docs/LEEME-PORTABLE.txt`
- Modify: `docs/IMPLEMENTATION-PLAN.md`

- [x] Document the intended repo feeds and independent version/tag schemes.
- [x] Document manual first installation from alpha.3 and preserved Prism/auth/settings data.
- [x] Produce a local NSIS installer with SHA-256 sidecar; do not publish from local packaging.
- [x] Verify installer metadata points to `juanizuq123-cmyk/GDC7-Launcher` and both feed URLs remain distinct.

