'use strict';

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  let state = null;
  let page = 'home';
  let toastTimer = null;
  let offlineNickname = localStorage.getItem('gdc7-offline-nickname') || '';

  function renderOfflineSelection() {
    const label = $('#offline-name-label');
    label.textContent = offlineNickname ? `· ${offlineNickname}` : '';
    label.hidden = !offlineNickname;
    $('#offline-clear').hidden = !offlineNickname;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4300);
  }

  async function act(action) {
    try { return await action(); }
    catch (error) { showToast(error?.message || 'No se pudo completar la acción. Volvé a intentarlo.'); return null; }
  }

  function activeEvent() { return state?.events.find(event => event.id === state.selectedEventId) || state?.events[0]; }
  function statusText(event) {
    if (event.id === 'boreal-constructor') {
      if (event.constructorProfile?.installed) return `Boreal Constructor ${event.constructorProfile.version} instalado`;
      if (state?.constructorProfileUpdate?.status === 'ready-to-install') return 'Boreal Constructor listo para instalar';
      return 'Boreal Constructor no disponible';
    }
    if (event.id === 'estacion-boreal') {
      const update = state?.borealProfileUpdate;
      if (event.borealProfile?.installed && update?.status === 'ready-to-install' && update.latestVersion !== event.borealProfile.version) return `Boreal ${update.latestVersion} listo para actualizar`;
      if (event.borealProfile?.installed) return `Boreal ${event.borealProfile.version} instalado`;
      if (update?.status === 'ready-to-install') return `Boreal ${update.latestVersion} listo para instalar`;
      return 'Perfil Boreal no disponible';
    }
    if (event.status === 'early-access') return 'Acceso anticipado';
    if (event.clientProfile?.installed) return 'Perfil GDC7 instalado';
    if (event.clientProfile) return 'Perfil GDC7 listo para instalar';
    return event.profile.installation.status === 'verified' ? 'Instalación verificada' : 'Instalación pendiente';
  }
  function eventImage(event) { return event.id === 'estacion-boreal' || event.id === 'boreal-constructor' ? 'assets/boreal-hero.png' : 'assets/gdc7-hero.png'; }
  function profileName(account) { return account?.authorized && account.profile ? account.profile.name : 'Cuenta Premium'; }

  function launcherUpdateText(update) {
    const latest = update?.latestVersion ? ` · Disponible: ${update.latestVersion}` : '';
    if (update?.status === 'manual-transition') return 'Este portable necesita instalar una vez el instalador nuevo para activar las actualizaciones automáticas.';
    if (update?.status === 'checking') return 'Comprobando la versión publicada…';
    if (update?.status === 'current') return `Actualizado · versión ${update.currentVersion || state.version}`;
    if (update?.status === 'downloading') return `Descargando la versión ${update.latestVersion || ''} · ${Math.round(update.percent || 0)}%`;
    if (update?.status === 'installing') return 'Instalando y reiniciando el launcher…';
    if (update?.status === 'unavailable' || update?.status === 'error') return `No se pudo consultar el canal. El launcher sigue disponible${update.error ? ` · ${update.error}` : ''}${latest}`;
    return `Versión ${update?.currentVersion || state.version}${latest}`;
  }

  function profileUpdateText(update) {
    const latest = update?.latestVersion ? ` · publicada ${update.latestVersion}` : '';
    const installed = Boolean(state?.events.find(event => event.id === 'gdc7')?.clientProfile?.installed);
    const messages = {
      idle: 'Preparando el canal del perfil…', checking: 'Comprobando la release firmada de GDC7…',
      downloading: `Descargando y verificando archivos del perfil… ${Math.round(update.progress || 0)}%`,
      recovering: 'Recuperando la copia anterior del perfil…', applying: 'Aplicando archivos verificados…',
      updated: `Perfil actualizado a ${update.currentVersion || latest}.`, current: `Perfil actualizado · ${update.currentVersion || ''}`,
      'ready-to-install': `La versión ${update.latestVersion || ''} está verificada y lista para instalar en Prism.${update.error ? ` ${update.error}` : ''}`,
      deferred: 'Cerrá Prism para instalar la actualización. El perfil actual sigue disponible.',
      unavailable: `El canal no está disponible. ${installed ? 'El perfil instalado sigue intacto.' : 'Todavía no hay una instancia GDC7 instalada.'}${update.error ? ` · ${update.error}` : ''}${latest}`,
      'target-change-pending': `La release propone otro objetivo. Se conserva la instancia actual hasta verificar una instancia nueva${update.error ? ` · ${update.error}` : ''}`,
      'launcher-update-required': `La release requiere actualizar el launcher primero${update.error ? ` · ${update.error}` : ''}`,
      'waiting-launcher-update': 'El perfil se comprobará después de instalar la actualización del launcher.'
    };
    return messages[update?.status] || `Perfil GDC7${latest}`;
  }

  function profileChangeSummary(update) {
    const changes = update?.changes || {};
    const added = changes.added?.length || 0;
    const changed = changes.changed?.length || 0;
    const removed = changes.removed?.length || 0;
    const counts = [
      added ? `${added} agregado${added === 1 ? '' : 's'}` : '',
      changed ? `${changed} actualizado${changed === 1 ? '' : 's'}` : '',
      removed ? `${removed} retirado${removed === 1 ? '' : 's'}` : ''
    ].filter(Boolean).join(' · ');
    const version = update?.latestVersion || update?.currentVersion;
    if (['checking', 'downloading', 'recovering', 'applying'].includes(update?.status)) return profileUpdateText(update);
    if (update?.status === 'unavailable' || update?.status === 'target-change-pending' || update?.status === 'launcher-update-required') return profileUpdateText(update);
    if (counts && version) return `GDC7 ${version} · ${counts}${update?.notes ? ` · ${update.notes}` : ''}`;
    if (update?.status === 'updated') return `GDC7 actualizado a ${update.currentVersion}. ${update.notes || 'Archivos verificados y aplicados.'}`;
    if (version) return `Perfil GDC7 ${version} · sin cambios pendientes.`;
    return profileUpdateText(update || {});
  }

  function navigate(nextPage) {
    if (!['home', 'events', 'wardrobe', 'settings'].includes(nextPage)) return;
    page = nextPage;
    $$('[data-view]').forEach(view => { view.hidden = view.dataset.view !== page; });
    $$('[data-page]').forEach(button => button.setAttribute('aria-current', String(button.dataset.page === page)));
    if (state) render();
    const heading = $('[data-view="' + page + '"] h1');
    heading?.focus?.({ preventScroll: true });
  }

  function renderHome(event) {
    const clientProfile = event.clientProfile;
    const isBoreal = event.id === 'estacion-boreal';
    const isConstructor = event.id === 'boreal-constructor';
    const borealProfile = event.borealProfile;
    const constructorProfile = event.constructorProfile;
    const selectedProfile = isBoreal ? borealProfile : isConstructor ? constructorProfile : clientProfile;
    const selectedUpdate = isBoreal ? state.borealProfileUpdate : isConstructor ? state.constructorProfileUpdate : state.profileUpdate;
    const profileInstalled = Boolean(selectedProfile?.installed);
    const profileReady = selectedUpdate?.status === 'ready-to-install';
    const borealUpdateAvailable = isBoreal && profileInstalled && profileReady && selectedUpdate.latestVersion !== selectedProfile?.version;
    $('#home-title').textContent = event.title;
    $('#hero-description').textContent = isConstructor
      ? 'Perfil de construcción independiente con WorldEdit 7.4.3-beta-01 · Minecraft 26.1.2 · NeoForge 26.1.2.95 · Java 25.'
      : isBoreal
      ? profileReady || profileInstalled
        ? 'Perfil independiente de Estación Boreal para Minecraft 26.1.2 · NeoForge 26.1.2.95 · Java 25.'
        : 'Perfil de Estación Boreal no disponible; comprobá el paquete local o el canal firmado.'
      : 'Perfil cliente para Minecraft 26.1.2 · NeoForge 26.1.2.95 · Java 25.';
    $('#hero-status').textContent = isConstructor
      ? profileInstalled ? 'PERFIL CONSTRUCTOR INSTALADO' : profileReady ? 'PERFIL CONSTRUCTOR DISPONIBLE' : 'PERFIL CONSTRUCTOR NO DISPONIBLE'
      : isBoreal
      ? profileInstalled ? borealUpdateAvailable ? 'ACTUALIZACIÓN BOREAL LISTA' : 'PERFIL BOREAL INSTALADO' : profileReady ? 'PERFIL BOREAL DISPONIBLE' : 'PERFIL BOREAL NO DISPONIBLE'
      : clientProfile?.installed ? 'PERFIL GDC7 INSTALADO' : 'PERFIL GDC7 DISPONIBLE';
    $('#hero-status').previousElementSibling.classList.toggle('ready', profileInstalled || profileReady);
    $('#art-event-label').textContent = 'ILUSTRACIÓN · ' + event.shortName;
    $('#hero-art-image').src = eventImage(event);
    $('.hero-art').setAttribute('aria-label', isBoreal || isConstructor ? 'Ilustración conceptual de Estación Boreal' : 'Ilustración conceptual de GDC7');

    const specs = [];
    if (selectedProfile) {
      specs.push(['Minecraft', selectedProfile.minecraft]);
      specs.push(['Loader', selectedProfile.loader]);
      specs.push(['Java', String(selectedProfile.javaMajor)]);
      specs.push(['Mods', String(selectedProfile.modCount)]);
    } else {
      specs.push(['Minecraft', 'No disponible']);
      specs.push(['Loader', 'No disponible']);
      specs.push(['Java', 'No disponible']);
      specs.push(['Jugadores', 'No disponible']);
      specs.push(['Conexión', 'Sin fuente']);
    }
    $('#hero-specs').innerHTML = specs.map(item => '<span class="spec-chip"><strong>' + escapeHtml(item[0]) + '</strong> ' + escapeHtml(item[1]) + '</span>').join('');

    const playButton = $('#play-button');
    const prismBusy = Boolean(state.prism.active);
    const profileBusy = ['checking', 'downloading', 'recovering', 'applying'].includes(selectedUpdate?.status);
    const borealUnavailable = (isBoreal || isConstructor) && !profileInstalled && !profileReady;
    playButton.disabled = prismBusy || profileBusy || borealUnavailable;
    playButton.querySelector('span').textContent = prismBusy ? 'Prism está abierto' : profileBusy ? 'Verificando perfil' : isConstructor
      ? profileInstalled ? 'Jugar Boreal Constructor' : profileReady ? 'Instalar Boreal Constructor' : 'Perfil no disponible'
      : isBoreal
        ? profileInstalled ? borealUpdateAvailable ? 'Actualizar Estación Boreal' : 'Jugar Estación Boreal' : profileReady ? 'Instalar Estación Boreal' : 'Perfil no disponible'
        : clientProfile?.installed ? 'Jugar perfil GDC7' : 'Instalar perfil GDC7';
    playButton.setAttribute('aria-label', isConstructor ? profileInstalled ? 'Jugar Boreal Constructor' : profileReady ? 'Instalar Boreal Constructor' : 'Boreal Constructor no disponible' : isBoreal ? profileInstalled ? borealUpdateAvailable ? 'Actualizar perfil de Estación Boreal' : 'Jugar perfil de Estación Boreal' : profileReady ? 'Instalar perfil de Estación Boreal' : 'Perfil de Estación Boreal no disponible' : clientProfile?.installed ? 'Jugar perfil GDC7' : 'Instalar perfil GDC7');
    $('#play-reason').textContent = isConstructor
      ? profileInstalled
        ? 'Prism inicia la instancia de construcción con WorldEdit. Es una instancia separada; el pack del evento Estación Boreal y GDC7 quedan sin WorldEdit.'
        : profileReady
          ? 'El paquete local Boreal Constructor fue verificado; Prism importará una instancia distinta para construir.'
          : selectedUpdate?.error || 'No se pudo verificar Boreal Constructor.'
      : isBoreal
      ? borealUpdateAvailable
        ? `La versión ${selectedUpdate.latestVersion} está verificada. Prism importará una instancia Boreal versionada y conservará la anterior.`
        : profileInstalled
          ? 'Prism inicia la instancia aislada de Estación Boreal con la cuenta autenticada que administra Prism. GDC7 permanece separado.'
            : profileReady
            ? 'El paquete local o la release firmada se verificó. Prism importará una instancia Boreal independiente.'
            : selectedUpdate?.error || 'No se pudo verificar el paquete de Estación Boreal.'
      : clientProfile?.installed
        ? 'Prism inicia Minecraft 26.1.2 con NeoForge 26.1.2.95 y Java 25. Iniciá sesión en Prism con tu cuenta Microsoft Premium si todavía no lo hiciste.'
        : profileBusy
          ? 'Esperá a que termine la comprobación y descarga del perfil firmado.'
          : prismBusy
          ? 'Cerrá Prism para volver al launcher y continuar.'
          : 'La primera vez se abre el importador de Prism; confirmá la instancia. El perfil fija Minecraft 26.1.2, NeoForge 26.1.2.95 y Java 25. El mod de gameplay GDC7 y el servidor no se incluyen.';
    $('#install-readout-title').textContent = isConstructor
      ? profileInstalled ? 'Boreal Constructor instalado' : profileReady ? 'Instalar Boreal Constructor' : 'Boreal Constructor no disponible'
      : isBoreal
      ? profileInstalled ? borealUpdateAvailable ? 'Actualizar perfil Boreal' : 'Perfil Boreal instalado' : profileReady ? 'Instalar perfil Boreal' : 'Perfil Boreal no disponible'
      : clientProfile?.installed ? 'Perfil GDC7 instalado' : 'Instalar perfil GDC7';
    $('#install-readout-note').textContent = isConstructor
      ? 'borealexpedition 0.1.0 + WorldEdit 7.4.3-beta-01 · Minecraft 26.1.2 · NeoForge 26.1.2.95 · Java 25'
      : isBoreal
      ? `borealexpedition ${borealProfile?.modVersion || '0.1.0'} · Minecraft ${borealProfile?.minecraft || '26.1.2'} · NeoForge ${borealProfile?.loaderVersion || '26.1.2.95'} · Java ${borealProfile?.javaMajor || 25}`
      : '8 mods · Minecraft 26.1.2 · NeoForge 26.1.2.95 · Java 25';
    const profileUpdate = state.profileUpdate || {};
    $('#news-heading').textContent = isConstructor ? 'Boreal Constructor' : isBoreal ? 'Estación Boreal' : 'Actualización GDC7';
    $('#news-copy').textContent = isConstructor
      ? 'Perfil de construcción separado · WorldEdit no está en el pack del evento.'
      : isBoreal
      ? selectedUpdate.notes || (selectedUpdate.status === 'current' ? `Perfil Boreal ${selectedUpdate.currentVersion} actualizado.` : selectedUpdate.error || 'Paquete de Estación Boreal verificado localmente.')
      : profileChangeSummary(profileUpdate);
    $('#news-details').textContent = isConstructor ? 'Ver perfil' : isBoreal ? 'Ver evento' : 'Ver cambios';

    $('#home-event-tiles').innerHTML = state.events.map(item => '<button type="button" class="event-tile" data-select-event="' + escapeHtml(item.id) + '" data-event-id="' + escapeHtml(item.id) + '" aria-pressed="' + String(item.id === event.id) + '">' +
      '<img class="tile-emblem tile-image" src="' + eventImage(item) + '" alt="">' +
      '<span class="tile-copy"><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(statusText(item)) + '</small></span></button>').join('');
    $('#footer-status').textContent = 'Perfil independiente · ' + event.shortName;
  }

  function renderEvents(event) {
    $('#event-list').innerHTML = state.events.map(item => '<button type="button" role="listitem" class="event-row" data-select-event="' + escapeHtml(item.id) + '" aria-pressed="' + String(item.id === event.id) + '">' +
      '<img class="tile-emblem tile-image" src="' + eventImage(item) + '" alt="">' +
      '<span><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(statusText(item)) + '</small></span></button>').join('');

    const isBoreal = event.id === 'estacion-boreal';
    const isConstructor = event.id === 'boreal-constructor';
    const target = event.target;
    const facts = [
      ['Minecraft', target?.minecraft || 'No disponible'],
      ['Loader', target?.loader || 'No disponible'],
      ['Java', target ? 'Java ' + target.javaMajor : 'No disponible'],
      ['Jugadores', 'No disponible'],
      ['Conexión', 'Sin fuente configurada'],
      ['Mods', isConstructor ? 'Estación Boreal + WorldEdit 7.4.3-beta-01' : isBoreal ? 'Estación Boreal 0.1.0' : event.manifest ? 'Declarados por manifiesto verificado' : 'No disponibles sin manifiesto']
    ];
    const intro = isConstructor
      ? 'Perfil de construcción separado para Boreal con WorldEdit 7.4.3-beta-01. Usa Minecraft 26.1.2, NeoForge 26.1.2.95 y Java 25; no altera el pack del evento.'
      : isBoreal
        ? 'Perfil cliente independiente de Estación Boreal para Minecraft 26.1.2, NeoForge 26.1.2.95 y Java 25.'
        : 'Este perfil cliente fija el objetivo real de GDC7: Minecraft 26.1.2, NeoForge 26.1.2.95 y Java 25.';
    const installationMessage = isConstructor
      ? state.constructorProfileUpdate?.status === 'ready-to-install'
        ? 'El pack de construcción local se verificó. WorldEdit solo se instala en Boreal Constructor.'
        : 'Instalá Boreal Constructor para usar WorldEdit en una instancia de construcción aparte.'
      : isBoreal
      ? state.borealProfileUpdate?.status === 'ready-to-install'
        ? 'El manifiesto estable fue validado con la clave pública exclusiva de Boreal. Prism lo importará como una instancia distinta.'
        : 'El manifiesto firmado y su release deben publicarse en el canal HTTPS independiente antes de distribuir el perfil.'
      : 'El pack incluye ocho mods para cliente. TrashSlot, Balm y Construction Sticks también necesitan sus archivos equivalentes en el servidor; el servidor no se modificó.';
    const profileDetails = isConstructor ? event.constructorProfile : isBoreal ? event.borealProfile : event.clientProfile;
    const clientFacts = profileDetails ? [
      [isConstructor ? 'Perfil de construcción' : isBoreal ? 'Perfil Boreal' : 'Perfil cliente GDC7', profileDetails.installed ? 'Instalado en Prism' : `${profileDetails.modCount} mod${profileDetails.modCount === 1 ? '' : 's'} en el perfil`],
      ...(isConstructor ? [['Mods', 'Estación Boreal + WorldEdit 7.4.3-beta-01']] : []),
      ['Versión jugable', `Minecraft ${profileDetails.minecraft} · ${profileDetails.loader} · Java ${profileDetails.javaMajor}`]
    ] : [];
    const activeProfile = profileDetails;
    const profilePath = activeProfile?.path || (activeProfile ? 'Prism creará la instancia al importarla.' : 'No hay instancia instalada.');
    const folderAction = activeProfile?.installed
      ? '<div class="detail-actions"><button type="button" class="button button-secondary" data-open-dir="' + escapeHtml(event.id) + '">Abrir carpeta de Prism</button></div>'
      : '';
    $('#event-detail').innerHTML = '<span class="detail-status"><span class="status-dot"></span>' + escapeHtml(statusText(event)) + '</span>' +
      '<h2>' + escapeHtml(event.title) + '</h2><p>' + escapeHtml(intro) + '</p>' +
      '<dl class="detail-facts">' + [...facts, ...clientFacts].map(item => '<div><dt>' + escapeHtml(item[0]) + '</dt><dd>' + escapeHtml(item[1]) + '</dd></div>').join('') + '</dl>' +
      '<div class="detail-folder"><strong>Ubicación del perfil cliente</strong><code>' + escapeHtml(profilePath) + '</code></div>' +
      '<p class="section-intro">' + escapeHtml(installationMessage) + '</p>' +
      folderAction;
  }

  function accountStatusText(account) {
    if (account.authorized && account.profile) return 'Cuenta oficial conectada como ' + account.profile.name + '.';
    if (account.active && account.status === 'waiting') return 'Esperando que completes el código en Microsoft.';
    if (account.error?.message) return account.error.message;
    if (account.status === 'unconfigured') return 'La vinculación opcional del perfil requiere un Client ID público y acceso de la aplicación.';
    if (account.status === 'storage-unavailable') return 'El almacenamiento protegido no está disponible. No se guardará una sesión en texto plano.';
    if (account.status === 'expired') return 'La sesión venció. Renovala o volvé a iniciar sesión.';
    if (account.status === 'signing-out') return 'Cerrando sesión local…';
    return 'No hay un perfil vinculado en el launcher. La cuenta para jugar se agrega desde Prism.';
  }

  function renderWardrobe() {
    const account = state.account;
    const authorized = account.authorized && account.profile;
    $('#wardrobe-account-state').textContent = authorized ? 'PERFIL VINCULADO' : account.status === 'waiting' ? 'AUTORIZACIÓN PENDIENTE' : 'SESIÓN DE JUEGO EN PRISM';
    $('#identity-name').textContent = authorized ? account.profile.name : 'Cuenta Premium en Prism';
    $('#identity-description').textContent = authorized
      ? 'Perfil oficial de Minecraft comprobado por el servicio de cuenta. Usá esa misma cuenta en Prism para jugar.'
      : 'La cuenta Microsoft que usa Jugar se administra dentro de Prism. El vínculo de perfil en esta pantalla es opcional.';
    $('#identity-profile').textContent = authorized ? account.profile.id : 'No disponible';
    $('#identity-storage').textContent = account.protectedStorage ? 'Almacenamiento protegido disponible' : 'No disponible';
    $('#identity-skin').textContent = 'Vista previa de skin no disponible';
    if (document.activeElement !== $('#auth-client-id')) $('#auth-client-id').value = state.authConfig.clientId;
    $('#auth-access-confirmed').checked = state.authConfig.confirmed;
    const ready = account.configured && account.protectedStorage && !account.active;
    $('#account-login').disabled = !ready;
    $('#save-auth-config').disabled = account.active;
    $('#account-cancel').hidden = !account.active;
    $('#account-refresh').hidden = !authorized;
    $('#account-logout').hidden = !account.hasSession && !account.active;
    $('#account-status').textContent = accountStatusText(account);
    const device = account.device;
    $('#device-access').hidden = !device || !account.active;
    if (device) {
      $('#device-code').textContent = device.userCode;
      $('#device-link').textContent = device.verificationUri;
    }
    $('#header-account-label').textContent = profileName(account);
    $('#header-account-mark').textContent = authorized ? account.profile.name.slice(0, 1).toUpperCase() : 'P';
    $('.account-indicator').classList.toggle('online', Boolean(authorized));
    $('#prism-state').textContent = prismStatusText(state.prism);
    $('#prism-open').disabled = state.prism.active;
    $('#prism-open').textContent = state.prism.active ? 'Prism está abierto' : 'Iniciar sesión Premium';
  }

  function prismStatusText(prism) {
    if (prism.status === 'preparing') return 'Comprobando y preparando la copia oficial de Prism…';
    if (prism.status === 'running' && prism.mode === 'import') return 'Prism está importando el pack. Confirmá la instancia y cerrá Prism al terminar.';
    if (prism.status === 'running' && prism.mode === 'launch') return 'Prism abrió el perfil de Minecraft con la cuenta que elegiste allí.';
    if (prism.status === 'running') return 'Iniciá sesión con tu cuenta Premium de Microsoft en Prism y cerralo al terminar.';
    if (prism.status === 'closed' && prism.mode === 'import') return 'Prism se cerró. El launcher volverá a buscar el perfil importado.';
    if (prism.status === 'closed' && prism.mode === 'launch') return 'Prism se cerró. El perfil GDC7 sigue guardado en su instancia aislada.';
    if (prism.status === 'closed') return 'Prism se cerró. El launcher no puede ver qué cuenta quedó guardada.';
    if (prism.status === 'error') return prism.error || 'Prism no pudo abrirse.';
    return 'Prism permanece cerrado.';
  }

  function renderSettings() {
    $('#launcher-version').textContent = 'VERSIÓN ' + state.version;
    $('#settings-version').textContent = state.version;
    $('#window-version').textContent = state.version;
    $('#footer-version').textContent = state.version;
    $('#reduced-motion').checked = state.workspace.preferences.reducedMotion;
    const launcherUpdate = state.launcherUpdate || {};
    const selectedProfileId = activeEvent()?.id;
    const borealSelected = selectedProfileId === 'estacion-boreal';
    const constructorSelected = selectedProfileId === 'boreal-constructor';
    const profileUpdate = (borealSelected ? state.borealProfileUpdate : constructorSelected ? state.constructorProfileUpdate : state.profileUpdate) || {};
    $('#launcher-update-status').textContent = launcherUpdateText(launcherUpdate);
    $('#launcher-update-notes').textContent = launcherUpdate.releaseNotes || '';
    $('#profile-update-version').textContent = profileUpdate.currentVersion ? `Instalada ${profileUpdate.currentVersion}` : 'Versión del perfil pendiente';
    $('#profile-update-heading').textContent = constructorSelected ? 'Perfil Boreal Constructor' : borealSelected ? 'Perfil Estación Boreal' : 'Perfil GDC7';
    $('#profile-update-status').textContent = constructorSelected
      ? profileUpdate.status === 'ready-to-install' ? 'Pack Boreal Constructor verificado y listo para importar en Prism.'
        : profileUpdate.status === 'current' ? 'Boreal Constructor instalado y actualizado.'
          : profileUpdate.status === 'checking' ? 'Verificando el pack de construcción…'
            : profileUpdate.error || 'No se pudo verificar Boreal Constructor.'
      : borealSelected
      ? profileUpdate.status === 'ready-to-install' ? profileUpdate.currentVersion ? `Boreal ${profileUpdate.latestVersion || ''} verificado; disponible para actualizar en Prism.` : `Boreal ${profileUpdate.latestVersion || ''} verificado y listo para importar en Prism.`
        : profileUpdate.status === 'current' ? `Perfil Boreal ${profileUpdate.currentVersion || ''} · actualizado.`
          : profileUpdate.status === 'checking' ? 'Verificando el paquete Boreal y su canal firmado…'
            : profileUpdate.error || 'No se pudo verificar el perfil Boreal.'
      : profileUpdateText(profileUpdate);
    $('#profile-update-notes').textContent = profileUpdate.notes || '';
    const changes = profileUpdate.changes || {};
    const rows = [
      ...(changes.added || []).map(item => ['Agregado', item.path]),
      ...(changes.changed || []).map(item => ['Actualizado', item.path]),
      ...(changes.removed || []).map(item => ['Retirado', item.path])
    ];
    $('#profile-update-changes').innerHTML = rows.slice(0, 24).map(([label, name]) => `<li>${escapeHtml(label)} · ${escapeHtml(name)}</li>`).join('');
    $('#check-updates').disabled = ['checking', 'downloading', 'recovering', 'applying', 'installing'].includes(launcherUpdate.status) || ['checking', 'downloading', 'recovering', 'applying'].includes(profileUpdate.status);
    document.documentElement.dataset.reducedMotion = String(state.workspace.preferences.reducedMotion);
    $('#instance-settings').innerHTML = state.events.map(event => {
      const target = event.target ? 'Minecraft ' + event.target.minecraft + ' · ' + event.target.loader + ' · Java ' + event.target.javaMajor : 'Versiones no disponibles';
      const profileInfo = event.id === 'estacion-boreal' ? event.borealProfile : event.id === 'boreal-constructor' ? event.constructorProfile : event.clientProfile;
      const location = profileInfo?.path || (profileInfo ? 'Prism creará la instancia al importar el perfil.' : 'Sin perfil de juego disponible.');
      const details = profileInfo
        ? event.id === 'boreal-constructor'
          ? `Perfil de construcción: WorldEdit 7.4.3-beta-01 y Estación Boreal · Minecraft ${profileInfo.minecraft} · ${profileInfo.loader} · Java ${profileInfo.javaMajor}. Instancia separada del pack del evento.`
          : event.id === 'estacion-boreal'
          ? `Perfil visual Boreal: ${profileInfo.modCount} mod · Minecraft ${profileInfo.minecraft} · ${profileInfo.loader} · Java ${profileInfo.javaMajor}. Instancia independiente.`
          : `Perfil GDC7: ${profileInfo.modCount} mods · Minecraft ${profileInfo.minecraft} · ${profileInfo.loader} · Java ${profileInfo.javaMajor}. El mod de gameplay no está incluido.`
        : 'Sin perfil de juego disponible.';
      const actions = profileInfo?.installed
        ? '<div class="instance-actions"><button type="button" class="text-button" data-open-dir="' + escapeHtml(event.id) + '">Abrir ubicación de Prism</button></div>'
        : '';
      return '<article class="instance-row">' +
        '<div class="instance-row-top"><strong>' + escapeHtml(event.title) + '</strong><span>' + escapeHtml(statusText(event)) + '</span></div>' +
        '<small class="helper">' + escapeHtml(target) + '</small>' +
        '<small class="helper">' + escapeHtml(details) + '</small>' +
        '<code class="instance-path">' + escapeHtml(location) + '</code>' +
        actions +
      '</article>';
    }).join('');
  }

  function render() {
    const event = activeEvent();
    if (!event) return;
    $$('[data-view]').forEach(view => { view.hidden = view.dataset.view !== page; });
    $$('[data-page]').forEach(button => button.setAttribute('aria-current', String(button.dataset.page === page)));
    $('#window-title').textContent = state.brand;
    document.title = state.brand;
    renderHome(event);
    renderEvents(event);
    renderWardrobe();
    renderSettings();
  }

  async function selectEvent(id) {
    const next = await act(() => window.launcher.selectEvent(id));
    if (next) state = next;
  }

  document.addEventListener('click', event => {
    if (event.target.closest('#offline-open')) {
      $('#offline-nickname').value = offlineNickname;
      renderOfflineSelection();
      $('#offline-dialog').hidden = false;
      $('#offline-nickname').focus();
      return;
    }
    if (event.target.closest('#offline-close') || event.target.id === 'offline-dialog') {
      $('#offline-dialog').hidden = true;
      $('#offline-open').focus();
      return;
    }
    const pageLink = event.target.closest('[data-page-link]');
    if (pageLink) { event.preventDefault(); navigate(pageLink.dataset.pageLink); return; }
    const nav = event.target.closest('[data-page]');
    if (nav) { navigate(nav.dataset.page); return; }
    const eventTile = event.target.closest('[data-select-event]');
    if (eventTile) { void selectEvent(eventTile.dataset.selectEvent); return; }
    const openDir = event.target.closest('[data-open-dir]');
    if (openDir) { void act(() => window.launcher.openInstanceDir(openDir.dataset.openDir)); return; }
    const chooseDir = event.target.closest('[data-choose-dir]');
    if (chooseDir) { void act(() => window.launcher.setInstanceDir(chooseDir.dataset.chooseDir)); return; }
    const windowControl = event.target.closest('[data-window]');
    if (windowControl) { void act(() => window.launcher.window(windowControl.dataset.window)); return; }
    if (event.target.closest('#play-button')) {
      const selected = activeEvent();
      if (!selected) return;
      if (selected.id === 'estacion-boreal') {
        const update = state.borealProfileUpdate;
        const needsInstall = !selected.borealProfile?.installed || update?.status === 'ready-to-install' && update.latestVersion !== selected.borealProfile?.version;
        void act(() => needsInstall ? window.launcher.installBorealProfile() : window.launcher.playBorealProfile());
        return;
      }
      if (selected.id === 'boreal-constructor') {
        void act(() => selected.constructorProfile?.installed ? window.launcher.playBorealConstructorProfile() : window.launcher.installBorealConstructorProfile());
        return;
      }
      if (selected.id !== 'gdc7') return;
      void act(() => selected.clientProfile?.installed ? window.launcher.playClientProfile(offlineNickname || null) : window.launcher.installClientProfile());
      return;
    }
    if (event.target.closest('#news-button, #news-details')) {
      const selected = activeEvent();
      if (selected?.id === 'gdc7') navigate('settings');
      else if (selected?.id === 'estacion-boreal') navigate('settings');
      else if (selected?.id === 'boreal-constructor') navigate('settings');
      else showToast('Este evento todavía no tiene un canal de actualizaciones.');
      return;
    }
    if (event.target.closest('#account-login')) { void act(() => window.launcher.accountLogin()); return; }
    if (event.target.closest('#account-refresh')) { void act(() => window.launcher.accountRefresh()); return; }
    if (event.target.closest('#account-cancel')) { void act(() => window.launcher.accountCancel()); return; }
    if (event.target.closest('#account-logout')) { void act(() => window.launcher.accountLogout()); return; }
    if (event.target.closest('#account-open-browser')) { void act(() => window.launcher.accountOpenBrowser()); return; }
    if (event.target.closest('#prism-open')) { void act(() => window.launcher.openPrismAccounts()); return; }
    if (event.target.closest('#refresh-state')) { void act(async () => { state = await window.launcher.bootstrap(); render(); }); return; }
    if (event.target.closest('#check-updates')) { void act(async () => { await window.launcher.checkUpdates(); state = await window.launcher.bootstrap(); render(); }); return; }
    if (event.target.closest('#copy-diagnostics')) {
      void act(async () => {
        await window.launcher.copyDiagnostics();
        $('#diagnostic-status').textContent = 'Diagnóstico copiado. No incluye tokens ni datos personales.';
      });
      return;
    }
  });

  $('#offline-form').addEventListener('submit', event => {
    event.preventDefault();
    const nickname = $('#offline-nickname').value.trim();
    const button = $('#offline-submit');
    button.disabled = true;
    button.textContent = 'Guardando…';
    try {
      offlineNickname = nickname;
      localStorage.setItem('gdc7-offline-nickname', nickname);
      renderOfflineSelection();
      $('#offline-dialog').hidden = true;
      $('#offline-open').focus();
      showToast(`Nombre guardado: ${nickname}. Elegí un perfil y tocá Jugar.`);
    } catch {
      showToast('No se pudo guardar el nombre en este equipo.');
    } finally {
      button.disabled = false;
      button.textContent = 'Guardar nombre';
    }
  });

  $('#offline-clear').addEventListener('click', () => {
    offlineNickname = '';
    localStorage.removeItem('gdc7-offline-nickname');
    renderOfflineSelection();
    $('#offline-dialog').hidden = true;
    $('#offline-open').focus();
    showToast('El próximo perfil usará la cuenta Premium de Prism.');
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('#offline-dialog').hidden) {
      $('#offline-dialog').hidden = true;
      $('#offline-open').focus();
    }
  });

  $('#auth-config-form').addEventListener('submit', event => {
    event.preventDefault();
    void act(async () => {
      const result = await window.launcher.saveAuthConfig({
        clientId: $('#auth-client-id').value,
        minecraftApiAccessConfirmed: $('#auth-access-confirmed').checked
      });
      if (result) showToast('Configuración de cuenta guardada en este equipo.');
    });
  });

  $('#reduced-motion').addEventListener('change', event => {
    void act(async () => {
      state = await window.launcher.setReducedMotion(event.target.checked);
      render();
    });
  });

  $('#instance-settings').addEventListener('change', event => {
    const range = event.target.closest('[data-ram-event]');
    if (!range) return;
    void act(async () => {
      state = await window.launcher.setProfileValue(range.dataset.ramEvent, 'ramMb', Number(range.value));
      render();
    });
  });

  window.launcher.onState(next => { state = next; render(); });
  window.launcher.onAccount(next => { if (state) { state.account = next; renderWardrobe(); } });
  window.launcher.onPrism(next => { if (state) { state.prism = next; renderWardrobe(); } });
  window.launcher.onNotice(notice => { if (notice?.message) showToast(notice.message); });

  renderOfflineSelection();
  window.launcher.bootstrap().then(next => { state = next; render(); }).catch(error => showToast(error.message));
})();
