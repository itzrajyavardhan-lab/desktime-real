'use strict';

// ── State ─────────────────────────────────────────────────────────────────
let ws, charts = {}, allApps = [], currentFilter = 'all', tracking = true;
let pomoRunning = false, pomoTimer = null, pomoSeconds = 25*60, pomoTotal = 25*60, pomoMode = 'focus', pomoCount = 0;
const LIVE_CPU = [], LIVE_MEM = [], LIVE_LABELS = [];
const MAX_LIVE = 30;

// ── Helpers ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2,'0');
function fmtSec(s){ const h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return h?`${h}h ${m}m`:`${m}m`; }
function fmtHm(s){ return `${pad(Math.floor(s/3600))}:${pad(Math.floor((s%3600)/60))}`; }

function toast(msg, dur=3000){
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), dur);
}

function updateClock(){
  const n = new Date();
  $('topbarDate').textContent = n.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'}) + ' · ' + n.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
setInterval(updateClock,1000); updateClock();

// ── Navigation ────────────────────────────────────────────────────────────
const PAGE_TITLES = { dashboard:'Dashboard', live:'Live Monitor', productivity:'Productivity', apps:'Apps & URLs', processes:'Processes', timeline:'Timeline', pomodoro:'Pomodoro', goals:'Daily Goals', system:'System Info' };
document.querySelectorAll('.nav-item').forEach(el=>{
  el.addEventListener('click',()=>{
    const page = el.dataset.page;
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    el.classList.add('active');
    $('page-'+page).classList.add('active');
    $('topbarTitle').textContent = PAGE_TITLES[page]||page;
    document.getElementById('sidebar').classList.remove('open');
    onPageLoad(page);
  });
});

$('menuToggle').addEventListener('click',()=>document.getElementById('sidebar').classList.toggle('open'));
$('refreshBtn').addEventListener('click',()=>{ loadTodayData(); loadProcesses(); toast('↻ Data refreshed'); });
$('trackBtn').addEventListener('click',()=>{
  tracking = !tracking;
  if(ws && ws.readyState===1) ws.send(JSON.stringify({type:'toggleTracking'}));
  $('trackBtn').textContent = tracking ? '⏸ Pause' : '▶ Resume';
  $('trackBtn').classList.toggle('paused',!tracking);
  toast(tracking ? 'Tracking resumed' : 'Tracking paused');
});

function onPageLoad(page){
  if(page==='productivity') loadProductivity();
  if(page==='apps') renderAppsTable();
  if(page==='processes') loadProcesses();
  if(page==='timeline') loadTimeline();
  if(page==='goals') loadGoals();
  if(page==='system') loadSystem();
  if(page==='pomodoro') loadPomoHistory();
}

// ── WebSocket ─────────────────────────────────────────────────────────────
function connectWS(){
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen = ()=>{ $('connDot').className='conn-dot connected'; $('connText').textContent='Connected'; };
  ws.onclose = ()=>{ $('connDot').className='conn-dot disconnected'; $('connText').textContent='Reconnecting...'; setTimeout(connectWS,3000); };
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if(msg.type==='system'||msg.type==='init') handleSystemData(msg.data||msg);
    if(msg.type==='init'&&msg.history) { msg.history.forEach(h=>pushLive(h.cpu,h.mem/(msg.data?.mem?.total||16)*100,h.t)); }
    if(msg.type==='trackingStatus') { tracking=msg.tracking; $('trackBtn').textContent=tracking?'⏸ Pause':'▶ Resume'; $('trackBtn').classList.toggle('paused',!tracking); }
  };
}
connectWS();

function handleSystemData(d){
  if(!d||!d.cpu) return;
  // Topbar active app
  if(d.activeApp) { $('activeAppName').textContent = d.activeApp.length>20 ? d.activeApp.substring(0,20)+'…' : d.activeApp; }
  // Push to live chart
  const t = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  pushLive(d.cpu, d.mem?.pct||0, t);
  // Update live stats
  updateLiveStats(d);
  // Update dashboard stats if on dashboard
  if($('page-dashboard').classList.contains('active')) updateDashStats();
}

