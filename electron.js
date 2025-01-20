import { app, BrowserWindow } from 'electron'
import * as http from 'http';
import * as net from 'net';
import { spawn } from 'child_process';

/*-- Globals -----------------------------------------------------------------*/

// The port the server will run on
let PORT;

// The child process managing the server
let SERVER_PROCESS;

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
            }).then((port) => {
                console.log(`FOUND AVAILABLE PORT: ${port}`);
                return port;
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

    // Launch the server
    const env = process.env;
    env.WEBUI_AUTH = 'False';
    const command = `open-webui serve --port ${PORT}`;
    console.log(`Launching subprocess with command: ${command}`);
    const subprocessEnv = { ...process.env };
    subprocessEnv.WEBUI_AUTH = 'False';
    SERVER_PROCESS = spawn(command, { shell: true, env: subprocessEnv });

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
    })

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