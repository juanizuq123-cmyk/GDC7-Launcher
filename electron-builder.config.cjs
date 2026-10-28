'use strict';

const { BRAND } = (() => ({ BRAND: require('./brand.cjs') }))();
const version = require('./package.json').version;

module.exports = {
  appId: BRAND.appId,
  productName: BRAND.name,
  executableName: BRAND.executable.replace(/\.exe$/i, ''),
  directories: { output: `dist/installer-v${version}` },
  files: [
    'package.json', '*.cjs', 'auth-config.json', 'boreal-channel-config.json', 'app/**/*',
    'provider/prism/**/*', 'provider/packs/**/*',
    'pack/source/gdc7-client-26.1.2-neoforge-v0.3.0.json',
    'pack/source/boreal-constructor-26.1.2-neoforge-v0.2.4.json',
    '!electron-builder.config.cjs', '!tests/**', '!scripts/**', '!docs/**', '!work/**', '!dist/**', '!build-tools/**', '!node_modules/electron-builder/**'
  ],
  extraResources: [{ from: 'work/installer-resources/launcher-install-mode.json', to: 'launcher-install-mode.json' }],
  asar: true,
  electronUpdaterCompatibility: '>= 2.16',
  publish: [{ provider: 'generic', url: 'https://juanizuq123-cmyk.github.io/GDC7-Launcher/updates/launcher/stable', channel: 'latest' }],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: 'GDC7-Launcher-${version}-${arch}-setup.${ext}',
    verifyUpdateCodeSignature: false,
    signExecutable: false
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
    runAfterFinish: true
  }
};
