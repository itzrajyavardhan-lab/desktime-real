'use strict';

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const si = require('systeminformation');
const path = require('path');
const Database = require('better-sqlite3');
const schedule = require('node-schedule');
const { exec } = require('child_process');
const fs = require('fs');
const open = require('open');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ── Database setup ─────────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, '..', 'data', 'desktime.db');
if (!fs.existsSync(path.dirname(DB_PATH))) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS app_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    app_name TEXT NOT NULL,
    window_title TEXT,
    duration_seconds INTEGER DEFAULT 0,
    category TEXT DEFAULT 'neutral',
    status TEXT DEFAULT 'neutral',
    hour INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS system_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    cpu_load REAL,
    mem_used REAL,
    mem_total REAL,
    battery_percent INTEGER,
    battery_charging INTEGER,
    active_app TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT,
    duration_seconds INTEGER DEFAULT 0,
    type TEXT DEFAULT 'work'
  );
  CREATE TABLE IF NOT EXISTS pomodoro_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    type TEXT,
    duration_minutes INTEGER,
    completed INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    text TEXT NOT NULL,
    target_value REAL,
    done_value REAL DEFAULT 0,
    unit TEXT DEFAULT 'h',
    completed INTEGER DEFAULT 0
  );
`);

// ── App categorization ─────────────────────────────────────────────────────
const APP_CATEGORIES = {
  productive: [
    'code','vscode','visual studio','intellij','webstorm','pycharm','android studio',
    'sublime','atom','vim','nvim','neovim','emacs','eclipse','netbeans',
    'terminal','iterm','cmd','powershell','bash','zsh','git','node','npm','python','java',
    'figma','sketch','adobe','photoshop','illustrator','xd','inkscape','gimp','blender',
    'postman','insomnia','docker','kubernetes','vmware','virtualbox',
    'notion','obsidian','onenote','evernote','bear',
    'excel','word','powerpoint','sheets','docs','slides','libreoffice',
    'slack','teams','zoom','meet','webex','discord'
  ],
  unproductive: [
    'youtube','netflix','prime video','hotstar','disney','twitch','reddit',
    'facebook','instagram','twitter','tiktok','snapchat','whatsapp','telegram',
    'games','steam','epic games','minecraft','valorant','pubg','fortnite',
    'solitaire','candy crush','clash'
  ],
  neutral: [
    'chrome','firefox','safari','edge','brave','opera',
    'explorer','finder','files','nautilus',
    'settings','control panel','system preferences',
    'calculator','calendar','clock','mail','outlook','thunderbird',
    'spotify','vlc','media player','photos','gallery'
  ]
};

function categorizeApp(name) {
  const lower = (name || '').toLowerCase();
  for (const [status, apps] of Object.entries(APP_CATEGORIES)) {
    if (apps.some(a => lower.includes(a))) return status;
  }
  return 'neutral';
}

function getAppCategory(name) {
  const lower = (name || '').toLowerCase();
  if (['code','vscode','intellij','sublime','vim','nvim','atom','webstorm','pycharm'].some(a=>lower.includes(a))) return 'Development';
  if (['terminal','iterm','cmd','powershell','bash','zsh'].some(a=>lower.includes(a))) return 'Terminal';
  if (['chrome','firefox','safari','edge','brave','opera'].some(a=>lower.includes(a))) return 'Browser';
  if (['figma','sketch','photoshop','illustrator','xd','gimp','blender','inkscape'].some(a=>lower.includes(a))) return 'Design';
  if (['slack','teams','discord','zoom','meet','mail','outlook','telegram','whatsapp'].some(a=>lower.includes(a))) return 'Communication';
  if (['youtube','netflix','spotify','vlc','twitch'].some(a=>lower.includes(a))) return 'Media';
  if (['notion','obsidian','onenote','evernote'].some(a=>lower.includes(a))) return 'Notes';
  if (['excel','word','sheets','docs','libreoffice','powerpoint'].some(a=>lower.includes(a))) return 'Office';
  if (['postman','docker','insomnia'].some(a=>lower.includes(a))) return 'Dev Tools';
  if (['reddit','facebook','instagram','twitter','tiktok'].some(a=>lower.includes(a))) return 'Social';
  return 'System';
}

// ── Active window detection ────────────────────────────────────────────────
let lastActiveApp = null;
let lastActiveTime = Date.now();
let sessionStart = new Date();
let isTracking = true;

async function getActiveWindow() {
  return new Promise((resolve) => {
    const platform = process.platform;
    let cmd = '';
    if (platform === 'win32') {
      cmd = `powershell -command "Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32{
  [DllImport(\\"user32.dll\\")]public static extern IntPtr GetForegroundWindow();
  [DllImport(\\"user32.dll\\")]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
  [DllImport(\\"user32.dll\\")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
}
'@
$h=([Win32]::GetForegroundWindow());
$s=New-Object System.Text.StringBuilder(256);
[Win32]::GetWindowText($h,$s,256)|Out-Null;
$pid2=0;[Win32]::GetWindowThreadProcessId($h,[ref]$pid2)|Out-Null;
$p=Get-Process -Id $pid2 -ErrorAction SilentlyContinue;
Write-Output ($p.ProcessName + '|' + $s.ToString())"`;
    } else if (platform === 'darwin') {
      cmd = `osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`;
    } else {
      cmd = `xdotool getactivewindow getwindowname 2>/dev/null || echo "Unknown"`;
    }
    exec(cmd, { timeout: 2000 }, (err, stdout) => {
      if (err) { resolve({ app: 'Unknown', title: '' }); return; }
      const out = stdout.trim();
      if (platform === 'win32') {
        const parts = out.split('|');
        resolve({ app: parts[0] || 'Unknown', title: parts[1] || '' });
      } else {
        resolve({ app: out || 'Unknown', title: out || '' });
      }
    });
  });
}

