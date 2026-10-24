# GDC7 Profile Auto-update Implementation Plan

> **Implementation status (2026-10-22):** Local client, publisher, workflow, and UI implementation is complete. The repo `juanizuq123-cmyk/GDC7-Launcher` is still absent, so no remote release, Pages deployment, or Actions secret setup has happened. A different Minecraft/NeoForge target is reported as pending; this version does not create a second Prism instance for it.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically publish, verify, download, apply, report, and roll back signed GDC7 profile releases independently of launcher releases.

**Architecture:** A publisher builds a complete profile release with per-file SHA-256 entries and signs its manifest with an offline Ed25519 key. The launcher fetches the stable manifest from GitHub Pages, downloads immutable artifacts from GitHub Releases into staging, and transactionally applies only files owned by the marked GDC7 Prism instance. A stored release receipt drives diffs, safe removals, and rollback.

**Tech Stack:** Node.js CommonJS, Electron main process networking, Node `crypto` Ed25519/SHA-256, existing `file-safety.cjs`, `install-fs.cjs`, `safe-zip.cjs`, Prism instance markers, GitHub Pages and Releases.

**Spec:** `docs/superpowers/specs/2026-10-22-gdc7-profile-update-channel-design.md`

## Global Constraints

- Event is `gdc7`; never update Estación Boreal or another Prism instance.
- Initial target is Minecraft `26.1.2`, NeoForge `26.1.2.95`, Java `25`.
- The client and publisher currently accept only the exact confirmed target. A signed release proposing another Minecraft/NeoForge target is reported as pending and never applied by this build.
- Do not modify gameplay mod, server, EULA, worlds, accounts, or unowned personal files.
- All remote content uses HTTPS, signed manifest verification, strict relative paths, byte limits, and SHA-256 checks before install.
- Download and verify all changed artifacts in staging before mutation; back up prior owned files and roll back a partial transaction.
- GitHub Pages stores the stable pointer; GitHub Releases stores immutable versioned artifacts; the launcher contains no GitHub credentials or private signing keys.
- Do not add or execute test suites unless the user explicitly asks; verification in this task means the updater's runtime checks and the release/package build outputs.

## Review Focus

- A manifest for the wrong event/channel, invalid signature, stale version, or malformed target must be rejected before download.
- Traversal, device-name, case-collision, symlink, oversized, or duplicate archive paths must be rejected before write.
- A bad SHA-256, truncated download, or network interruption must leave the installed profile intact.
- Failure halfway through replace/delete/marker commit must restore every previous owned file and keep unrelated files.
- An offline/missing-profile startup must keep the prior local profile usable and report the channel state accurately.

---

### Task 1: Signed profile manifest format and verifier

**Files:**
- Create: `profile-update.cjs`
- Create: `update-signature.cjs`
- Create: `update-keys.cjs`
- Modify: `file-safety.cjs`
- Modify: `package.json`

**Interfaces:**
- Produces `verifyProfileManifest(bytes, publicKey) -> { manifest, manifestSha256 }`.
- Produces `compareProfileManifests(previous, next) -> { added, changed, removed }`.
- Manifest fields are `schema`, `eventId`, `channel`, `releaseId`, `publishedAt`, `minLauncherVersion`, `target`, `notes`, `files`, and `signature`.
- Each file entry is `{ path, size, sha256, url, category }`; allowed categories are `mod`, `config`, `resource`, `visual`, `other`.

- [x] Implement shared canonical JSON serialization and Ed25519 verification using the bundled GDC7 profile public key; the profile and launcher keys must be distinct.
- [x] Reject non-HTTPS URLs, wrong `eventId`/channel, invalid semver, invalid signature, duplicate or unsafe paths, malformed SHA-256, excessive file counts, and excessive total bytes.
- [x] Require the confirmed `CLIENT_PACK` target in a signed release. Target changes are pending in this build.
- [x] Derive the diff by path and SHA-256; never trust a server-supplied diff.

### Task 2: Profile release publisher

**Files:**
- Create: `scripts/prepare-gdc7-profile-release.cjs`
- Create: `provider/profile-releases/README.md`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Command: `npm run prepare:profile-release -- --input <directory> --version <semver> --private-key <path> --output <directory>`.
- Input contains a JSON release description and a `files/` tree; output contains an immutable asset archive, signed manifest, and SHA-256 report.

