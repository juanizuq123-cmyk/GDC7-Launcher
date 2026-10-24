'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const yauzl = require('yauzl');
const { CLIENT_PACK } = require('../client-pack.cjs');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'pack', 'source', CLIENT_PACK.sourceManifest);
const userAgent = 'gdc7-launcher/0.1.0-alpha.3 (local-pack-audit)';
const KNOWN_MOD_IDS = new Map([
  ['ZX66K16c', 'pickupnotifier'], ['QAGBst4M', 'puzzleslib'],
  ['51shyZVL', 'moreculling'], ['9s6osm5g', 'cloth_config']
]);

function assert(condition, message) { if (!condition) throw new Error(message); }

async function getJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Modrinth ${response.status} al consultar ${url}`);
  return response.json();
}

function compareVersions(left, right) {
  const parse = value => {
    const match = /^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
    assert(match, `Versión no reconocida: ${value}`);
    return { numbers: match[1].split('.').map(Number), prerelease: match[2] || null };
  };
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.numbers.length, b.numbers.length);
  for (let i = 0; i < length; i += 1) {
    const delta = (a.numbers[i] || 0) - (b.numbers[i] || 0);
    if (delta) return Math.sign(delta);
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, 'en', { numeric: true });
}

function versionInRange(version, range) {
  const match = /^([[(])([^,]*),([^\])]*)([)\]])$/.exec(range.replaceAll(' ', ''));
  assert(match, `Rango NeoForge no reconocido: ${range}`);
  const [, leftBracket, lower, upper, rightBracket] = match;
  if (lower) {
    const cmp = compareVersions(version, lower);
    if (cmp < 0 || (cmp === 0 && leftBracket === '(')) return false;
  }
  if (upper) {
    const cmp = compareVersions(version, upper);
    if (cmp > 0 || (cmp === 0 && rightBracket === ')')) return false;
  }
  return true;
}

function sha(buffer, algorithm) { return crypto.createHash(algorithm).update(buffer).digest('hex'); }

function readJarEntries(buffer, wanted) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error) return reject(error);
      const found = new Map();
      let settled = false;
      const fail = errorValue => {
        if (settled) return;
        settled = true;
        zip.close();
        reject(errorValue);
      };
      zip.on('error', fail);
      zip.on('end', () => {
        if (settled) return;
        settled = true;
        resolve(found);
      });
      zip.on('entry', entry => {
        if (!wanted.has(entry.fileName)) return zip.readEntry();
        if (entry.uncompressedSize > 4 * 1024 * 1024) return fail(new Error(`Metadata ZIP demasiado grande: ${entry.fileName}`));
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return fail(streamError);
          const chunks = [];
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('error', fail);
          stream.on('end', () => {
            found.set(entry.fileName, Buffer.concat(chunks).toString('utf8'));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

function dependencyBlock(toml, dependencyId) {
  const lines = toml.split(/\r?\n/);
  const blocks = [];
  let current = [];
  for (const line of lines) {
    if (/^\s*\[\[?dependencies\.[^\]]+\]\]?(?:\s*#.*)?\s*$/.test(line)) {
      if (current.length) blocks.push(current.join('\n'));
      current = [line];
    } else if (current.length) current.push(line);
  }
  if (current.length) blocks.push(current.join('\n'));
  const escaped = dependencyId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return blocks.find(block => new RegExp(`modId\\s*=\\s*["']${escaped}["']`).test(block)) || null;
}

function rangeFromBlock(block, label) {
  if (!block) return null;
  const match = /versionRange\s*=\s*["']([^"']+)["']/.exec(block);
  assert(match, `${label}: falta versionRange en META-INF/neoforge.mods.toml.`);
  return match[1].replaceAll(' ', '');
}

function expectedArtifacts(manifest) {
  const result = manifest.mods.map(mod => ({
    name: mod.name,
    projectId: mod.projectId,
    versionId: mod.versionId,
    versionNumber: mod.version,
    versionType: mod.versionType,
    gameVersions: mod.gameVersions,
    loaders: mod.loaders,
    file: mod.file,
    modId: mod.modId,
    requiredDependencies: (mod.dependencies || []).filter(dependency => dependency.type === 'required').map(dependency => dependency.projectId),
    expectedDependencies: mod.dependencies || [],
    environment: mod.projectSide,
    neoforgeRange: mod.neoforgeRange,
    neoforgeMinimum: mod.neoforgeMinimum,
    neoforgeMaximumExclusive: mod.neoforgeMaximumExclusive,
    included: true
  }));

  for (const excluded of manifest.excludedMods) {
    const checked = excluded.checkedVersion;
    if (checked?.file) result.push({
      name: excluded.name,
      projectId: excluded.projectId,
      versionId: checked.versionId,
      versionNumber: checked.version,
      versionType: checked.versionType,
      gameVersions: checked.gameVersions,
      loaders: checked.loaders,
      file: checked.file,
      modId: KNOWN_MOD_IDS.get(excluded.projectId),
      requiredDependencies: excluded.name === 'Pick Up Notifier' ? ['QAGBst4M'] : excluded.name === 'More Culling' ? ['9s6osm5g'] : [],
      included: false,
      excluded
    });
    const dependency = excluded.requiredDependency;
    if (dependency?.file) result.push({
      name: dependency.name,
      projectId: dependency.projectId,
      versionId: dependency.versionId,
      versionNumber: dependency.version,
      versionType: dependency.versionType,
      gameVersions: dependency.gameVersions,
      loaders: dependency.loaders,
      file: dependency.file,
      modId: KNOWN_MOD_IDS.get(dependency.projectId),
      requiredDependencies: [],
      included: false,
      excluded
    });
    const alternative = excluded.possibleAlternative;
    if (alternative?.file) result.push({
      name: alternative.name,
      projectId: alternative.projectId,
      versionId: alternative.versionId,
      versionNumber: alternative.version,
      versionType: alternative.versionType,
      gameVersions: alternative.gameVersions,
      loaders: alternative.loaders,
      file: alternative.file,
      requiredDependencies: alternative.dependencies?.filter(item => item.type === 'required').map(item => item.projectId) || [],
      environment: alternative.projectSide,
      included: alternative.installed === true,
      excluded
    });
  }
  return result;
}

