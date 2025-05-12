const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, spawn } = require('child_process');
const https = require('https');
const { execSync } = require('child_process');
const unzip = require('unzipper');
const sudo = require('sudo-prompt');

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    }
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

function killPort3001() {
  try {
    console.log('[CLEANUP] Attempting to kill all processes on port 3001...');
    const { execSync } = require('child_process');
    if (process.platform !== 'win32') {
      execSync('lsof -ti :3001 | xargs kill -9', { stdio: 'ignore' });
    } else {
      const pids = execSync('netstat -ano | findstr :3001').toString().split('\n')
        .map(line => line.trim().split(/\s+/).pop())
        .filter(pid => pid && !isNaN(pid));
      pids.forEach(pid => {
        try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' }); } catch (e) {}
      });
    }
    console.log('[CLEANUP] Port 3001 cleanup complete.');
  } catch (e) { console.log('[CLEANUP] Error during port 3001 cleanup:', e.message); }
}

app.on('window-all-closed', () => {
  if (agentProcess) {
    agentProcess.kill();
    agentProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (agentProcess) {
    agentProcess.kill();
    agentProcess = null;
  }
  killPort3001();
  // Remove or empty pairing-code.txt on quit
  if (agentBasePath) {
    const codePath = path.join(agentBasePath, 'pairing-code.txt');
    try {
      if (fs.existsSync(codePath)) {
        fs.writeFileSync(codePath, ''); // Empty the file
        // Or, to delete: fs.unlinkSync(codePath);
        console.log('[CLEANUP] pairing-code.txt emptied on quit.');
      }
    } catch (e) {
      console.warn('[CLEANUP] Could not empty pairing-code.txt:', e.message);
    }
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// --- IPC and backend logic ---

const extraPaths = ['/usr/local/bin', '/opt/homebrew/bin'];
function getEnvWithExtraPath() {
  const sep = process.platform === 'win32' ? ';' : ':';
  const current = process.env.PATH || '';
  const extra = extraPaths.filter(p => !current.includes(p)).join(sep);
  return { ...process.env, PATH: extra ? extra + sep + current : current };
}
function trySpawn(cmd, args, opts, fallbackCmds = [], onSuccess, onError) {
  const env = getEnvWithExtraPath();
  let tried = [cmd, ...fallbackCmds];
  function tryNext(i) {
    if (i >= tried.length) return onError(new Error('All spawn attempts failed'));
    const c = tried[i];
    const p = spawn(c, args, { ...opts, env });
    let errored = false;
    p.on('error', (err) => {
      errored = true;
      tryNext(i + 1);
    });
    p.on('spawn', () => {
      if (!errored) onSuccess(p);
    });
  }
  tryNext(0);
}
function tryExec(cmd, cb) {
  const env = getEnvWithExtraPath();
  exec(cmd, { env }, (err, stdout, stderr) => {
    if (err) {
      // Try with full path if not found
      if (cmd.startsWith('node')) return exec('/usr/local/bin/node' + cmd.slice(4), { env }, cb);
      if (cmd.startsWith('ffmpeg')) return exec('/usr/local/bin/ffmpeg' + cmd.slice(6), { env }, cb);
      if (cmd.startsWith('brew')) return exec('/opt/homebrew/bin/brew' + cmd.slice(4), { env }, cb);
      if (cmd.startsWith('ngrok')) return exec('/usr/local/bin/ngrok' + cmd.slice(5), { env }, cb);
    }
    cb(err, stdout, stderr);
  });
}

function checkInstalled(cmd, cb) {
  tryExec((os.platform() === 'win32' ? 'where ' : 'which ') + cmd, (err) => cb(!err));
}

function downloadFile(url, dest, cb) {
  const file = fs.createWriteStream(dest);
  https.get(url, (response) => {
    if (response.statusCode !== 200) return cb(new Error('Failed to download: ' + url));
    response.pipe(file);
    file.on('finish', () => file.close(cb));
  }).on('error', (err) => {
    fs.unlink(dest, () => cb(err));
  });
}

function installNode(cb) {
  checkInstalled('node', (ok) => {
    if (ok) return cb(true);
    if (os.platform() === 'darwin') {
      // Download and install Node.js .pkg
      const nodeUrl = 'https://nodejs.org/dist/v20.11.1/node-v20.11.1.pkg';
      const dest = '/tmp/node-v20.11.1.pkg';
      downloadFile(nodeUrl, dest, (err) => {
        if (err) return cb(false, 'Failed to download Node.js: ' + err.message);
        sudo.exec(`installer -pkg ${dest} -target /`, { name: 'Local Agent Launcher' }, (error, stdout, stderr) => {
          if (error) return cb(false, 'Failed to install Node.js: ' + error.message);
          cb(true);
        });
      });
    } else if (os.platform() === 'win32') {
      tryExec('choco install nodejs', (err, stdout, stderr) => cb(!err, err ? stderr || err.message : ''));
    } else {
      tryExec('sudo apt-get install -y nodejs', (err, stdout, stderr) => cb(!err, err ? stderr || err.message : ''));
    }
  });
}

function installFfmpeg(cb) {
  checkInstalled('ffmpeg', (ok) => {
    if (ok) return cb(true);
    if (os.platform() === 'darwin') {
      // Download and install ffmpeg binary
      const ffmpegUrl = 'https://evermeet.cx/ffmpeg/ffmpeg-6.1.1.zip';
      const dest = '/tmp/ffmpeg.zip';
      downloadFile(ffmpegUrl, dest, (err) => {
        if (err) return cb(false, 'Failed to download ffmpeg: ' + err.message);
        fs.createReadStream(dest)
          .pipe(unzip.Extract({ path: '/tmp' }))
          .on('close', () => {
            sudo.exec('chmod +x /tmp/ffmpeg && mv /tmp/ffmpeg /usr/local/bin/ffmpeg', { name: 'Local Agent Launcher' }, (error, stdout, stderr) => {
              if (error) return cb(false, 'Failed to install ffmpeg: ' + error.message);
              cb(true);
            });
          })
          .on('error', (e) => cb(false, 'Failed to unzip ffmpeg: ' + e.message));
      });
    } else if (os.platform() === 'win32') {
      tryExec('choco install ffmpeg', (err, stdout, stderr) => cb(!err, err ? stderr || err.message : ''));
    } else {
      tryExec('sudo apt-get install -y ffmpeg', (err, stdout, stderr) => cb(!err, err ? stderr || err.message : ''));
    }
  });
}

function installFfprobe(cb) {
  checkInstalled('ffprobe', (ok) => {
    if (ok) return cb(true);
    if (os.platform() === 'darwin') {
      // Download and install ffprobe binary (from evermeet.cx, same as ffmpeg)
      const ffprobeUrl = 'https://evermeet.cx/ffmpeg/ffprobe-6.1.1.zip';
      const dest = '/tmp/ffprobe.zip';
      downloadFile(ffprobeUrl, dest, (err) => {
        if (err) return cb(false, 'Failed to download ffprobe: ' + err.message);
        fs.createReadStream(dest)
          .pipe(unzip.Extract({ path: '/tmp' }))
          .on('close', () => {
            sudo.exec('chmod +x /tmp/ffprobe && mv /tmp/ffprobe /usr/local/bin/ffprobe', { name: 'Local Agent Launcher' }, (error, stdout, stderr) => {
              if (error) return cb(false, 'Failed to install ffprobe: ' + error.message);
              cb(true);
            });
          })
          .on('error', (e) => cb(false, 'Failed to unzip ffprobe: ' + e.message));
      });
    } else if (os.platform() === 'win32') {
      tryExec('choco install ffprobe', (err, stdout, stderr) => cb(!err, err ? stderr || err.message : ''));
    } else {
      tryExec('sudo apt-get install -y ffprobe', (err, stdout, stderr) => cb(!err, err ? stderr || err.message : ''));
    }
  });
}

function installNgrok(cb) {
  checkInstalled('ngrok', (ok) => {
    if (ok) return cb(true);
    if (os.platform() === 'darwin') {
      // Download and install ngrok binary (arm64 by default)
      const ngrokUrl = 'https://bin.equinox.io/c/4VmDzA7iaHb/ngrok-stable-darwin-arm64.zip';
      const dest = '/tmp/ngrok.zip';
      downloadFile(ngrokUrl, dest, (err) => {
        if (err) return cb(false, 'Failed to download ngrok: ' + err.message);
        fs.createReadStream(dest)
          .pipe(unzip.Extract({ path: '/tmp' }))
          .on('close', () => {
            sudo.exec('chmod +x /tmp/ngrok && mv /tmp/ngrok /usr/local/bin/ngrok', { name: 'Local Agent Launcher' }, (error, stdout, stderr) => {
              if (error) return cb(false, 'Failed to install ngrok: ' + error.message);
              cb(true);
            });
          })
          .on('error', (e) => cb(false, 'Failed to unzip ngrok: ' + e.message));
      });
    } else if (os.platform() === 'win32') {
      tryExec('choco install ngrok', (err, stdout, stderr) => cb(!err, err ? stderr || err.message : ''));
    } else {
      tryExec('sudo apt-get install -y ngrok', (err, stdout, stderr) => cb(!err, err ? stderr || err.message : ''));
    }
  });
}

ipcMain.handle('check-install-deps', async (event) => {
  return new Promise((resolve) => {
    let results = { node: false, ffmpeg: false, ffprobe: false, ngrok: false };
    let errors = { node: '', ffmpeg: '', ffprobe: '', ngrok: '' };

    function wrapInstall(fn, key, label) {
      return (cb) => {
        event.sender.send('dep-status', { dep: key, status: 'installing', message: `Installing ${label}...` });
        fn((ok, errMsg) => {
          results[key] = ok;
          errors[key] = errMsg || '';
          if (ok) {
            event.sender.send('dep-status', { dep: key, status: 'success', message: `${label} installed successfully.` });
          } else {
            event.sender.send('dep-status', { dep: key, status: 'error', message: `Failed to install ${label}: ${errMsg || 'Unknown error'}` });
          }
          cb(ok);
        });
      };
    }

    wrapInstall(installNode, 'node', 'Node.js')((nodeOk) => {
      wrapInstall(installFfmpeg, 'ffmpeg', 'ffmpeg')((ffmpegOk) => {
        wrapInstall(installFfprobe, 'ffprobe', 'ffprobe')((ffprobeOk) => {
          wrapInstall(installNgrok, 'ngrok', 'ngrok')((ngrokOk) => {
            const failed = Object.entries(results)
              .filter(([_, ok]) => !ok)
              .map(([name]) => name);
            if (failed.length === 0) {
              resolve({ summary: 'All dependencies installed.', details: '' });
            } else {
              let details = failed.map(dep => `${dep}: ${errors[dep] || 'Unknown error'}`).join('\n');
              resolve({ summary: `Some dependencies failed to install: ${failed.join(', ')}`, details });
            }
          });
        });
      });
    });
  });
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled) return null;
  return result.filePaths[0];
});

let agentBasePath = null;

ipcMain.handle('select-agent-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled) return null;
  agentBasePath = result.filePaths[0];
  return agentBasePath;
});

ipcMain.handle('write-env', async (event, folderPath) => {
  try {
    if (!agentBasePath) throw new Error('Agent folder not selected');
    const envPath = path.join(agentBasePath, '.env');
    let env = fs.readFileSync(envPath, 'utf-8');
    env = env.replace(/VIDEO_ROOT_DIR=.*/g, `VIDEO_ROOT_DIR=${folderPath}`);
    env = env.replace(/WATCH_PATH=.*/g, `WATCH_PATH=${folderPath}`);
    fs.writeFileSync(envPath, env, 'utf-8');
    return { success: true };
  } catch (err) {
    console.error('Failed to update .env:', err);
    return { success: false, error: err.message };
  }
});

let agentProcess = null;
ipcMain.handle('run-agent', async () => {
  return new Promise((resolve, reject) => {
    if (!agentBasePath) return resolve('');
    if (agentProcess) {
      agentProcess.kill();
      agentProcess = null;
    }
    const agentDir = agentBasePath;
    const env = getEnvWithExtraPath();
    // Ensure node_modules exists
    const nodeModulesPath = path.join(agentDir, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
      try {
        console.log('[run-agent] node_modules not found, running npm install...');
        execSync('npm install', { cwd: agentDir, env, stdio: 'inherit' });
        console.log('[run-agent] npm install completed.');
      } catch (e) {
        console.error('[run-agent] npm install failed:', e.message);
        return resolve('Failed to install dependencies for local agent: ' + e.message);
      }
    }
    console.log('Using PATH for agent:', env.PATH);
    trySpawn('npm', ['run', 'prod'], { cwd: agentDir, env },
      ['/usr/local/bin/npm', '/opt/homebrew/bin/npm'],
      (proc) => {
        const codePath = path.join(agentDir, 'pairing-code.txt');
        console.log('[run-agent] Looking for pairing code at:', codePath);
        const maxWait = 10000;
        const pollInterval = 500;
        let waited = 0;
        const poll = setInterval(() => {
          if (fs.existsSync(codePath)) {
            const code = fs.readFileSync(codePath, 'utf-8').trim();
            if (code) {
              clearInterval(poll);
              resolve(code);
            }
          }
          waited += pollInterval;
          if (waited >= maxWait) {
            clearInterval(poll);
            resolve('');
          }
        }, pollInterval);
        proc.on('exit', () => { agentProcess = null; });
      },
      (err) => {
        console.error('Failed to spawn npm run prod:', err);
        resolve('');
      }
    );
  });
});

ipcMain.handle('read-pairing-code', async () => {
  if (!agentBasePath) return '';
  const codePath = path.join(agentBasePath, 'pairing-code.txt');
  console.log('[read-pairing-code] Looking for pairing code at:', codePath);
  if (fs.existsSync(codePath)) {
    return fs.readFileSync(codePath, 'utf-8').trim();
  }
  return '';
});

ipcMain.handle('copy-to-clipboard', async () => {
  if (!agentBasePath) return false;
  const codePath = path.join(agentBasePath, 'pairing-code.txt');
  console.log('[copy-to-clipboard] Looking for pairing code at:', codePath);
  let code = '';
  if (fs.existsSync(codePath)) {
    code = fs.readFileSync(codePath, 'utf-8').trim();
    clipboard.writeText(code);
    return true;
  }
  return false;
});

ipcMain.handle('get-pairing-code-path', async () => {
  if (!agentBasePath) return '';
  return path.join(agentBasePath, 'pairing-code.txt');
});

ipcMain.handle('file-exists', async (event, filePath) => {
  try {
    return fs.existsSync(filePath);
  } catch (e) {
    return false;
  }
}); 