- [x] Validate the release description as GDC7, stable channel, Windows client profile, and exact target.
- [x] For each input file, compute size/SHA-256 and verify the path is allowed; include per-mod official source/version/loader/dependency evidence in the audit report.
- [x] Reject target changes in this build; target-specific official metadata validation and safe instance migration remain future work.
- [x] Sign with Ed25519 using an external key file; never copy private keys to the repository or output archive.
- [x] Produce a clear added/changed/removed summary relative to the previous published manifest when supplied.

### Task 3: Transactional download, apply, backup, and rollback

**Files:**
- Create: `gdc7-profile-updater.cjs`
- Modify: `install-fs.cjs`
- Modify: `safe-zip.cjs`
- Modify: `prism-account.cjs`

**Interfaces:**
- `Gdc7ProfileUpdater({ channelUrl, publicKey, userData, prismBridge, request, onChange })`.
- `checkAndApply({ signal }) -> { status, currentVersion, latestVersion, changes, target }`.
- Receipt stored under the app-owned Prism root at `.gdc7/profile-receipt.json` and includes the signed manifest bytes/hash plus the owned file list.

- [x] Load the trusted previous receipt; derive the initial baseline only from the bundled verified pack and its matching GDC7 marker.
- [x] Fetch the channel with bounded redirects/body size, verify signature/schema/version/target, and create an added/changed/removed diff locally.
- [x] Download the complete next file set into staging and verify declared size and SHA-256/SHA-512 before touching the instance.
- [x] Apply only within the GDC7 `.minecraft` root, with strict path checks and a transaction journal; back up each replaced/removed file and validate the backup.
- [x] Recover interrupted transactions and preserve unknown/unowned files. Keep previous file backups after success.
- [ ] On a changed target, create and verify a separate versioned Prism instance with no copied worlds or personal data. Until implemented, report the signed target change as pending.

### Task 4: Startup orchestration and user-visible profile status

**Files:**
- Modify: `main.cjs`
- Modify: `preload.cjs`
- Modify: `app/renderer.js`
- Modify: `app/index.html`
- Modify: `app/styles.css`
- Modify: `diagnostics.cjs`

**Interfaces:**
- Main process publishes `profileUpdate: { status, currentVersion, latestVersion, progress, changes, notes, error }`.
- Renderer receives state/progress only through validated IPC; no renderer-supplied URLs or file paths.

- [x] Check GDC7 updates at startup before enabling play; never start Prism/Minecraft automatically.
- [x] Use the newest validated cached GDC7 release for first import when no matching instance exists.
- [x] Show current/latest profile version, progress, release notes, and added/changed/removed file counts in Inicio and the detailed list in Ajustes.
- [x] Keep the prior version launchable if profile channel fetch, hash verification, or installation fails.
- [x] Keep the exact GDC7 Prism marker logic from matching another event.

### Task 5: Publish channel artifacts to GitHub

**Files:**
- Create: `.github/workflows/publish-gdc7-profile.yml`
- Modify: `provider/profile-releases/README.md`
- Modify: `docs/LEEME-PORTABLE.txt`
- Modify: `README.md`

**Interfaces:**
- GitHub Pages path: `channels/gdc7/stable.json`.
- Immutable profile release tags: `gdc7-profile-<profileVersion>`.
- Publisher uses GitHub Actions secrets only for release credentials; profile signing key is separate from app-update signing key.

- [ ] Run the workflow after the authorized public repo is created; repo creation and first publication remain pending.
- [x] Workflow rejects duplicate versions, wrong tags, failed verification, and advances the stable pointer only after signed manifests and artifact hashes are present.
- [x] Document key generation/storage, first publication from the alpha.3 baseline, release notes, rollback, and GitHub Pages setup.
- [x] Do not publish a profile release as part of ordinary local packaging.

### Task 6: Profile update handoff documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/IMPLEMENTATION-PLAN.md`
- Modify: `docs/LEEME-PORTABLE.txt`

- [x] Replace manual refresh instructions with the stable channel behavior and the failed/offline update message.
- [x] Explain that target changes are pending in this build, describe retained file backups, and document recovery limits.
- [x] State that this does not update the server, gameplay mod, worlds, EULA, or accounts.

