import { app, BrowserWindow } from 'electron'
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as net from 'net';
import * as path from 'path';
import { spawn } from 'child_process';

/*-- Globals -----------------------------------------------------------------*/

// The port the server will run on
let PORT;

// The child process managing the server
let SERVER_PROCESS;

// Dock bounce request
let BOUNCE_ID;

/*-- Helpers -----------------------------------------------------------------*/

async function findAvailablePort() {
    const portRange = [8090, 80808];
    for (let currentPort of portRange) {
        try {
            const availablePort = await new Promise((resolve, reject) => {
                const server = net.createServer();
                server.listen(currentPort, () => {
                    console.log(`Port ${currentPort} is available.`);
                    server.close(() => {
                        PORT = currentPort;
                        resolve();
                    });
                });

                server.on('error', (err) => {
                    if (err.code === 'EADDRINUSE') {
                        console.log(`Port ${currentPort} is in use.`);
                    } else {
                        reject(err);
                    }

                    currentPort++;
                });
            });
            return availablePort;
        } catch {
            continue;
        }
    }
}

async function launchOpenWebUI() {
    if (!PORT) {
        throw new Error('No available ports found in the specified range.');
    }

    // Indicate that the app is loading
    BOUNCE_ID = app.dock.bounce('critical');

    // Make sure the local python env is accessible when launching the
    // subprocess
    // TODO: Handle different path layouts for dev/prod and by platform!
    const appPath = app.getAppPath();
    const contentsPath = path.join(appPath, '..', '..');
    const pythonpathEnv = (await fs.promises.readFile(path.join(contentsPath, 'pythonpath.env'))).toString().trim();
    let cmdExe = path.join(contentsPath, 'venv', 'bin', 'open-webui');
    if (await os.platform() == 'win32') {
        cmdExe = path.join(contentsPath, 'venv', 'Scripts', 'open-webui');
    } else {
        cmdExe = cmdExe.replace(" ", "\\ ");
    }
    console.log(`appPath: ${appPath}`);
    console.log(`contentsPath: ${contentsPath}`);
    console.log(`pythonpathEnv: ${pythonpathEnv}`);
    console.log(`cmdExe: ${cmdExe}`);

    // Launch the server
    const env = process.env;
    env.WEBUI_AUTH = 'False';
    const command = `${cmdExe} serve --port ${PORT}`;
    console.log(`Launching subprocess with command: ${command}`);
    const subprocessEnv = { ...process.env };
    subprocessEnv.WEBUI_AUTH = 'False';
    subprocessEnv.PYTHONPATH = pythonpathEnv;
    SERVER_PROCESS = spawn(command, { shell: true, cwd: contentsPath, env: subprocessEnv });

    // Bind the process to the subprocess's stdout and stderr streams.
    SERVER_PROCESS.stderr.on('data', (data) => {
        process.stderr.write(data);
    });
    SERVER_PROCESS.stdout.on('data', (data) => {
        process.stdout.write(data);
    });
    SERVER_PROCESS.stdout.on('close', (code) => {
        console.log(`Child process exited with code : ${code}`);
    });
}

async function waitForReady(maxTimeout = 50000, maxRetries = 100, attempt = 0) {
    return new Promise((resolve, reject) => {
        const retryableError = (err) => err.code === 'ECONNREFUSED' || err.code !== 'ETIMEDOUT';
        console.log(`Attempt ${attempt + 1} of ${maxRetries} to connect to Open WebUI on port ${PORT}...`);
        const req = http.request(`http://localhost:${PORT}/health`, (res) => {
            res.on('end', () => {
                console.log('Open WebUI is up and running!');
                if (BOUNCE_ID !== undefined) {
                    app.dock.cancelBounce(BOUNCE_ID);
                    BOUNCE_ID = undefined;
                }
                resolve();
            });
        });
        req.on('error', (e) => {
            if (!retryableError(e)) {
                reject(e);
            }
            const timeout = Math.min(Math.pow(2, attempt) * 1000, maxTimeout); // Exponential backoff
            setTimeout(async () => {
                console.log(`Attempt ${attempt + 1} timed out, retrying in ${timeout / 1000} seconds...`);
                await waitForReady(PORT, maxTimeout - timeout, maxRetries, attempt + 1);
                resolve();
            }, timeout).then;
        });
        req.setTimeout(1000, () => { // Short timeout of 1 second
            console.log('Request timed out after 1 second');
            req.abort();
        });
        req.end();
    });
}

function createWindow () {
    console.log(`Starting Electron window on port ${PORT}...`);
    // Create the browser window.
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true
        }
    });

    // Load your web UI into this window
    win.loadURL(`http://localhost:${PORT}`);
}

/*-- Main --------------------------------------------------------------------*/

app.whenReady()
    .then(findAvailablePort)
    .then(launchOpenWebUI)
    .then(waitForReady)
    .then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on('will-quit', () => {
    if (SERVER_PROCESS) {
        console.log('Stopping Open WebUI');
        SERVER_PROCESS.kill();
    }
});