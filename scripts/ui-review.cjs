'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const packageInfo = require('../package.json');

const root = path.resolve(__dirname, '..');
const portable = process.env.GDC7_PORTABLE_ROOT
  ? path.resolve(process.env.GDC7_PORTABLE_ROOT)
  : path.join(root, 'dist', `GDC7-Launcher-${packageInfo.version}-Windows-x64`);
const executable = path.join(portable, 'GDC7-Launcher.exe');
const userData = path.join(root, 'work', 'ui-review-user-data');
const captureDir = path.join(root, '.impeccable', 'review');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function assert(value, message) {
  if (!value) throw new Error(message);
}

class CdpConnection {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.opened = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  async send(method, params = {}) {
    await this.opened;
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { this.socket.close(); }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Debug endpoint respondió ${response.status}.`);
  return response.json();
}

async function waitFor(predicate, message, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch {}
    await pause(100);
  }
  throw new Error(message);
}

async function evaluate(page, expression) {
  const result = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Falló una acción de interfaz.');
  return result.result?.value;
}

async function waitForExpression(page, expression, message) {
  await waitFor(async () => Boolean(await evaluate(page, expression)), message);
}

async function capture(page, name) {
  await pause(300);
  const image = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await fs.writeFile(path.join(captureDir, name), Buffer.from(image.data, 'base64'));
}

async function clickPage(page, id) {
  await evaluate(page, `document.querySelector('[data-page="${id}"]').click(); true`);
  await waitForExpression(page, `!document.querySelector('[data-view="${id}"]').hidden`, `No abrió la pantalla ${id}.`);
}

async function run() {
  await fs.access(executable);
  await fs.mkdir(path.dirname(userData), { recursive: true });
  await fs.mkdir(captureDir, { recursive: true });
  const port = await freePort();
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*',
    `--user-data-dir=${userData}`
  ], { cwd: portable, stdio: 'ignore', shell: false, windowsHide: false });
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const spawnError = new Promise((resolve, reject) => child.once('error', reject));
  spawnError.catch(() => {});

  let page;
  try {
    let version;
    await Promise.race([
      waitFor(async () => {
        if (child.exitCode !== null) throw new Error('El launcher terminó durante el inicio.');
        try { version = await getJson(`http://127.0.0.1:${port}/json/version`); return Boolean(version.webSocketDebuggerUrl); }
        catch { return false; }
      }, 'El launcher portable no abrió su interfaz.'),
      spawnError
    ]);
    const target = await waitFor(async () => {
      const items = await getJson(`http://127.0.0.1:${port}/json`);
      return items.find(item => item.type === 'page' && item.url.endsWith('/app/index.html')) || null;
    }, 'No se encontró la página local del launcher.');
    page = new CdpConnection(target.webSocketDebuggerUrl);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await waitForExpression(page, `document.querySelector('#home-title')?.textContent === 'Guerra de Clanes 7'`, 'Inicio no cargó el evento GDC7.');
    const playState = await evaluate(page, `({disabled: document.querySelector('#play-button').disabled, text: document.querySelector('#play-button').textContent, reason: document.querySelector('#play-reason').textContent})`);
    assert(!playState.disabled && playState.text.toLocaleLowerCase().includes('instalar perfil gdc7') && playState.reason.includes('26.1.2'), `GDC7 no presenta el perfil real disponible ni explica sus límites: ${JSON.stringify(playState)}`);
    assert(await evaluate(page, `document.querySelector('#hero-art-image').getAttribute('src') === 'assets/gdc7-hero.png' && document.querySelectorAll('#home-event-tiles .tile-image').length === 2`), 'Inicio no carga las ilustraciones locales de sus eventos.');
    await evaluate(page, `document.documentElement.dataset.reducedMotion = 'true'; document.querySelector('.orbit-scene').style.animation = 'none'; true`);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 850, deviceScaleFactor: 1, mobile: false });
    await capture(page, 'desktop.png');

    await clickPage(page, 'events');
    assert(await evaluate(page, `document.querySelectorAll('#event-list .event-row').length === 2`), 'La pantalla Eventos no lista ambas instancias.');
    await capture(page, 'events.png');

    await clickPage(page, 'wardrobe');
    assert(await evaluate(page, `document.querySelector('#account-login').disabled`), 'El acceso Microsoft quedó habilitado sin configuración.');
    await capture(page, 'wardrobe.png');

    await clickPage(page, 'settings');
    const settings = await evaluate(page, `({count: document.querySelectorAll('#instance-settings .instance-row').length, paths: [...document.querySelectorAll('#instance-settings .instance-path')].map(item => item.textContent)})`);
    assert(settings.count === 2 && settings.paths.length === 2 && settings.paths[0].includes('Prism') && settings.paths[1].includes('Sin perfil'), 'Ajustes no distingue la ubicación gestionada por Prism del perfil sin pack.');
    await evaluate(page, `document.querySelector('#copy-diagnostics').click(); true`);
    await waitForExpression(page, `document.querySelector('#diagnostic-status').textContent.includes('copiado')`, 'El botón de diagnóstico no respondió.');
    await capture(page, 'settings.png');

    await clickPage(page, 'home');
    await evaluate(page, `document.querySelector('[data-select-event="estacion-boreal"]').click(); true`);
    await waitForExpression(page, `document.querySelector('#home-title')?.textContent === 'Estación Boreal'`, 'La selección de Boreal no actualizó Inicio.');
    assert(await evaluate(page, `document.querySelector('#play-button').disabled && document.querySelector('#hero-specs').textContent.includes('No disponible') && document.querySelector('#hero-art-image').getAttribute('src') === 'assets/boreal-hero.png'`), 'Boreal mostró datos ficticios o habilitó Jugar.');
    await capture(page, 'boreal.png');

    await evaluate(page, `document.querySelector('[data-select-event="gdc7"]').click(); true`);
    await waitForExpression(page, `document.querySelector('#home-title')?.textContent === 'Guerra de Clanes 7'`, 'No volvió al perfil GDC7.');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 760, height: 620, deviceScaleFactor: 1, mobile: false });
    assert(await evaluate(page, `document.documentElement.scrollWidth <= window.innerWidth`), 'El ancho mínimo genera scroll horizontal.');
    assert(await evaluate(page, `getComputedStyle(document.querySelector('.hero')).gridTemplateColumns.split(' ').length === 1 && getComputedStyle(document.querySelector('.hero-art')).display !== 'none' && getComputedStyle(document.querySelector('.news-note')).display !== 'none' && document.querySelector('#news-copy').textContent.includes('No hay una fuente')`), 'El ancho mínimo oculta la ilustración o el estado de novedades.');
    await capture(page, 'minimum.png');
    process.stdout.write(`Pantallas y revisión aislada guardadas en ${captureDir}\n`);
  } finally {
    if (child.exitCode === null) {
      if (page) await evaluate(page, `document.querySelector('[data-window="close"]').click(); true`).catch(() => {});
      page?.close();
      await Promise.race([exit, pause(6000)]);
      if (child.exitCode === null) child.kill();
      await Promise.race([exit, pause(2000)]);
    }
    page?.close();
    const workRoot = path.resolve(root, 'work') + path.sep;
    if (path.resolve(userData).startsWith(workRoot)) await fs.rm(userData, { recursive: true, force: true });
  }
}

run().catch(error => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
