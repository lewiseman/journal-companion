const { app, BrowserWindow, ipcMain, dialog, protocol, session, Menu, safeStorage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { Runtime, publicError } = require('./runtime.cjs');
const { Vault } = require('./vault.cjs');
const { Library } = require('./library.cjs');
const { Jobs } = require('./jobs.cjs');
const { DeviceService } = require('./device-service.cjs');
const { CompanionError, getModel } = require('./model.cjs');

// Developer credentials stay in the main process; .env files are never packaged.
if (!app.isPackaged) {
  try { process.loadEnvFile(path.join(app.getAppPath(), '.env')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Could not read the local .env file. Check its format and permissions.'); }
}

app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme: 'journal', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const verification = process.argv.find((arg) => arg.startsWith('--verify-d01='))?.slice('--verify-d01='.length);
const connectionDemo = process.argv.find((arg) => arg.startsWith('--connection-demo='))?.slice('--connection-demo='.length);
if (verification || connectionDemo) {
  const directory = verification || connectionDemo;
  if (!path.isAbsolute(directory)) throw new Error('Verification directory must be absolute');
  app.setPath('userData', path.join(directory, 'app-data'));
}
if (connectionDemo) process.on('SIGTERM', () => app.quit());
let window;
let runtime;
let library, vault, jobs, devices, serviceError;
const snapshot = () => ({ ...runtime.snapshot(), library: library?.snapshot(), devices: devices?.snapshot(), activity: jobs?.list() || [], serviceError });
const publish = () => { if (window && !window.isDestroyed()) window.webContents.send('companion:state', snapshot()); };
let quitting = false;
const APP_URL = 'journal://companion/index.html';
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    const resources = new Map([
      ['/index.html', ['index.html', 'text/html']],
      ['/styles.css', ['styles.css', 'text/css']],
      ['/app.js', ['app.js', 'text/javascript']],
    ]);
    protocol.handle('journal', async (request) => {
      const url = new URL(request.url);
      const resource = resources.get(url.pathname);
      if (url.hostname !== 'companion' || !resource || request.method !== 'GET') return new Response('', { status: 404 });
      return new Response(await fs.readFile(path.join(__dirname, 'renderer', resource[0])), { headers: {
        'Content-Type': resource[1],
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
        'X-Content-Type-Options': 'nosniff',
      } });
    });
    session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url.startsWith('journal://companion/');
      callback({ cancel: !allowed });
    });
    window = new BrowserWindow({
      width: 1180, height: 820, minWidth: 830, minHeight: 650, backgroundColor: '#f6f5f1',
      title: 'Journal Companion', titleBarStyle: 'hiddenInset',
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, spellcheck: false, devTools: !app.isPackaged },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Journal Companion', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' }] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }] },
    ]));
    runtime = new Runtime(app.getPath('userData'));
    runtime.on('state', publish);
    runtime.on('token', (value) => { if (!window.isDestroyed()) window.webContents.send('companion:token', value); });
    library = new Library(runtime);
    library.on('change', publish);
    function handle(name, callback) {
      ipcMain.handle(`companion:${name}`, async (event, ...args) => {
        if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== APP_URL) throw new Error('Untrusted IPC sender');
        try { return await callback(...args); }
        catch (error) { return { ok: false, error: publicError(error) }; }
      });
    }
    const noArgs = (callback) => (...args) => {
      if (args.length) throw new Error('Unexpected arguments');
      return callback();
    };
    const withModel = (callback) => (...args) => {
      if (args.length > 1 || (args.length && typeof args[0] !== 'string')) throw new CompanionError('INVALID_INPUT', 'Choose a model from the supported list.');
      return callback(getModel(args.length ? args[0] : runtime.model.id));
    };
    const reconcile = async (action) => { const result = await action(); await library.reconcile(); publish(); return result; };
    handle('state', noArgs(snapshot));
    const download = (model, autoLoad) => {
      if (library.downloading) throw new CompanionError('BUSY', 'Wait for the current download to finish.');
      return model.capability !== 'text' ? library.downloadArtifact(model.id) : reconcile(() => runtime.download(autoLoad, model.id));
    };
    handle('download', withModel((model) => download(model, true)));
    handle('load', withModel((model) => reconcile(() => runtime.load(model.id))));
    handle('unload', noArgs(() => runtime.unload()));
    handle('install', withModel((model) => download(model, false)));
    handle('cancelDownload', noArgs(() => { runtime.downloadAbort?.abort(); library.downloadAbort?.abort(); return { ok: true }; }));
    handle('remove', noArgs(async () => { await library.remove(); publish(); return { ok: true }; }));
    handle('assign', (...args) => {
      if (args.length !== 1 || typeof args[0] !== 'string') throw new CompanionError('INVALID_INPUT', 'Choose an installed writing model.');
      return library.assign(args[0]).then(() => { publish(); return { ok: true }; });
    });
    handle('catalog', withModel(async (model) => { await shell.openExternal(model.detailsUrl || `https://huggingface.co/${model.repository}/tree/${model.revision}`); return { ok: true }; }));
    const service = () => { if (!devices) throw new CompanionError('SECURE_STORAGE', serviceError || 'Secure device storage is unavailable.'); return devices; };
    handle('pair', noArgs(async () => {
      const result = await service().openPairing();
      if (connectionDemo) {
        await fs.mkdir(connectionDemo, { recursive: true, mode: 0o700 });
        await fs.writeFile(path.join(connectionDemo, 'device-config.json'), JSON.stringify({ COMPANION_PAIRING_CODE: result.code }), { mode: 0o600 });
      }
      return result;
    }));
    handle('disableService', noArgs(() => service().disable()));
    handle('approve', (...args) => {
      if (args.length !== 2 || typeof args[0] !== 'string' || typeof args[1] !== 'boolean') throw new CompanionError('INVALID_INPUT', 'Invalid approval.');
      return service().approve(args[0], args[1]);
    });
    handle('revoke', (...args) => {
      if (args.length !== 1 || typeof args[0] !== 'string') throw new CompanionError('INVALID_INPUT', 'Invalid device.');
      return service().revoke(args[0]);
    });
    handle('cancelJob', (...args) => {
      if (args.length !== 2 || !args.every((a) => typeof a === 'string') || !jobs) throw new CompanionError('INVALID_INPUT', 'Invalid task.');
      return jobs.cancel(args[0], args[1]);
    });
    handle('generate', (...args) => {
      if (args.length !== 1) throw new Error('Invalid arguments');
      return runtime.generate(args[0]);
    });
    let choosing = false;
    handle('choose', withModel(async (model) => {
      if (runtime.busy || runtime.reserved || choosing) return { ok: false, error: { code: 'BUSY', message: 'Wait for the current operation to finish.' } };
      choosing = true;
      try {
        const result = await dialog.showOpenDialog(window, { title: `Select ${model.name} ${model.quantization}`, properties: ['openFile'], filters: [{ name: 'GGUF model', extensions: ['gguf'] }] });
        if (result.canceled) return { ok: true, canceled: true };
        return await reconcile(() => runtime.select(result.filePaths[0], model.id));
      } finally { choosing = false; }
    }));
    await window.loadURL(APP_URL);
    await runtime.initialize();
    await library.initialize();
    try {
      const protector = { isEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
        encryptString: (value) => safeStorage.encryptStringAsync(value),
        decryptString: async (value) => (await safeStorage.decryptStringAsync(value)).result };
      vault = new Vault(app.getPath('userData'), protector); await vault.initialize();
      jobs = new Jobs(vault, runtime, library); await jobs.initialize(); jobs.on('change', publish);
      const demoPortArg = connectionDemo && process.argv.find((arg) => arg.startsWith('--demo-port='));
      const demoPort = demoPortArg ? Number(demoPortArg.slice('--demo-port='.length)) : 47921;
      if (!Number.isInteger(demoPort) || demoPort < 1 || demoPort > 65535) throw new Error('Invalid demo port');
      devices = new DeviceService(vault, library, jobs, { port: demoPort }); devices.on('change', publish); await devices.initialize();
    } catch { serviceError = 'Phone service unavailable. Unlock your macOS Keychain, check disk space, then quit and reopen the companion.'; devices = null; }
    publish();
    if (connectionDemo && devices && process.argv.includes('--recovery-phone-fixture')) {
      await require('./verify-phone-fixture.cjs').preparePhoneFixture({ vault, devices, jobs, directory: connectionDemo });
    }
    if (connectionDemo && devices && !process.argv.includes('--verify-connection') && !process.argv.includes('--verify-summary') && !process.argv.includes('--verify-recovery') && !process.argv.includes('--verify-notes') && !process.argv.includes('--verify-presentation') && !process.argv.includes('--verify-diary') && !process.argv.includes('--verify-question') && !process.argv.includes('--verify-history') && !process.argv.includes('--recovery-phone-fixture')) await window.webContents.executeJavaScript('document.getElementById("pair").click()');
    if (connectionDemo && devices && (process.argv.includes('--verify-notes') || process.argv.includes('--verify-presentation') || process.argv.includes('--verify-diary') || process.argv.includes('--verify-question') || process.argv.includes('--verify-history'))) {
      try { await require('./verify-notes.cjs').verifyNotes({ app, runtime, vault, jobs, devices, directory: connectionDemo, presentation: process.argv.includes('--verify-presentation'), diary: process.argv.includes('--verify-diary'), question: process.argv.includes('--verify-question'), history: process.argv.includes('--verify-history') }); }
      catch (error) { console.error('Notes verification failed:', error.stack || error.message); process.exitCode = 1; }
      app.quit();
    }
    if (connectionDemo && devices && process.argv.includes('--verify-recovery')) {
      try {
        await require('./verify-recovery.cjs').verifyRecovery({ app, runtime, vault, library, jobs, devices, directory: connectionDemo });
      } catch (error) { console.error('Recovery verification failed:', error.stack || error.message); console.error(JSON.stringify(jobs.list())); process.exitCode = 1; app.quit(); }
    }
    if (connectionDemo && (process.argv.includes('--verify-connection') || process.argv.includes('--verify-summary'))) {
      try {
        const { verifyConnection } = require('./verify-connection.cjs');
        await verifyConnection({ app, window, runtime, vault, library, jobs, devices, directory: connectionDemo, summary: process.argv.includes('--verify-summary') });
      } catch (error) { console.error('Connection verification failed:', error.message); process.exitCode = 1; }
      app.quit();
    }
    if (verification) {
      const { verify } = require('./verify.cjs');
      try { await verify({ app, window, runtime, directory: verification, provision: process.argv.includes('--provision-d01'), offline: process.argv.includes('--offline-d01') }); }
      catch (error) { console.error('D01 verification failed:', error.message); process.exitCode = 1; }
      app.quit();
    }
  }).catch((error) => { console.error('Application startup failed:', error.name); app.exit(1); });
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (quitting || !runtime) return;
  event.preventDefault(); quitting = true;
  const deadline = setTimeout(() => app.exit(1), 20000);
  (async () => { await library?.shutdown(); await devices?.stop(); await jobs?.shutdown(); await runtime.shutdown(); })().catch(() => { process.exitCode = 1; }).finally(() => { clearTimeout(deadline); app.exit(process.exitCode || 0); });
});