function pushLive(cpu, memPct, label){
  LIVE_CPU.push(cpu); LIVE_MEM.push(memPct); LIVE_LABELS.push(label);
  if(LIVE_CPU.length>MAX_LIVE){ LIVE_CPU.shift(); LIVE_MEM.shift(); LIVE_LABELS.shift(); }
  if(charts.live) { charts.live.data.labels=[...LIVE_LABELS]; charts.live.data.datasets[0].data=[...LIVE_CPU]; charts.live.data.datasets[1].data=[...LIVE_MEM]; charts.live.update('none'); }
  if(charts.liveFull) { charts.liveFull.data.labels=[...LIVE_LABELS]; charts.liveFull.data.datasets[0].data=[...LIVE_CPU]; charts.liveFull.data.datasets[1].data=[...LIVE_MEM]; charts.liveFull.update('none'); }
}

function updateLiveStats(d){
  const grid = $('liveStatGrid');
  if(!grid) return;
  const battColor = d.battery?.pct>50?'green':d.battery?.pct>20?'amber':'red';
  grid.innerHTML = `
    <div class="stat-card"><div class="stat-label">CPU Load</div><div class="stat-value">${d.cpu||0}%</div><div class="stat-sub">${d.cpu>80?'High load':d.cpu>50?'Moderate':'Normal'}</div><div class="stat-icon">⚡</div></div>
    <div class="stat-card green"><div class="stat-label">RAM Usage</div><div class="stat-value">${d.mem?.used||0} GB</div><div class="stat-sub">${d.mem?.used||0} / ${d.mem?.total||0} GB (${d.mem?.pct||0}%)</div><div class="stat-icon">🧠</div></div>
    <div class="stat-card ${battColor}"><div class="stat-label">Battery</div><div class="stat-value">${d.battery?.pct||0}%</div><div class="stat-sub">${d.battery?.charging?'⚡ Charging':'🔋 Discharging'}</div><div class="stat-icon">🔋</div></div>
    <div class="stat-card"><div class="stat-label">Active App</div><div class="stat-value" style="font-size:16px">${(d.activeApp||'—').substring(0,14)}</div><div class="stat-sub">Currently in focus</div><div class="stat-icon">🖥</div></div>`;
  // Battery detail
  const bi = $('batteryInfo');
  if(bi){
    bi.innerHTML = `
      <div class="info-row"><span class="info-key">Charge Level</span><span class="info-val">${d.battery?.pct||0}%</span></div>
      <div class="battery-bar-wrap"><div class="battery-bar" style="width:${d.battery?.pct||0}%;background:${d.battery?.pct>50?'#22c55e':d.battery?.pct>20?'#f59e0b':'#ef4444'}"></div></div>
      <div class="info-row"><span class="info-key">Status</span><span class="info-val">${d.battery?.charging?'⚡ Charging':'Discharging'}</span></div>
      <div class="info-row"><span class="info-key">Time Left</span><span class="info-val">${d.battery?.timeRemaining>0?d.battery.timeRemaining+' min':'N/A'}</span></div>`;
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────
async function loadTodayData(){
  try {
    const r = await fetch('/api/today'); const d = await r.json();
    allApps = d.apps||[];
    document.getElementById('appCountBadge').textContent = allApps.length;
    updateDashStats(d);
    renderTopApps(allApps.slice(0,8));
    buildAppPieChart(allApps.slice(0,6));
    $('todayTotal').textContent = `Total tracked: ${fmtSec(d.totalSec||0)}`;
  } catch(e){}
}

function updateDashStats(d){
  if(!d) { loadTodayData(); return; }
  const elapsed = Math.round((Date.now()-new Date().setHours(9,0,0,0))/1000);
  $('statGrid').innerHTML = `
    <div class="stat-card"><div class="stat-label">Total Time Today</div><div class="stat-value">${fmtHm(d.totalSec||0)}</div><div class="stat-sub">Since session start</div><div class="stat-icon">⏱</div></div>
    <div class="stat-card green"><div class="stat-label">Productive Time</div><div class="stat-value">${fmtHm(d.prodSec||0)}</div><div class="stat-sub">${d.totalSec?Math.round(d.prodSec/d.totalSec*100):0}% of total</div><div class="stat-icon">📈</div></div>
    <div class="stat-card amber"><div class="stat-label">Neutral Time</div><div class="stat-value">${fmtHm(d.neutralSec||0)}</div><div class="stat-sub">${d.totalSec?Math.round(d.neutralSec/d.totalSec*100):0}% of total</div><div class="stat-icon">☕</div></div>
    <div class="stat-card red"><div class="stat-label">Unproductive</div><div class="stat-value">${fmtHm(d.unprodSec||0)}</div><div class="stat-sub">${d.totalSec?Math.round(d.unprodSec/d.totalSec*100):0}% of total</div><div class="stat-icon">⚠</div></div>`;
}

function renderTopApps(apps){
  if(!apps.length){ $('dashAppsTable').innerHTML=`<tr><td colspan="4" style="padding:20px;color:var(--text-2);text-align:center">Keep using your laptop — data will appear here.</td></tr>`; return; }
  const max = apps[0]?.total||1;
  $('dashAppsTable').innerHTML = `<tr><th>Application</th><th>Category</th><th>Time Tracked</th><th>Status</th></tr>` +
    apps.map(a=>`<tr>
      <td><span class="app-icon" style="background:${statusColor(a.status)}20;color:${statusColor(a.status)}">●</span>${a.app_name}</td>
      <td style="color:var(--text-2);font-size:12px">${a.category||'System'}</td>
      <td><div class="bar-cell"><div class="mini-bar-wrap"><div class="mini-bar" style="width:${Math.round(a.total/max*100)}%;background:${statusColor(a.status)}"></div></div><span style="font-size:11px;color:var(--text-2);font-family:var(--mono);min-width:40px">${fmtSec(a.total)}</span></div></td>
      <td><span class="prod-badge ${a.status==='productive'?'p':a.status==='unproductive'?'u':'n'}">${a.status||'neutral'}</span></td>
    </tr>`).join('');
}

function statusColor(s){ return s==='productive'?'#22c55e':s==='unproductive'?'#ef4444':'#f59e0b'; }

// ── Charts ────────────────────────────────────────────────────────────────
function buildLiveChart(){
  if(charts.live) charts.live.destroy();
  const ctx = $('liveChart').getContext('2d');
  charts.live = new Chart(ctx,{type:'line',data:{labels:[...LIVE_LABELS],datasets:[
    {label:'CPU %',data:[...LIVE_CPU],borderColor:'#0ea5e9',backgroundColor:'rgba(14,165,233,.1)',fill:true,tension:.4,pointRadius:0,borderWidth:1.5},
    {label:'RAM %',data:[...LIVE_MEM],borderColor:'#22c55e',backgroundColor:'rgba(34,197,94,.1)',fill:true,tension:.4,pointRadius:0,borderWidth:1.5},
  ]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false}},scales:{x:{display:false},y:{min:0,max:100,grid:{color:'#e0f2fe'},ticks:{callback:v=>v+'%',font:{size:9}}}}}});
}

