# DeskTime Real 🖥️
**Real-time laptop activity tracker — Light Blue Theme**

Tracks your actual CPU, RAM, battery, active apps, and productivity — all from your own laptop.

---

## 🚀 Quick Setup (3 steps)

### Step 1 — Install Node.js
If not installed: https://nodejs.org (download LTS version)

### Step 2 — Install dependencies
Open a terminal in this folder and run:
```bash
npm install
```

### Step 3 — Start the app
```bash
npm start
```

The dashboard will **automatically open** at: http://localhost:7482

---

## ✅ What it tracks (REAL data from YOUR laptop)

| Feature | What it reads |
|---------|--------------|
| **CPU Usage** | Real % load via `systeminformation` |
| **RAM Usage** | Actual used/total GB |
| **Battery** | Real % + charging status + time remaining |
| **Active App** | Currently focused window (foreground process) |
| **App Usage Time** | How long each app was in focus today |
| **Running Processes** | Top 15 by CPU — live from your system |
| **Disk Usage** | All drives with used/total GB |
| **Network I/O** | Live KB/s per interface |
| **OS Info** | Hostname, platform, release, CPU model |

---

## 📊 Dashboard Pages

- **Dashboard** — Today's overview with live CPU/RAM chart + top apps
- **Live Monitor** — Real-time system graphs, battery, network
- **Productivity** — Hourly breakdown + 7-day weekly trend
- **Apps & URLs** — Full list of tracked apps, mark productive/unproductive
- **Processes** — Live process list sorted by CPU
- **Timeline** — Work session log + app switch timeline
- **Pomodoro** — 25/5/15 min timer, logs sessions to DB
- **Daily Goals** — Auto-updated from real tracked data
- **System Info** — Full hardware + OS details

---

## 🗄️ Data Storage

All data is saved to `data/desktime.db` (SQLite) — persists across restarts.

---

## ⚙️ Notes

- **Windows**: Active window detection uses PowerShell (no extra install needed)
- **macOS**: May need Accessibility permissions → System Preferences → Privacy → Accessibility
- **Linux**: Requires `xdotool` → `sudo apt install xdotool`

---

## 🛑 Stop tracking
Press `Ctrl+C` in the terminal, or click the **Pause** button in the dashboard.

---

Made with ❤️ — Light Blue DeskTime Clone
