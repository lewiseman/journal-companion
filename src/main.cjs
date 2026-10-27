const { app, BrowserWindow, ipcMain, dialog, protocol, session, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { Runtime, publicError } = require('./runtime.cjs');

// Developer credentials stay in the main process; .env files are never packaged.
if (!app.isPackaged) {
  try { process.loadEnvFile(path.join(app.getAppPath(), '.env')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Could not read the local .env file. Check its format and permissions.'); }
}

app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme: 'journal', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const verification = process.argv.find((arg) => arg.startsWith('--verify-d01='))?.slice('--verify-d01='.length);
if (verification) {
  if (!path.isAbsolute(verification)) throw new Error('Verification directory must be absolute');
  app.setPath('userData', path.join(verification, 'app-data'));
}
let window;
let runtime;
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
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
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
    for (const event of ['state', 'token']) runtime.on(event, (value) => {
      if (!window.isDestroyed()) window.webContents.send(`companion:${event}`, value);
    });
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
    handle('state', noArgs(() => runtime.snapshot()));
    handle('download', noArgs(() => runtime.download()));
    handle('load', noArgs(() => runtime.load()));
    handle('unload', noArgs(() => runtime.unload()));
    handle('generate', (...args) => {
      if (args.length !== 1) throw new Error('Invalid arguments');
      return runtime.generate(args[0]);
    });
    let choosing = false;
    handle('choose', noArgs(async () => {
      if (runtime.busy || choosing) return { ok: false, error: { code: 'BUSY', message: 'Wait for the current operation to finish.' } };
      choosing = true;
      try {
        const result = await dialog.showOpenDialog(window, { title: 'Select Qwen2.5 0.5B Instruct Q4_K_M', properties: ['openFile'], filters: [{ name: 'GGUF model', extensions: ['gguf'] }] });
        return result.canceled ? { ok: true, canceled: true } : runtime.select(result.filePaths[0]);
      } finally { choosing = false; }
    }));
    await window.loadURL(APP_URL);
    await runtime.initialize();
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
  runtime.shutdown().catch(() => { process.exitCode = 1; }).finally(() => { clearTimeout(deadline); app.exit(process.exitCode || 0); });
});