function buildLiveFullChart(){
  if(charts.liveFull) charts.liveFull.destroy();
  const ctx = $('liveFullChart').getContext('2d');
  charts.liveFull = new Chart(ctx,{type:'line',data:{labels:[...LIVE_LABELS],datasets:[
    {label:'CPU %',data:[...LIVE_CPU],borderColor:'#0ea5e9',backgroundColor:'rgba(14,165,233,.08)',fill:true,tension:.4,pointRadius:2,pointBackgroundColor:'#fff',pointBorderColor:'#0ea5e9',pointBorderWidth:1.5,borderWidth:2},
    {label:'RAM %',data:[...LIVE_MEM],borderColor:'#22c55e',backgroundColor:'rgba(34,197,94,.08)',fill:true,tension:.4,pointRadius:2,pointBackgroundColor:'#fff',pointBorderColor:'#22c55e',pointBorderWidth:1.5,borderWidth:2},
  ]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{font:{size:9},maxTicksLimit:8}},y:{min:0,max:100,grid:{color:'#e0f2fe'},ticks:{callback:v=>v+'%',font:{size:10}}}}}});
}

function buildAppPieChart(apps){
  if(!apps.length) return;
  if(charts.appPie) charts.appPie.destroy();
  const colors = ['#0ea5e9','#22c55e','#f59e0b','#8b5cf6','#e879f9','#ef4444','#38bdf8','#34d399'];
  const ctx = $('appPieChart').getContext('2d');
  charts.appPie = new Chart(ctx,{type:'doughnut',data:{labels:apps.map(a=>a.app_name),datasets:[{data:apps.map(a=>a.total),backgroundColor:colors,borderWidth:0,hoverOffset:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{font:{size:10},boxWidth:10,padding:6}}},cutout:'60%'}});
}

