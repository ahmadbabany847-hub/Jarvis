const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, execFile } = require("child_process");

const HOST = "127.0.0.1";
const PORT = 8765;

const ALLOWED_ORIGINS = new Set([
  "https://jarvis.ahmadbaban847.workers.dev",
  "http://127.0.0.1:8787",
  "http://localhost:8787"
]);

const APPS = {
  notepad: ["notepad.exe", []],
  calculator: ["calc.exe", []],
  explorer: ["explorer.exe", []],
  settings: ["explorer.exe", ["ms-settings:"]],
  paint: ["mspaint.exe", []],
  task_manager: ["taskmgr.exe", []],
  control_panel: ["control.exe", []],
  chrome: ["cmd.exe", ["/c", "start", "", "chrome"]],
  edge: ["cmd.exe", ["/c", "start", "", "msedge"]],
  vscode: ["cmd.exe", ["/c", "start", "", "code"]],
  word: ["cmd.exe", ["/c", "start", "", "winword"]],
  excel: ["cmd.exe", ["/c", "start", "", "excel"]],
  powerpoint: ["cmd.exe", ["/c", "start", "", "powerpnt"]]
};

const SITES = {
  google: "https://www.google.com/",
  youtube: "https://www.youtube.com/",
  github: "https://github.com/",
  gmail: "https://mail.google.com/",
  cloudflare: "https://dash.cloudflare.com/",
  chatgpt: "https://chatgpt.com/"
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
      if (raw.length > 8192) {
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

function startDetached(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });

    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { windowsHide: true, timeout: 15000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || error.message).trim()));
          return;
        }
        resolve(String(stdout || "").trim());
      }
    );
  });
}

async function openApp(name) {
  const app = APPS[name];
  if (!app) throw new Error("App is not allowed");
  await startDetached(app[0], app[1]);
}

async function openSite(name) {
  const url = SITES[name];
  if (!url) throw new Error("Site is not allowed");
  await startDetached("cmd.exe", ["/c", "start", "", url]);
}

async function volumeKey(code) {
  const script =
    "$s=New-Object -ComObject WScript.Shell; " +
    "$s.SendKeys([char]" + Number(code) + ")";
  await runPowerShell(script);
}

async function takeScreenshot() {
  const dir = path.join(os.homedir(), "Pictures");
  const file = path.join(dir, "JARVIS-Screenshot-" + Date.now() + ".png");
  const safe = file.replace(/'/g, "''");

  const script =
    "Add-Type -AssemblyName System.Windows.Forms; " +
    "Add-Type -AssemblyName System.Drawing; " +
    "$b=[System.Windows.Forms.SystemInformation]::VirtualScreen; " +
    "$i=New-Object System.Drawing.Bitmap $b.Width,$b.Height; " +
    "$g=[System.Drawing.Graphics]::FromImage($i); " +
    "$g.CopyFromScreen($b.Left,$b.Top,0,0,$b.Size); " +
    "$i.Save('" + safe + "'); $g.Dispose(); $i.Dispose();";

  await runPowerShell(script);
  return file;
}

async function executeAction(body) {
  const action = String(body.action || "");

  if (action === "open_app") {
    const target = String(body.target || "");
    await openApp(target);
    return { message: target + " opened" };
  }

  if (action === "open_site") {
    const target = String(body.target || "");
    await openSite(target);
    return { message: target + " opened" };
  }

  if (action === "volume_up") {
    await volumeKey(175);
    return { message: "volume up" };
  }

  if (action === "volume_down") {
    await volumeKey(174);
    return { message: "volume down" };
  }

  if (action === "mute") {
    await volumeKey(173);
    return { message: "mute toggled" };
  }

  if (action === "screenshot") {
    const file = await takeScreenshot();
    return { message: "screenshot saved", path: file };
  }

  if (action === "lock") {
    await startDetached("rundll32.exe", ["user32.dll,LockWorkStation"]);
    return { message: "computer locked" };
  }

  throw new Error("Unsupported action");
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
      version: "0.2.0",
      capabilities: {
        apps: Object.keys(APPS),
        sites: Object.keys(SITES),
        actions: ["volume_up", "volume_down", "mute", "screenshot", "lock"]
      }
    }, origin);
    return;
  }

  if (req.method === "POST" && req.url === "/open-app") {
    try {
      const body = await readJson(req);
      const app = String(body.app || "").toLowerCase();
      await openApp(app);
      send(res, 200, { ok: true, message: app + " opened" }, origin);
    } catch (error) {
      send(res, 400, { ok: false, error: error.message || "Failed" }, origin);
    }
    return;
  }

  if (req.method === "POST" && req.url === "/action") {
    try {
      const body = await readJson(req);
      const result = await executeAction(body);
      send(res, 200, { ok: true, ...result }, origin);
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
  console.log("Version 0.2.0");
  console.log("Keep this window open while using PC controls.");
});
