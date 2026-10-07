const http = require("http");
const os = require("os");
const { spawn } = require("child_process");

const HOST = "127.0.0.1";
const PORT = 8765;

const ALLOWED_ORIGINS = new Set([
  "https://jarvis.ahmadbaban847.workers.dev",
  "http://127.0.0.1:8787",
  "http://localhost:8787"
]);

const APPS = {
  notepad: { command: "notepad.exe", args: [] },
  calculator: { command: "calc.exe", args: [] },
  explorer: { command: "explorer.exe", args: [] },
  settings: { command: "explorer.exe", args: ["ms-settings:"] }
};

function headers(origin) {
  const h = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Cache-Control": "no-store"
  };

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Vary"] = "Origin";
  }

  return h;
}

function send(res, status, body, origin) {
  res.writeHead(status, headers(origin));
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 4096) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

function openApp(name) {
  const app = APPS[name];
  if (!app) throw new Error("App is not allowed");

  const child = spawn(app.command, app.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });

  child.unref();
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    send(res, 403, { ok: false, error: "Origin not allowed" }, origin);
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, headers(origin));
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/status") {
    send(res, 200, {
      ok: true,
      device: os.hostname(),
      platform: "windows",
      version: "0.1.0",
      capabilities: Object.keys(APPS)
    }, origin);
    return;
  }

  if (req.method === "POST" && req.url === "/open-app") {
    try {
      const body = await readJson(req);
      const app = String(body.app || "").toLowerCase();
      openApp(app);
      send(res, 200, { ok: true, message: app + " opened" }, origin);
    } catch (error) {
      send(res, 400, { ok: false, error: error.message || "Failed" }, origin);
    }
    return;
  }

  send(res, 404, { ok: false, error: "Not found" }, origin);
});

server.listen(PORT, HOST, () => {
  console.log("JARVIS Windows Agent is running.");
  console.log("http://" + HOST + ":" + PORT);
  console.log("Keep this window open while using PC controls.");
});