async function loadProductivity(){
  const [hr, wk] = await Promise.all([fetch('/api/hourly').then(r=>r.json()), fetch('/api/weekly').then(r=>r.json())]).catch(()=>[{},{}]);
  buildHourlyChart(hr||{});
  buildWeeklyChart(wk||{});
  buildStatusPieChart();
}

function buildHourlyChart(hours){
  if(charts.hourly) charts.hourly.destroy();
  const labels=[]; const prod=[]; const unprod=[]; const neutral=[];
  for(let h=8;h<=21;h++){ labels.push(`${pad(h)}:00`); const d=hours[h]||{}; prod.push(Math.round((d.productive||0)/60)); unprod.push(Math.round((d.unproductive||0)/60)); neutral.push(Math.round((d.neutral||0)/60)); }
  const ctx=$('hourlyChart').getContext('2d');
  charts.hourly=new Chart(ctx,{type:'bar',data:{labels,datasets:[
    {label:'Productive',data:prod,backgroundColor:'#22c55e',borderRadius:4,barPercentage:.7,stack:'s'},
    {label:'Neutral',data:neutral,backgroundColor:'#f59e0b',borderRadius:4,barPercentage:.7,stack:'s'},
    {label:'Unproductive',data:unprod,backgroundColor:'#ef4444',borderRadius:4,barPercentage:.7,stack:'s'},
  ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{stacked:true,grid:{display:false},ticks:{font:{size:9},maxRotation:0}},y:{stacked:true,grid:{color:'#e0f2fe'},ticks:{callback:v=>v+'m',font:{size:9}}}}}});
}