async function verifyExactBuildQueries(manifest, target) {
  for (const expected of manifest.exactBuildChecks || []) {
    const query = new URLSearchParams({
      game_versions: JSON.stringify([target.minecraft]),
      loaders: JSON.stringify([target.loader])
    });
    const versions = await getJson(`https://api.modrinth.com/v2/project/${expected.projectId}/version?${query}`);
    assert(Array.isArray(versions), `${expected.name}: la consulta exacta no devolvió una lista de versiones.`);
    assert(versions.length === expected.expectedVersionCount, `${expected.name}: el número de versiones exactas cambió (${versions.length}).`);
    const project = await getJson(`https://api.modrinth.com/v2/project/${expected.projectId}`);
    assert(project.title === expected.name, `${expected.name}: el ID Modrinth ahora apunta a ${project.title}.`);
    assert(project.client_side === expected.projectSide.client && project.server_side === expected.projectSide.server, `${expected.name}: cambiaron sus lados declarados en Modrinth.`);
  }
}

async function verifyArtifact(artifact, target) {
  assert(artifact.projectId && artifact.versionId, `${artifact.name}: falta ID Modrinth.`);
  assert(artifact.file?.url && artifact.file?.filename, `${artifact.name}: falta archivo Modrinth.`);
  assert(artifact.gameVersions?.includes(target.minecraft) && artifact.loaders?.includes(target.loader), `${artifact.name}: API no declara Minecraft/loader exactos.`);
  const api = await getJson(`https://api.modrinth.com/v2/version/${artifact.versionId}`);
  assert(api.id === artifact.versionId && api.project_id === artifact.projectId, `${artifact.name}: la versión oficial apunta a otro proyecto.`);
  assert(api.version_number === artifact.versionNumber && api.version_type === artifact.versionType, `${artifact.name}: cambió el número/canal de versión.`);
  assert(api.game_versions.includes(target.minecraft) && api.loaders.includes(target.loader), `${artifact.name}: la versión live no confirma el objetivo exacto.`);
  const officialFile = api.files.find(file => file.filename === artifact.file.filename && file.primary);
  assert(officialFile, `${artifact.name}: el nombre de archivo ya no aparece como primario en Modrinth.`);
  assert(officialFile.url === artifact.file.url, `${artifact.name}: URL diferente a la fijada.`);
  assert(officialFile.size === artifact.file.size, `${artifact.name}: tamaño distinto al publicado.`);
  assert(officialFile.hashes.sha1 === artifact.file.hashes.sha1 && officialFile.hashes.sha512 === artifact.file.hashes.sha512, `${artifact.name}: hashes diferentes a los publicados.`);

  const requiredApi = api.dependencies.filter(dependency => dependency.dependency_type === 'required').map(dependency => dependency.project_id).sort();
  assert(JSON.stringify(requiredApi) === JSON.stringify([...artifact.requiredDependencies].sort()), `${artifact.name}: dependencias requeridas distintas a Modrinth (${requiredApi.join(', ')}).`);

  if (artifact.environment) {
    const project = await getJson(`https://api.modrinth.com/v2/project/${artifact.projectId}`);
    assert(project.client_side === artifact.environment.client && project.server_side === artifact.environment.server, `${artifact.name}: cambiaron sus lados de instalación en Modrinth.`);
    assert(project.client_side !== 'unsupported', `${artifact.name}: es incompatible con el cliente.`);
  }

  const url = new URL(officialFile.url);
  assert(url.protocol === 'https:' && url.hostname === 'cdn.modrinth.com', `${artifact.name}: origen no oficial.`);
  const response = await fetch(url, { headers: { 'User-Agent': userAgent } });
  if (!response.ok) throw new Error(`${artifact.name}: CDN Modrinth respondió ${response.status}.`);
  const buffer = Buffer.from(await response.arrayBuffer());
  assert(buffer.byteLength === artifact.file.size, `${artifact.name}: tamaño descargado no coincide.`);
  assert(sha(buffer, 'sha1') === artifact.file.hashes.sha1, `${artifact.name}: SHA-1 descargado no coincide.`);
  assert(sha(buffer, 'sha512') === artifact.file.hashes.sha512, `${artifact.name}: SHA-512 descargado no coincide.`);

  const entries = await readJarEntries(buffer, new Set(['META-INF/neoforge.mods.toml']));
  const toml = entries.get('META-INF/neoforge.mods.toml');
  assert(toml, `${artifact.name}: el JAR no contiene metadata NeoForge.`);
  if (artifact.modId) assert(new RegExp(`modId\\s*=\\s*["']${artifact.modId}["']`).test(toml), `${artifact.name}: modId interno no coincide.`);
  const neoforgeDependency = dependencyBlock(toml, 'neoforge');
  const neoforgeRange = rangeFromBlock(neoforgeDependency, artifact.name);
  assert(neoforgeRange, `${artifact.name}: el JAR no declara NeoForge como dependencia.`);
  if (artifact.neoforgeRange) assert(neoforgeRange === artifact.neoforgeRange.replaceAll(' ', ''), `${artifact.name}: cambió el rango NeoForge interno (${neoforgeRange}).`);
  return { name: artifact.name, file: artifact.file.filename, bytes: buffer.byteLength, sha256: sha(buffer, 'sha256'), neoforgeRange, included: artifact.included, toml };
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const { target } = manifest;
  assert(manifest.eventId === CLIENT_PACK.eventId && target.minecraft === CLIENT_PACK.minecraft, 'El manifiesto no coincide con el target GDC7 del launcher.');
  await verifyExactBuildQueries(manifest, target);
  const artifacts = expectedArtifacts(manifest);
  const verified = [];
  for (const artifact of artifacts) verified.push({ artifact, result: await verifyArtifact(artifact, target) });

  for (const { artifact, result } of verified.filter(item => item.artifact.included)) {
    assert(versionInRange(target.loaderVersion, result.neoforgeRange), `${artifact.name}: NeoForge ${target.loaderVersion} no está dentro de ${result.neoforgeRange}.`);
    if (artifact.neoforgeMinimum) assert(compareVersions(target.loaderVersion, artifact.neoforgeMinimum) >= 0, `${artifact.name}: queda por debajo del mínimo NeoForge.`);
    if (artifact.neoforgeMaximumExclusive) assert(compareVersions(target.loaderVersion, artifact.neoforgeMaximumExclusive) < 0, `${artifact.name}: supera el máximo NeoForge.`);
  }

  const puzzles = verified.find(item => item.artifact.projectId === 'QAGBst4M');
  assert(puzzles && !versionInRange(target.loaderVersion, rangeFromBlock(dependencyBlock(puzzles.result.toml, 'neoforge'), 'Puzzles Lib')), 'La incompatibilidad de Puzzles Lib con NeoForge .95 dejó de estar demostrada.');
  const expectedPuzzlesRange = puzzles.artifact.excluded.requiredDependency.neoforgeRange;
  assert(rangeFromBlock(dependencyBlock(puzzles.result.toml, 'neoforge'), 'Puzzles Lib') === expectedPuzzlesRange, 'Cambió el rango NeoForge de Puzzles Lib registrado en el manifiesto.');
  const moreCulling = verified.find(item => item.artifact.projectId === '51shyZVL');
  const sodium = manifest.mods.find(mod => mod.projectId === 'AANobbMI');
  const sodiumDependencyRange = rangeFromBlock(dependencyBlock(moreCulling.result.toml, 'sodium'), 'More Culling / Sodium');
  assert(sodiumDependencyRange && !versionInRange('0.9.2', sodiumDependencyRange), 'La incompatibilidad More Culling/Sodium ya no está demostrada; revisar la selección.');

  const includedCount = verified.filter(item => item.artifact.included).length;
  process.stdout.write(JSON.stringify({
    status: 'verified', target: { minecraft: target.minecraft, loader: `${target.loader} ${target.loaderVersion}`, javaMajor: target.javaMajor },
    installedMods: includedCount,
    officialFilesDownloadedAndHashChecked: verified.length,
    exactNoBuildQueries: (manifest.exactBuildChecks || []).length,
    compatibleAlternativesCheckedButNotInstalled: verified.filter(item => item.artifact.name === 'Beyond & More' || item.artifact.name === 'Highly Customizable Damage Numbers').map(item => item.artifact.name),
    excludedDependencyBlockers: { puzzlesLib: rangeFromBlock(dependencyBlock(puzzles.result.toml, 'neoforge'), 'Puzzles Lib'), moreCullingSodium: sodiumDependencyRange },
    sodiumVersion: sodium.version,
    minecraftTested: false
  }, null, 2) + '\n');
}

main().catch(error => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
