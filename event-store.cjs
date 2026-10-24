'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const EVENTS = Object.freeze([
  Object.freeze({
    id: 'gdc7',
    title: 'Guerra de Clanes 7',
    shortName: 'GDC7',
    status: 'pending-pack',
    target: Object.freeze({ minecraft: '26.1.2', loader: 'NeoForge 26.1.2.95', javaMajor: 25 }),
    manifest: null,
    playerCount: null,
    serverStatus: null,
    news: null
  }),
  Object.freeze({
    id: 'estacion-boreal',
    title: 'Estación Boreal',
    shortName: 'BOREAL',
    status: 'early-access',
    target: Object.freeze({ minecraft: '26.1.2', loader: 'NeoForge 26.1.2.95', javaMajor: 25 }),
    manifest: null,
    playerCount: null,
    serverStatus: null,
    news: null
  }),
  Object.freeze({
    id: 'boreal-constructor',
    title: 'Boreal Constructor',
    shortName: 'CONSTRUCTOR',
    status: 'construction-profile',
    target: Object.freeze({ minecraft: '26.1.2', loader: 'NeoForge 26.1.2.95', javaMajor: 25 }),
    manifest: null,
    playerCount: null,
    serverStatus: null,
    news: null
  })
]);

const eventById = id => EVENTS.find(event => event.id === id);
const clone = value => structuredClone(value);

function pathsOverlap(a, b) {
  const left = path.resolve(a).toLocaleLowerCase();
  const right = path.resolve(b).toLocaleLowerCase();
  const relative = path.relative(left, right);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function defaultWorkspace(instanceRoot) {
  return {
    schema: 2,
    selectedEventId: 'gdc7',
    preferences: { reducedMotion: false },
    profiles: Object.fromEntries(EVENTS.map(event => [event.id, {
      eventId: event.id,
      instanceDir: path.join(instanceRoot, event.id),
      ramMb: 4096,
      javaPath: null,
      mods: [],
      installation: { status: event.id === 'gdc7' ? 'pending-manifest' : 'unavailable' }
    }]))
  };
}

function validateWorkspace(value, base) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![1, 2].includes(value.schema)) throw new Error('La configuración local no tiene un formato válido.');
  if (!eventById(value.selectedEventId)) throw new Error('El evento seleccionado no es válido.');
  if (!value.preferences || typeof value.preferences.reducedMotion !== 'boolean') throw new Error('Las preferencias locales no son válidas.');
  if (!value.profiles || typeof value.profiles !== 'object' || Array.isArray(value.profiles)) throw new Error('No se encontraron los perfiles locales.');
  const expectedIds = (value.schema === 1 ? ['gdc7', 'estacion-boreal'] : EVENTS.map(event => event.id)).sort();
  if (Object.keys(value.profiles).sort().join('\0') !== expectedIds.join('\0')) throw new Error('La lista de perfiles locales no coincide con los eventos disponibles.');
  const next = clone(base);
  next.selectedEventId = value.selectedEventId;
  next.preferences.reducedMotion = value.preferences.reducedMotion;
  for (const event of EVENTS) {
    const profile = value.profiles[event.id];
    if (!profile && value.schema === 1 && event.id === 'boreal-constructor') continue;
    if (!profile || profile.eventId !== event.id || typeof profile.instanceDir !== 'string' || !path.isAbsolute(profile.instanceDir)) throw new Error('Un perfil tiene una carpeta de instancia no válida.');
    if (!Number.isInteger(profile.ramMb) || profile.ramMb < 2048 || profile.ramMb > 16384 || profile.ramMb % 512) throw new Error('La memoria del perfil debe estar entre 2 y 16 GB en pasos de 512 MB.');
    const expectedStatus = event.id === 'gdc7' ? 'pending-manifest' : 'unavailable';
    if (!profile.installation || profile.installation.status !== expectedStatus) throw new Error('El estado de instalación local no es válido.');
    next.profiles[event.id] = { ...next.profiles[event.id], instanceDir: path.normalize(profile.instanceDir), ramMb: profile.ramMb };
  }
  const instanceDirs = EVENTS.map(event => [event.id, next.profiles[event.id].instanceDir]);
  for (let i = 0; i < instanceDirs.length; i += 1) {
    for (let j = i + 1; j < instanceDirs.length; j += 1) {
      if (pathsOverlap(instanceDirs[i][1], instanceDirs[j][1])) throw new Error('Cada evento necesita una carpeta separada, sin compartirla ni anidarla con otra instancia.');
    }
  }
  return next;
}

function canLaunchEvent(event, profile) {
  return Boolean(
    event && profile && profile.eventId === event.id &&
    event.target &&
    event.manifest && event.manifest.eventId === event.id &&
    event.manifest.target?.minecraft === event.target.minecraft &&
    event.manifest.target?.loader === event.target.loader &&
    event.manifest.target?.javaMajor === event.target.javaMajor &&
    event.manifest.verified === true && /^[a-f0-9]{64}$/i.test(event.manifest.sha256 || '') &&
    profile.installation?.status === 'verified' &&
    profile.installation?.manifestSha256 === event.manifest.sha256
  );
}

class LauncherStore {
  constructor(file, instanceRoot) {
    this.file = file;
    this.base = defaultWorkspace(path.resolve(instanceRoot));
    this.value = clone(this.base);
    this.queue = Promise.resolve();
  }

  async load() {
    try {
      const input = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.value = validateWorkspace(input, this.base);
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('No se pudo leer la configuración local. Revisá el archivo de perfiles antes de continuar.');
    }
    return this.snapshot();
  }

  snapshot() { return clone(this.value); }

  commit(update) {
    const job = this.queue.then(async () => {
      const next = validateWorkspace(update(this.snapshot()), this.base);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, this.file);
        this.value = next;
        return this.snapshot();
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
      }
    });
    this.queue = job.catch(() => {});
    return job;
  }

  selectEvent(eventId) {
    if (!eventById(eventId)) return Promise.reject(new Error('Ese evento no está disponible.'));
    return this.commit(next => { next.selectedEventId = eventId; return next; });
  }

  setProfileValue(eventId, key, value) {
    if (!eventById(eventId) || key !== 'ramMb') return Promise.reject(new Error('Ese ajuste de perfil no está disponible.'));
    return this.commit(next => { next.profiles[eventId][key] = value; return next; });
  }

  setInstanceDir(eventId, directory) {
    if (!eventById(eventId) || typeof directory !== 'string' || !path.isAbsolute(directory) || path.dirname(path.resolve(directory)) === path.resolve(directory)) {
      return Promise.reject(new Error('Elegí una carpeta de instancia con una ruta absoluta válida.'));
    }
    return this.commit(next => {
      const target = path.resolve(directory);
      for (const event of EVENTS) {
        if (event.id !== eventId && pathsOverlap(target, next.profiles[event.id].instanceDir)) {
          throw new Error('La carpeta se superpone con otra instancia. Elegí una carpeta separada para este evento.');
        }
      }
      next.profiles[eventId].instanceDir = target;
      return next;
    });
  }

  setReducedMotion(value) {
    if (typeof value !== 'boolean') return Promise.reject(new Error('La preferencia de movimiento no es válida.'));
    return this.commit(next => { next.preferences.reducedMotion = value; return next; });
  }
}

module.exports = { EVENTS, LauncherStore, canLaunchEvent, defaultWorkspace, pathsOverlap, validateWorkspace };