// ── Data collection loop ───────────────────────────────────────────────────
let latestSystemData = {};
let appUsageToday = {};
let systemHistory = [];

async function collectData() {
  if (!isTracking) return;
  try {
    const [cpu, mem, battery, activeWin] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.battery(),
      getActiveWindow()
    ]);

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const hour = now.getHours();
    const cpuLoad = Math.round(cpu.currentLoad);
    const memUsed = Math.round(mem.used / 1024 / 1024 / 1024 * 10) / 10;
    const memTotal = Math.round(mem.total / 1024 / 1024 / 1024 * 10) / 10;
    const battPct = battery.percent || 0;
    const charging = battery.isCharging ? 1 : 0;
    const appName = activeWin.app || 'Unknown';

    // Track app usage
    if (appName !== 'Unknown' && appName !== lastActiveApp) {
      if (lastActiveApp) {
        const dur = Math.round((Date.now() - lastActiveTime) / 1000);
        if (dur > 2) {
          const status = categorizeApp(lastActiveApp);
          const category = getAppCategory(lastActiveApp);
          const existing = db.prepare('SELECT id, duration_seconds FROM app_usage WHERE date=? AND app_name=? AND hour=?').get(today, lastActiveApp, hour);
          if (existing) {
            db.prepare('UPDATE app_usage SET duration_seconds=? WHERE id=?').run(existing.duration_seconds + dur, existing.id);
          } else {
            db.prepare('INSERT INTO app_usage (date, app_name, window_title, duration_seconds, category, status, hour) VALUES (?,?,?,?,?,?,?)').run(today, lastActiveApp, activeWin.title, dur, category, status, hour);
          }
          if (!appUsageToday[lastActiveApp]) appUsageToday[lastActiveApp] = { seconds: 0, status, category };
          appUsageToday[lastActiveApp].seconds += dur;
        }
      }
      lastActiveApp = appName;
      lastActiveTime = Date.now();
    }

    // System snapshot (every 5s)
    db.prepare('INSERT INTO system_snapshots (cpu_load, mem_used, mem_total, battery_percent, battery_charging, active_app) VALUES (?,?,?,?,?,?)').run(cpuLoad, memUsed, memTotal, battPct, charging, appName);

    // Keep history for charts (last 60 points = 5 min)
    systemHistory.push({ t: now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}), cpu: cpuLoad, mem: memUsed, battery: battPct });
    if (systemHistory.length > 60) systemHistory.shift();

    latestSystemData = { cpu: cpuLoad, mem: { used: memUsed, total: memTotal, pct: Math.round(memUsed/memTotal*100) }, battery: { pct: battPct, charging }, activeApp: appName, activeTitle: activeWin.title, timestamp: now.toISOString(), tracking: isTracking };

    // Broadcast to all WS clients
    broadcast({ type: 'system', data: latestSystemData });

  } catch (e) {
    // silently ignore
  }
}