function buildWeeklyChart(byDate){
  if(charts.weekly) charts.weekly.destroy();
  const entries=Object.entries(byDate).sort((a,b)=>a[0].localeCompare(b[0]));
  const labels=entries.map(([d])=>{const dt=new Date(d);return['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()];});
  const prod=entries.map(([,v])=>Math.round((v.productive||0)/3600*10)/10);
  const unprod=entries.map(([,v])=>Math.round((v.unproductive||0)/3600*10)/10);
  const ctx=$('weeklyChart').getContext('2d');
  charts.weekly=new Chart(ctx,{type:'bar',data:{labels:labels.length?labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],datasets:[
    {label:'Productive',data:prod.length?prod:[0,0,0,0,0,0,0],backgroundColor:'#0ea5e9',borderRadius:4,barPercentage:.7},
    {label:'Unproductive',data:unprod.length?unprod:[0,0,0,0,0,0,0],backgroundColor:'#ef4444',borderRadius:4,barPercentage:.7},
  ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{font:{size:10}}},y:{grid:{color:'#e0f2fe'},ticks:{callback:v=>v+'h',font:{size:10}}}}}});
}

async function buildStatusPieChart(){
  try{
    const d=await fetch('/api/today').then(r=>r.json());
    if(charts.statusPie) charts.statusPie.destroy();
    const ctx=$('statusPieChart').getContext('2d');
    charts.statusPie=new Chart(ctx,{type:'doughnut',data:{labels:['Productive','Neutral','Unproductive'],datasets:[{data:[d.prodSec||1,d.neutralSec||1,d.unprodSec||1],backgroundColor:['#22c55e','#f59e0b','#ef4444'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'55%',plugins:{legend:{position:'bottom',labels:{font:{size:11},boxWidth:10,padding:8}}}}});
  }catch{}
}

// ── Apps Table ────────────────────────────────────────────────────────────
function renderAppsTable(){
  const filtered = currentFilter==='all' ? allApps : allApps.filter(a=>a.status===currentFilter);
  const max = filtered[0]?.total||1;
  $('appsFullTable').innerHTML = `<tr><th>Application</th><th>Category</th><th>Time</th><th>Usage Bar</th><th>Status</th></tr>` +
    (filtered.length ? filtered.map(a=>`<tr>
      <td><span class="app-icon" style="background:${statusColor(a.status)}20;color:${statusColor(a.status)}">●</span>${a.app_name}</td>
      <td style="color:var(--text-2);font-size:12px">${a.category||'System'}</td>
      <td style="font-family:var(--mono);font-size:12px">${fmtSec(a.total)}</td>
      <td><div class="bar-cell"><div class="mini-bar-wrap"><div class="mini-bar" style="width:${Math.round(a.total/max*100)}%;background:${statusColor(a.status)}"></div></div><span style="font-size:11px;color:var(--text-2)">${Math.round(a.total/max*100)}%</span></div></td>
      <td><select onchange="updateAppStatus('${a.app_name}',this.value)" style="font-size:11px;padding:3px 6px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text-1);font-family:var(--font);cursor:pointer">
        <option value="productive" ${a.status==='productive'?'selected':''}>Productive</option>
        <option value="neutral" ${a.status==='neutral'?'selected':''}>Neutral</option>
        <option value="unproductive" ${a.status==='unproductive'?'selected':''}>Unproductive</option>
      </select></td>
    </tr>`).join('') : `<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--text-2)">No apps tracked yet. Use your laptop normally!</td></tr>`);
}

document.getElementById('appsTabs').addEventListener('click',e=>{
  const tab = e.target.closest('.tab'); if(!tab) return;
  document.querySelectorAll('#appsTabs .tab').forEach(t=>t.classList.remove('active'));
  tab.classList.add('active');
  currentFilter = tab.dataset.filter;
  renderAppsTable();
});

async function updateAppStatus(name, status){
  await fetch('/api/app-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({app_name:name,status})}).catch(()=>{});
  const a = allApps.find(x=>x.app_name===name); if(a) a.status=status;
  toast(`${name} → ${status}`);
}

// ── Processes ─────────────────────────────────────────────────────────────
async function loadProcesses(){
  try{
    const procs = await fetch('/api/processes').then(r=>r.json());
    $('processTable').innerHTML = `<tr><th>Process</th><th>PID</th><th>CPU %</th><th>Memory %</th><th>CPU Bar</th></tr>` +
      procs.map((p,i)=>`<tr>
        <td style="font-weight:${i<3?500:400}">${p.name}</td>
        <td style="font-family:var(--mono);font-size:11px;color:var(--text-2)">${p.pid}</td>
        <td style="font-family:var(--mono);color:${p.cpu>20?'#ef4444':p.cpu>10?'#f59e0b':'var(--text-1)'}">${p.cpu.toFixed(1)}%</td>
        <td style="font-family:var(--mono);color:var(--text-2)">${p.mem.toFixed(1)}%</td>
        <td><div class="bar-cell"><div class="mini-bar-wrap"><div class="mini-bar" style="width:${Math.min(p.cpu*2,100)}%;background:${p.cpu>20?'#ef4444':p.cpu>10?'#f59e0b':'#0ea5e9'}"></div></div></div></td>
      </tr>`).join('');
  }catch{}
}

// ── Timeline ──────────────────────────────────────────────────────────────
async function loadTimeline(){
  try{
    const d = await fetch('/api/today').then(r=>r.json());
    // Sessions
    const sessions = d.sessions||[];
    $('sessionList').innerHTML = sessions.length ? sessions.map(s=>`
      <div class="session-row">
        <div class="session-time">${s.start_time} – ${s.end_time||'ongoing'}</div>
        <div class="session-dur">${fmtSec(s.duration_seconds||0)}</div>
        <div class="session-bar-wrap"><div class="session-bar" style="width:${Math.min((s.duration_seconds||0)/28800*100,100)}%;background:linear-gradient(90deg,#0ea5e9,#0369a1)"></div></div>
        <span class="prod-badge p">Work</span>
      </div>`).join('') : '<div style="padding:20px;color:var(--text-2);font-size:13px">Sessions will appear here as you work.</div>';

    // App timeline
    const apps = d.apps||[];
    const colors=['#0ea5e9','#22c55e','#f59e0b','#8b5cf6','#e879f9','#ef4444'];
    const total = apps.reduce((a,b)=>a+b.total,0)||1;
    $('appTimeline').innerHTML = apps.slice(0,12).map((a,i)=>`
      <div class="tblock ${a.status||'neutral'}" style="flex:${a.total};background:${colors[i%colors.length]};border-radius:4px" title="${a.app_name}: ${fmtSec(a.total)}"></div>`).join('');
  }catch{}
}

// ── System ────────────────────────────────────────────────────────────────
async function loadSystem(){
  try{
    const d = await fetch('/api/system').then(r=>r.json());
    $('sysStatGrid').innerHTML = `
      <div class="stat-card"><div class="stat-label">CPU</div><div class="stat-value">${d.cpu?.load||0}%</div><div class="stat-sub">${d.cpu?.model||'N/A'}</div><div class="stat-icon">⚡</div></div>
      <div class="stat-card green"><div class="stat-label">RAM Used</div><div class="stat-value">${d.mem?.used||0} GB</div><div class="stat-sub">${d.mem?.total||0} GB total (${d.mem?.pct||0}%)</div><div class="stat-icon">🧠</div></div>
      <div class="stat-card amber"><div class="stat-label">Battery</div><div class="stat-value">${d.battery?.pct||0}%</div><div class="stat-sub">${d.battery?.charging?'Charging':'Discharging'}</div><div class="stat-icon">🔋</div></div>
      <div class="stat-card purple"><div class="stat-label">CPU Cores</div><div class="stat-value">${d.cpu?.cores||0}</div><div class="stat-sub">${d.os?.platform||''} ${d.os?.release||''}</div><div class="stat-icon">🔧</div></div>`;

    // Disk
    $('diskInfo').innerHTML = (d.disk||[]).map(disk=>`
      <div class="disk-item">
        <div class="disk-label"><span>${disk.fs}</span><span>${disk.used}/${disk.size} GB (${Math.round(disk.use||0)}%)</span></div>
        <div class="disk-bar-wrap"><div class="disk-bar" style="width:${Math.round(disk.use||0)}%"></div></div>
      </div>`).join('')||'<div style="color:var(--text-2);font-size:13px">No disk data</div>';

    // OS
    $('osInfo').innerHTML = `
      <div class="info-row"><span class="info-key">Hostname</span><span class="info-val">${d.os?.hostname||'N/A'}</span></div>
      <div class="info-row"><span class="info-key">Platform</span><span class="info-val">${d.os?.platform||'N/A'}</span></div>
      <div class="info-row"><span class="info-key">OS</span><span class="info-val">${d.os?.distro||d.os?.platform||'N/A'}</span></div>
      <div class="info-row"><span class="info-key">Release</span><span class="info-val">${d.os?.release||'N/A'}</span></div>
      <div class="info-row"><span class="info-key">CPU Model</span><span class="info-val" style="font-size:11px">${(d.cpu?.model||'N/A').substring(0,24)}</span></div>
      <div class="info-row"><span class="info-key">Network RX</span><span class="info-val">${(d.network?.[0]?.rx||0)} KB/s</span></div>`;

    // Set hostname in sidebar
    if(d.os?.hostname) $('hostnameLabel').textContent = d.os.hostname;
  }catch{}
}

// ── Network ───────────────────────────────────────────────────────────────
async function updateNetworkInfo(){
  try{
    const d = await fetch('/api/system').then(r=>r.json());
    const ni = $('networkInfo');
    if(!ni) return;
    ni.innerHTML = (d.network||[]).filter(n=>n.rx||n.tx).slice(0,3).map(n=>`
      <div class="info-row"><span class="info-key">${n.iface}</span><span class="info-val">↓${n.rx} ↑${n.tx} KB/s</span></div>`).join('')||'<div style="color:var(--text-2);font-size:13px">No network data</div>';
  }catch{}
}
setInterval(()=>{ if($('page-live').classList.contains('active')) updateNetworkInfo(); },10000);

// ── Pomodoro ──────────────────────────────────────────────────────────────
const POMO_DURATIONS = { focus:25*60, short:5*60, long:15*60 };
const POMO_LABELS = { focus:'Focus Time', short:'Short Break', long:'Long Break' };

function setMode(mode, btn){
  pomoMode=mode; clearInterval(pomoTimer); pomoRunning=false;
  pomoSeconds=pomoTotal=POMO_DURATIONS[mode];
  $('pomoDisplay').textContent=`${pad(Math.floor(pomoSeconds/60))}:${pad(pomoSeconds%60)}`;
  $('pomoLabel').textContent=POMO_LABELS[mode];
  $('pomoDash').style.strokeDashoffset='0';
  $('pomoBtn').textContent='▶ Start';
  document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
}

function togglePomo(){
  if(pomoRunning){
    clearInterval(pomoTimer); pomoRunning=false; $('pomoBtn').textContent='▶ Resume';
  } else {
    pomoRunning=true; $('pomoBtn').textContent='⏸ Pause';
    pomoTimer=setInterval(()=>{
      pomoSeconds--;
      const pct=pomoSeconds/pomoTotal;
      $('pomoDash').style.strokeDashoffset=String(427.26*(1-pct));
      $('pomoDisplay').textContent=`${pad(Math.floor(pomoSeconds/60))}:${pad(pomoSeconds%60)}`;
      if(pomoSeconds<=0){
        clearInterval(pomoTimer); pomoRunning=false;
        if(pomoMode==='focus'){ pomoCount++; $('pomoCount').textContent=pomoCount; }
        fetch('/api/pomodoro',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:pomoMode,duration_minutes:Math.round(pomoTotal/60)})}).catch(()=>{});
        toast(pomoMode==='focus'?'🎉 Focus session done! Take a break.':'☕ Break over — back to work!');
        loadPomoHistory();
        setMode(pomoMode, document.getElementById('m'+pomoMode.charAt(0).toUpperCase()+pomoMode.slice(1)));
      }
    },1000);
  }
}

function resetPomo(){ clearInterval(pomoTimer); pomoRunning=false; setMode(pomoMode, document.getElementById('m'+pomoMode.charAt(0).toUpperCase()+pomoMode.slice(1))); }

async function loadPomoHistory(){
  try{
    const sessions=await fetch('/api/pomodoro').then(r=>r.json());
    const focusDone=sessions.filter(s=>s.type==='focus').length;
    $('pomoCount').textContent=focusDone;
    $('pomoHistoryList').innerHTML=sessions.length?sessions.map((s,i)=>`
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--sky-50)">
        <div style="width:28px;height:28px;border-radius:50%;background:${s.type==='focus'?'var(--sky-100)':'#dcfce7'};display:flex;align-items:center;justify-content:center;font-size:12px">${s.type==='focus'?'🎯':'☕'}</div>
        <div style="flex:1"><div style="font-size:12px;font-weight:500;color:var(--text-1)">${s.type==='focus'?'Focus':'Break'} · ${s.duration_minutes}m</div><div style="font-size:11px;color:var(--text-2)">${new Date(s.timestamp).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</div></div>
        <span class="prod-badge ${s.type==='focus'?'p':'n'}">${s.duration_minutes}m</span>
      </div>`).join(''):`<div style="padding:32px;text-align:center;color:var(--text-2);font-size:13px">No sessions yet. Start your first Pomodoro!</div>`;
  }catch{}
}

// ── Goals ─────────────────────────────────────────────────────────────────
let goalsData = [];

async function loadGoals(){
  try{
    goalsData = await fetch('/api/goals').then(r=>r.json());
    // Auto-update done values from today's data
    const td = await fetch('/api/today').then(r=>r.json());
    const prodH = td.prodSec/3600;
    const prodPct = td.totalSec?Math.round(td.prodSec/td.totalSec*100):0;
    const unprodMin = Math.round(td.unprodSec/60);
    goalsData.forEach(g=>{
      if(g.text.toLowerCase().includes('productive hour')) g.done_value=Math.round(prodH*10)/10;
      if(g.text.toLowerCase().includes('productivity rate')) g.done_value=prodPct;
      if(g.text.toLowerCase().includes('unproductive')) g.done_value=unprodMin;
    });
    renderGoals();
    buildGoalsChart();
  }catch{}
}

function renderGoals(){
  $('goalsList').innerHTML=goalsData.map(g=>`
    <div style="padding:14px 0;border-bottom:1px solid var(--sky-50)">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
        <input type="checkbox" ${g.completed?'checked':''} onchange="toggleGoalCheck(${g.id},this)" style="width:16px;height:16px;accent-color:var(--sky-500);cursor:pointer"/>
        <span style="font-size:13px;font-weight:500;color:var(--text-1);flex:1">${g.text}</span>
        <span style="font-size:12px;font-family:var(--mono);color:var(--sky-600)">${g.done_value||0}${g.unit} / ${g.target_value}${g.unit}</span>
      </div>
      <div style="height:8px;background:var(--sky-100);border-radius:4px;overflow:hidden;margin-left:28px">
        <div style="height:100%;background:${(g.done_value||0)>=g.target_value?'#22c55e':'var(--sky-500)'};width:${Math.min(((g.done_value||0)/g.target_value)*100,100).toFixed(0)}%;border-radius:4px;transition:width .8s ease"></div>
      </div>
    </div>`).join('')||'<div style="padding:20px;color:var(--text-2)">No goals yet.</div>';
}

async function toggleGoalCheck(id,el){
  await fetch(`/api/goals/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({done_value:el.checked?goalsData.find(g=>g.id===id)?.target_value:0,completed:el.checked?1:0})}).catch(()=>{});
  toast(el.checked?'Goal achieved! 🎉':'Goal reset');
  loadGoals();
}

function buildGoalsChart(){
  if(charts.goals) charts.goals.destroy();
  const ctx=$('goalsRadar').getContext('2d');
  charts.goals=new Chart(ctx,{type:'radar',data:{
    labels:goalsData.map(g=>g.text.substring(0,22)),
    datasets:[{label:'Progress %',data:goalsData.map(g=>Math.min(((g.done_value||0)/g.target_value)*100,100)),backgroundColor:'rgba(14,165,233,.15)',borderColor:'#0ea5e9',pointBackgroundColor:'#0ea5e9',pointRadius:4}]
  },options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{r:{min:0,max:100,ticks:{stepSize:25,font:{size:9}},pointLabels:{font:{size:10}}}}}});
}

function showAddGoal(){ $('modalOverlay').style.display='flex'; }
function closeModal(){ $('modalOverlay').style.display='none'; }
async function submitGoal(){
  const text=$('goalText').value.trim(),target=parseFloat($('goalTarget').value)||8,unit=$('goalUnit').value||'h';
  if(!text){toast('Please enter a goal description');return;}
  await fetch('/api/goals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,target_value:target,unit})}).catch(()=>{});
  closeModal();$('goalText').value='';$('goalTarget').value='';$('goalUnit').value='';
  toast('Goal added!');loadGoals();
}

// ── Init ──────────────────────────────────────────────────────────────────
buildLiveChart();
buildLiveFullChart();
loadTodayData();
loadSystem();

// Refresh today data every 30s
setInterval(()=>{
  loadTodayData();
  if($('page-processes').classList.contains('active')) loadProcesses();
}, 30000);