// Run every 5 seconds
setInterval(collectData, 5000);
collectData();

// ── Session tracking ────────────────────────────────────────────────────────
const today = () => new Date().toISOString().split('T')[0];
let currentSession = null;

function startSession() {
  const now = new Date();
  currentSession = db.prepare("INSERT INTO sessions (date, start_time, type) VALUES (?,?,?)").run(today(), now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}), 'work').lastInsertRowid;
}
function endSession() {
  if (!currentSession) return;
  const now = new Date();
  db.prepare("UPDATE sessions SET end_time=?, duration_seconds=? WHERE id=?").run(now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}), Math.round((Date.now() - sessionStart)/1000), currentSession);
  currentSession = null;
}
startSession();
process.on('exit', endSession);
process.on('SIGINT', () => { endSession(); process.exit(0); });

// ── WebSocket ──────────────────────────────────────────────────────────────
function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(data); });
}

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'init', data: latestSystemData, history: systemHistory }));
  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'toggleTracking') {
        isTracking = !isTracking;
        broadcast({ type: 'trackingStatus', tracking: isTracking });
      }
    } catch {}
  });
});

// ── API Routes ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());

// Today's stats
app.get('/api/today', async (req, res) => {
  const d = today();
  const apps = db.prepare("SELECT app_name, SUM(duration_seconds) as total, category, status FROM app_usage WHERE date=? GROUP BY app_name ORDER BY total DESC LIMIT 20").all(d);
  const totalSec = apps.reduce((a,b) => a+b.total, 0);
  const prodSec = apps.filter(a=>a.status==='productive').reduce((a,b)=>a+b.total,0);
  const unprodSec = apps.filter(a=>a.status==='unproductive').reduce((a,b)=>a+b.total,0);
  const neutralSec = apps.filter(a=>a.status==='neutral').reduce((a,b)=>a+b.total,0);
  const sessions = db.prepare("SELECT * FROM sessions WHERE date=? ORDER BY id DESC LIMIT 10").all(d);
  const sessionStart = sessions.length ? sessions[sessions.length-1].start_time : '--:--';
  res.json({ apps, totalSec, prodSec, unprodSec, neutralSec, sessions, sessionStart, date: d });
});

// Hourly breakdown
app.get('/api/hourly', (req, res) => {
  const d = today();
  const rows = db.prepare("SELECT hour, SUM(duration_seconds) as total, status FROM app_usage WHERE date=? GROUP BY hour, status").all(d);
  const hours = {};
  for (let h=0; h<24; h++) hours[h] = { productive:0, unproductive:0, neutral:0 };
  rows.forEach(r => { if(hours[r.hour]) hours[r.hour][r.status] = r.total; });
  res.json(hours);
});

// Weekly data
app.get('/api/weekly', (req, res) => {
  const rows = db.prepare("SELECT date, SUM(duration_seconds) as total, status FROM app_usage WHERE date >= date('now','-7 days') GROUP BY date, status ORDER BY date").all();
  const byDate = {};
  rows.forEach(r => {
    if (!byDate[r.date]) byDate[r.date] = { productive:0, unproductive:0, neutral:0 };
    byDate[r.date][r.status] = r.total;
  });
  res.json(byDate);
});

// System history
app.get('/api/system-history', (req, res) => {
  res.json(systemHistory);
});

// Live system
app.get('/api/system', async (req, res) => {
  try {
    const [cpuData, mem, battery, disk, network, os] = await Promise.all([
      si.currentLoad(), si.mem(), si.battery(), si.fsSize(), si.networkStats(), si.osInfo()
    ]);
    const cpuDetails = await si.cpu();
    res.json({
      cpu: { load: Math.round(cpuData.currentLoad), cores: cpuData.cpus?.length || 4, model: cpuDetails.brand },
      mem: { used: Math.round(mem.used/1024/1024/1024*10)/10, total: Math.round(mem.total/1024/1024/1024*10)/10, pct: Math.round(mem.used/mem.total*100) },
      battery: { pct: battery.percent || 0, charging: battery.isCharging, timeRemaining: battery.timeRemaining },
      disk: disk.map(d=>({ fs: d.fs, size: Math.round(d.size/1024/1024/1024), used: Math.round(d.used/1024/1024/1024), use: d.use })),
      os: { platform: os.platform, distro: os.distro, release: os.release, hostname: os.hostname },
      network: network.map(n=>({ iface: n.iface, rx: Math.round(n.rx_sec/1024), tx: Math.round(n.tx_sec/1024) }))
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Processes
app.get('/api/processes', async (req, res) => {
  try {
    const procs = await si.processes();
    const top = procs.list.sort((a,b)=>b.cpu-a.cpu).slice(0,15).map(p=>({ name: p.name, cpu: Math.round(p.cpu*10)/10, mem: Math.round(p.mem*10)/10, pid: p.pid }));
    res.json(top);
  } catch(e) { res.json([]); }
});

// App status update
app.post('/api/app-status', (req, res) => {
  const { app_name, status } = req.body;
  db.prepare("UPDATE app_usage SET status=? WHERE app_name=? AND date=?").run(status, app_name, today());
  res.json({ ok: true });
});

// Goals
app.get('/api/goals', (req, res) => {
  let goals = db.prepare("SELECT * FROM goals WHERE date=?").all(today());
  if (!goals.length) {
    const defaults = [
      { text: 'Work 8 productive hours', target: 8, unit: 'hrs' },
      { text: 'Productivity rate above 80%', target: 80, unit: '%' },
      { text: 'Complete 4 Pomodoros', target: 4, unit: 'sessions' },
      { text: 'Limit unproductive to 1h', target: 60, unit: 'min' },
    ];
    defaults.forEach(g => db.prepare("INSERT INTO goals (date,text,target_value,unit) VALUES (?,?,?,?)").run(today(), g.text, g.target, g.unit));
    goals = db.prepare("SELECT * FROM goals WHERE date=?").all(today());
  }
  res.json(goals);
});

app.post('/api/goals', (req, res) => {
  const { text, target_value, unit } = req.body;
  const id = db.prepare("INSERT INTO goals (date,text,target_value,unit) VALUES (?,?,?,?)").run(today(), text, target_value, unit).lastInsertRowid;
  res.json({ id });
});

app.put('/api/goals/:id', (req, res) => {
  const { done_value, completed } = req.body;
  db.prepare("UPDATE goals SET done_value=?, completed=? WHERE id=?").run(done_value, completed?1:0, req.params.id);
  res.json({ ok: true });
});

// Pomodoro
app.get('/api/pomodoro', (req, res) => {
  const sessions = db.prepare("SELECT * FROM pomodoro_log WHERE date(timestamp)=? ORDER BY id DESC LIMIT 20").all(today());
  res.json(sessions);
});

app.post('/api/pomodoro', (req, res) => {
  const { type, duration_minutes } = req.body;
  db.prepare("INSERT INTO pomodoro_log (type, duration_minutes) VALUES (?,?)").run(type, duration_minutes);
  res.json({ ok: true });
});

// ── Start server ───────────────────────────────────────────────────────────
const PORT = 7482;
server.listen(PORT, () => {
  console.log('\x1b[36m%s\x1b[0m', `
╔═══════════════════════════════════════╗
║        🖥  DeskTime Real — RUNNING     ║
╠═══════════════════════════════════════╣
║  Dashboard → http://localhost:${PORT}  ║
║  Press Ctrl+C to stop tracking        ║
╚═══════════════════════════════════════╝
  `);
  setTimeout(() => open(`http://localhost:${PORT}`).catch(()=>{}), 1500);
});
