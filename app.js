// ─── State ────────────────────────────────────────────────────────────────────
let sessions    = JSON.parse(localStorage.getItem('brt_sessions')      || '[]');
let customTypes = JSON.parse(localStorage.getItem('brt_custom_types')  || '[]');
let limits      = JSON.parse(localStorage.getItem('brt_limits')        || '{}');

let chartMode     = 'line';
let chartInstance = null;
const insightCharts = {};

let editingId     = null;
let filterType    = 'All';
let sortMode      = 'newest';
let currentPage   = 1;
let activePeriod  = 'all';
let activeTab     = 'dashboard';

// Multi-select
let selectedIds   = new Set();

// Live session
let liveState = JSON.parse(localStorage.getItem('brt_live') || 'null');
let liveTimer = null;
let liveAITimer = null;

// Timestamp modal
let timestampEditId = null;

// AI chat history
let aiChatHistory = [];
let aiPanelOpen   = false;

const PAGE_SIZE = 10;
const BUILT_IN_TYPES = ['Casino', 'Sportsbook', 'Poker', 'Online'];
const BUILT_IN_ICONS = { Casino:'🎰', Sportsbook:'🏆', Poker:'🃏', Online:'💻' };
const DOW_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function getAllTypes()      { return [...BUILT_IN_TYPES, ...customTypes]; }
function getTypeIcon(type) { return BUILT_IN_ICONS[type] || '🏷️'; }

// ─── Init ─────────────────────────────────────────────────────────────────────
const now = new Date();
const dateStr = now.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
const dlEl = document.getElementById('dateLabel');
const sdEl = document.getElementById('sidebarDate');
if (dlEl) dlEl.textContent = dateStr;
if (sdEl) sdEl.textContent = dateStr;

// Live session restore
if (liveState) {
  showLiveIndicator(true);
  if (activeTab === 'live') restoreLiveUI();
}

// Scroll-aware floating select bar
window.addEventListener('scroll', updateFloatingBarVisibility, {passive:true});

render();

// ─── Storage ──────────────────────────────────────────────────────────────────
function save()            { localStorage.setItem('brt_sessions',    JSON.stringify(sessions)); }
function saveCustomTypes() { localStorage.setItem('brt_custom_types',JSON.stringify(customTypes)); }
function saveLimits() {
  limits = {
    bankroll:    parseNum('limBankroll'),
    daily:       parseNum('limDaily'),
    weekly:      parseNum('limWeekly'),
    monthly:     parseNum('limMonthly'),
    sessLoss:    parseNum('limSession'),
    sessTarget:  parseNum('limSessTarget'),
    monthTarget: parseNum('limMonthTarget')
  };
  localStorage.setItem('brt_limits', JSON.stringify(limits));
  const saved = document.getElementById('limitsSaved');
  saved.style.display = 'block';
  setTimeout(() => { saved.style.display = 'none'; }, 2000);
  renderDashboard();
}
function parseNum(id) {
  const v = parseFloat(document.getElementById(id).value);
  return isNaN(v) ? 0 : v;
}

// ─── Formatting ───────────────────────────────────────────────────────────────
function fmt(n, sign=false) {
  const abs = '$' + Math.abs(n).toFixed(2);
  if (sign) return (n >= 0 ? '+' : '-') + abs;
  return (n < 0 ? '-' : '') + abs;
}
function formatDuration(mins) {
  if (!mins || mins <= 0) return null;
  const h = Math.floor(mins/60), m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
function fmtDatetime(ts) {
  return new Date(ts).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function toDatetimeLocal(ts) {
  const d = new Date(ts), pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function sessionTimestamp(s) { return s.timestamp || s.id; }

// ─── Live indicator helper ─────────────────────────────────────────────────────
function showLiveIndicator(on) {
  const li = document.getElementById('liveIndicator');
  const sd = document.getElementById('snavLiveDot');
  const md = document.getElementById('mnavLiveDot');
  if (li) li.style.display = on ? 'flex' : 'none';
  if (sd) sd.style.display = on ? 'inline-block' : 'none';
  if (md) md.style.display = on ? 'inline-block' : 'none';
}

// ─── Tab switching ────────────────────────────────────────────────────────────
function switchTab(tab, btn) {
  document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.snav-btn, .mnav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  // highlight correct buttons in both navs
  document.querySelectorAll(`[data-tab="${tab}"]`).forEach(b => b.classList.add('active'));

  activeTab = tab;
  if (tab === 'session')  { renderSessionForm(); checkAutofill(); }
  if (tab === 'insights') renderInsights();
  if (tab === 'limits')   renderLimitsPage();
  if (tab === 'history')  { renderFilters(); renderSessionList(); }
  if (tab === 'live')     { syncLiveDropdowns(); if (liveState) restoreLiveUI(); }
}

// ─── Period filtering ─────────────────────────────────────────────────────────
function setPeriod(p, btn) {
  activePeriod = p;
  document.querySelectorAll('.period-pill').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderDashboard();
}
function getSessionsForPeriod() {
  if (activePeriod === 'all') return sessions;
  const now = new Date();
  return sessions.filter(s => {
    const d = new Date(sessionTimestamp(s));
    if (activePeriod === 'month') return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();
    if (activePeriod === 'week') {
      const start = new Date(now); start.setDate(now.getDate()-now.getDay()); start.setHours(0,0,0,0);
      return d >= start;
    }
    return true;
  });
}

// ─── Compliance ───────────────────────────────────────────────────────────────
function getCompliance(s) {
  const hasLoss = s.sessLossLimit > 0, hasTarget = s.sessCashTarget > 0;
  if (!hasLoss && !hasTarget) return null;
  if (hasTarget && s.profit >= s.sessCashTarget) return 'target';
  if (hasLoss   && s.profit < -(s.sessLossLimit)) return 'breach';
  return 'ok';
}

// ─── Custom Types ─────────────────────────────────────────────────────────────
function handleTypeSelect() {
  const val = document.getElementById('sessType').value;
  document.getElementById('customTypeRow').style.display = val === '__new__' ? 'flex' : 'none';
  if (val === '__new__') document.getElementById('customTypeName').focus();
}
function confirmNewType() {
  const input = document.getElementById('customTypeName'), name = input.value.trim();
  if (!name) return;
  if (getAllTypes().map(t=>t.toLowerCase()).includes(name.toLowerCase())) { alert('That type already exists.'); return; }
  customTypes.push(name); saveCustomTypes(); input.value = '';
  document.getElementById('customTypeRow').style.display = 'none';
  rebuildTypeDropdown(); document.getElementById('sessType').value = name; render();
}
function cancelNewType() {
  document.getElementById('customTypeName').value = '';
  document.getElementById('customTypeRow').style.display = 'none';
  document.getElementById('sessType').value = getAllTypes()[0] || BUILT_IN_TYPES[0];
}
function deleteCustomType(type) {
  if (sessions.some(s => s.type === type)) { alert(`Cannot delete "${type}" — it's used by existing sessions.`); return; }
  customTypes = customTypes.filter(t => t !== type); saveCustomTypes();
  if (filterType === type) filterType = 'All';
  rebuildTypeDropdown(); render();
}
function rebuildTypeDropdown(selectId='sessType') {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '';
  BUILT_IN_TYPES.forEach(t => { const o=document.createElement('option'); o.value=t; o.textContent=getTypeIcon(t)+'  '+t; sel.appendChild(o); });
  if (customTypes.length) {
    const sep=document.createElement('option'); sep.disabled=true; sep.textContent='── Custom ──'; sel.appendChild(sep);
    customTypes.forEach(t => { const o=document.createElement('option'); o.value=t; o.textContent='🏷️  '+t; sel.appendChild(o); });
  }
  if (selectId === 'sessType') {
    const sep2=document.createElement('option'); sep2.disabled=true; sep2.textContent='──────────'; sel.appendChild(sep2);
    const nw=document.createElement('option'); nw.value='__new__'; nw.textContent='＋ New type…'; sel.appendChild(nw);
  }
  sel.value = getAllTypes().includes(current) ? current : getAllTypes()[0];
}

// ─── Autofill (last session end → new session start) ─────────────────────────
let autofillValue = null;
function checkAutofill() {
  if (editingId !== null) { document.getElementById('autofillBanner').style.display='none'; return; }
  if (!sessions.length)   { document.getElementById('autofillBanner').style.display='none'; return; }
  const last = [...sessions].sort((a,b)=>sessionTimestamp(b)-sessionTimestamp(a))[0];
  autofillValue = last.end;
  document.getElementById('autofillText').textContent = `Last session ended at $${last.end.toFixed(2)} — use as starting balance?`;
  document.getElementById('autofillBanner').style.display = 'flex';
}
function applyAutofill() {
  if (autofillValue !== null) document.getElementById('start').value = autofillValue.toFixed(2);
  document.getElementById('autofillBanner').style.display = 'none';
}
function dismissAutofill() { document.getElementById('autofillBanner').style.display='none'; autofillValue=null; }

// ─── Warnings & Tips ──────────────────────────────────────────────────────────
function getWarningsAndTips() {
  const warnings=[], tips=[];
  if (!sessions.length) return { warnings, tips };
  const stats = getStats(sessions);
  if (limits.daily > 0) {
    const dayLoss = -getPeriodLosses('daily');
    if (dayLoss >= limits.daily) warnings.push(`🚨 Daily loss limit hit — you've lost ${fmt(dayLoss)} today. Stop for today.`);
    else if (dayLoss >= limits.daily * 0.75) warnings.push(`⚠️ Approaching daily limit — ${fmt(dayLoss)} of ${fmt(limits.daily)} used.`);
  }
  if (limits.weekly > 0) {
    const weekLoss = -getPeriodLosses('weekly');
    if (weekLoss >= limits.weekly) warnings.push(`🚨 Weekly loss limit hit — you've lost ${fmt(weekLoss)} this week.`);
  }
  if (stats.streak >= 3 && stats.streakDir === 'L')
    warnings.push(`⚠️ ${stats.streak}-session losing streak. Consider a break before your next session.`);
  if (sessions.length >= 10) {
    const recent5 = sessions.slice(-5).reduce((s,x)=>s+x.profit,0)/5;
    if (recent5 < stats.avg * 0.7 && stats.avg !== 0)
      tips.push(`💡 Your last 5 sessions averaged ${fmt(recent5,true)}, below your overall avg of ${fmt(stats.avg,true)}. Your recent play may be off.`);
  }
  const disc = getDisciplineStats();
  if (disc && disc.rate < 60 && disc.total >= 5)
    tips.push(`💡 Discipline rate ${disc.rate}% — you often exceed your own limits. Try setting them lower and sticking to them.`);
  return { warnings, tips };
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function getStats(ss) {
  let totalProfit=0, wins=0, losses=0, bigWin=0, bigLoss=0, streak=0, streakDir=null;
  ss.forEach(s => {
    totalProfit += s.profit;
    if (s.profit>0)      { wins++;   if (s.profit>bigWin)  bigWin  = s.profit; }
    else if (s.profit<0) { losses++; if (s.profit<bigLoss) bigLoss = s.profit; }
  });
  if (ss.length) {
    const last = ss[ss.length-1]; streakDir = last.profit>=0?'W':'L';
    for (let i=ss.length-1; i>=0; i--) {
      const w=ss[i].profit>=0;
      if ((streakDir==='W'&&w)||(streakDir==='L'&&!w)) streak++; else break;
    }
  }
  const avg=ss.length?totalProfit/ss.length:null, winRate=ss.length?Math.round((wins/ss.length)*100):null;
  return { totalProfit, wins, losses, bigWin, bigLoss, streak, streakDir, avg, winRate };
}
function getDisciplineStats() {
  const tracked = sessions.filter(s=>s.sessLossLimit>0||s.sessCashTarget>0);
  if (!tracked.length) return null;
  let target=0, ok=0, breach=0;
  tracked.forEach(s=>{ const c=getCompliance(s); if(c==='target') target++; else if(c==='ok') ok++; else if(c==='breach') breach++; });
  return { target, ok, breach, rate: Math.round(((target+ok)/tracked.length)*100), total: tracked.length };
}
function getPeriodLosses(period) {
  const now = new Date();
  return sessions.filter(s => {
    const d=new Date(sessionTimestamp(s));
    if (period==='daily')   return d.toDateString()===now.toDateString();
    if (period==='weekly')  { const start=new Date(now); start.setDate(now.getDate()-now.getDay()); start.setHours(0,0,0,0); return d>=start; }
    if (period==='monthly') return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();
    return false;
  }).reduce((sum,s)=>sum+s.profit,0);
}

// ─── Session CRUD ─────────────────────────────────────────────────────────────
function addSession() {
  const typeVal = document.getElementById('sessType').value;
  if (typeVal==='__new__') { document.getElementById('customTypeRow').style.display='flex'; document.getElementById('customTypeName').focus(); return; }
  const start=parseFloat(document.getElementById('start').value), end=parseFloat(document.getElementById('end').value);
  if (isNaN(start)||isNaN(end)) { alert('Please enter both a starting and ending balance.'); return; }
  const profit=end-start, duration=parseInt(document.getElementById('duration').value)||0;
  const dateInput=document.getElementById('sessDate').value;
  const ts=dateInput?new Date(dateInput).getTime():Date.now();
  if (editingId!==null) {
    const idx=sessions.findIndex(s=>s.id===editingId);
    if (idx!==-1) sessions[idx]={ ...sessions[idx], type:typeVal, venue:document.getElementById('venue').value.trim(), start, end, profit, duration, sessLossLimit:0, sessCashTarget:0, notes:document.getElementById('notes').value.trim(), timestamp:ts, date:fmtDatetime(ts) };
    editingId=null;
    document.getElementById('btnAddSession').textContent='+ Add Session';
    document.getElementById('btnCancelEdit').style.display='none';
    document.getElementById('sessionPageTitle').textContent='New Session';
  } else {
    sessions.push({ id:Date.now(), timestamp:ts, type:typeVal, venue:document.getElementById('venue').value.trim(), start, end, profit, duration, sessLossLimit:0, sessCashTarget:0, notes:document.getElementById('notes').value.trim(), date:fmtDatetime(ts) });
  }
  save();
  ['start','end','notes','venue','duration','sessDate'].forEach(id => { document.getElementById(id).value=''; });
  document.getElementById('sessType').value=getAllTypes()[0]||BUILT_IN_TYPES[0];
  render();
  switchTab('history', document.querySelector('[data-tab=history]'));
}
function editSession(id) {
  const s=sessions.find(s=>s.id===id); if (!s) return;
  editingId=id; rebuildTypeDropdown();
  document.getElementById('sessType').value   = s.type;
  document.getElementById('venue').value      = s.venue||'';
  document.getElementById('start').value      = s.start;
  document.getElementById('end').value        = s.end;
  document.getElementById('duration').value   = s.duration||'';
  document.getElementById('notes').value      = s.notes||'';
  document.getElementById('sessDate').value   = toDatetimeLocal(sessionTimestamp(s));
  document.getElementById('btnAddSession').textContent   = 'Save Changes';
  document.getElementById('btnCancelEdit').style.display = 'block';
  document.getElementById('sessionPageTitle').textContent = 'Edit Session';
  document.getElementById('autofillBanner').style.display = 'none';
  switchTab('session', document.querySelector('[data-tab=session]'));
}
function cancelEdit() {
  editingId=null;
  document.getElementById('btnAddSession').textContent='+ Add Session';
  document.getElementById('btnCancelEdit').style.display='none';
  document.getElementById('sessionPageTitle').textContent='New Session';
  ['start','end','notes','venue','duration','sessDate'].forEach(id=>{document.getElementById(id).value='';});
  document.getElementById('sessType').value=getAllTypes()[0]||BUILT_IN_TYPES[0];
}
function deleteSession(id) {
  if (!confirm('Delete this session?')) return;
  if (editingId===id) cancelEdit();
  selectedIds.delete(id);
  sessions=sessions.filter(s=>s.id!==id); save();
  const maxPage=Math.max(1,Math.ceil(getSortedSessions().length/PAGE_SIZE));
  if (currentPage>maxPage) currentPage=maxPage;
  render();
}

// ─── Timestamp Modal ──────────────────────────────────────────────────────────
function openTimestampModal(id) {
  const s=sessions.find(s=>s.id===id); if (!s) return;
  timestampEditId=id;
  document.getElementById('modalTimestamp').value=toDatetimeLocal(sessionTimestamp(s));
  document.getElementById('timestampModal').style.display='flex';
}
function closeTimestampModal() { timestampEditId=null; document.getElementById('timestampModal').style.display='none'; }
function saveTimestamp() {
  const val=document.getElementById('modalTimestamp').value; if (!val) { closeTimestampModal(); return; }
  const ts=new Date(val).getTime(), idx=sessions.findIndex(s=>s.id===timestampEditId);
  if (idx!==-1) { sessions[idx].timestamp=ts; sessions[idx].date=fmtDatetime(ts); save(); render(); }
  closeTimestampModal();
}

// ─── Multi-select ─────────────────────────────────────────────────────────────
function toggleSelect(id) {
  if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
  updateFloatingBar(); renderSessionList();
}
function clearMultiSelect() { selectedIds.clear(); updateFloatingBar(); renderSessionList(); }
function toggleSelectAll() {
  const all = getSortedSessions();
  if (selectedIds.size === all.length && all.every(s=>selectedIds.has(s.id))) {
    // All selected → deselect all
    selectedIds.clear();
  } else {
    // Select all visible
    all.forEach(s => selectedIds.add(s.id));
  }
  updateFloatingBar(); renderSessionList();
  const btn = document.getElementById('selectAllBtn');
  if (btn) btn.textContent = selectedIds.size > 0 ? 'Deselect all' : 'Select all';
}
function updateFloatingBar() {
  const bar = document.getElementById('floatingSelectBar');
  if (!bar) return;
  if (selectedIds.size === 0) {
    bar.style.display = 'none';
  } else {
    bar.style.display = 'flex';
    document.getElementById('floatingCount').textContent = `${selectedIds.size} selected`;
  }
  // Update select-all button label
  const btn = document.getElementById('selectAllBtn');
  if (btn) btn.textContent = selectedIds.size > 0 ? 'Deselect all' : 'Select all';
}
function updateFloatingBarVisibility() {
  // Keep it always visible if items selected; scroll doesn't hide it
  const bar = document.getElementById('floatingSelectBar');
  if (!bar) return;
  if (selectedIds.size > 0) bar.style.display = 'flex';
}
function deleteSelectedSessions() {
  if (!selectedIds.size) return;
  if (!confirm(`Delete ${selectedIds.size} session${selectedIds.size>1?'s':''}?`)) return;
  sessions=sessions.filter(s=>!selectedIds.has(s.id));
  selectedIds.clear(); save(); updateFloatingBar(); render();
}

// ─── Download History ─────────────────────────────────────────────────────────
function downloadHistory(format) {
  if (!sessions.length) { alert('No sessions to export.'); return; }
  let content, filename, mime;
  if (format==='csv') {
    const headers=['Date','Type','Venue','Start','End','Profit','Duration (min)','Notes'];
    const rows=sessions.map(s=>[fmtDatetime(sessionTimestamp(s)),s.type,s.venue||'',s.start.toFixed(2),s.end.toFixed(2),s.profit.toFixed(2),s.duration||0,s.notes||''].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','));
    content=[headers.join(','),...rows].join('\n');
    filename=`brt-history-${new Date().toISOString().slice(0,10)}.csv`;
    mime='text/csv';
  } else {
    content=JSON.stringify(sessions,null,2);
    filename=`brt-history-${new Date().toISOString().slice(0,10)}.json`;
    mime='application/json';
  }
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([content],{type:mime}));
  a.download=filename; a.click();
}

// ─── Filter / Sort / Pagination ───────────────────────────────────────────────
function setFilter(type) { filterType=type; currentPage=1; renderFilters(); renderSessionList(); }
function setSortMode(mode){ sortMode=mode; currentPage=1; renderSessionList(); }
function getFilteredSessions() { return filterType==='All'?sessions:sessions.filter(s=>s.type===filterType); }
function getSortedSessions() {
  const arr=[...getFilteredSessions()];
  switch(sortMode){
    case 'oldest':        return arr;
    case 'newest':        return arr.reverse();
    case 'profit_desc':   return arr.sort((a,b)=>b.profit-a.profit);
    case 'profit_asc':    return arr.sort((a,b)=>a.profit-b.profit);
    case 'duration_desc': return arr.sort((a,b)=>(b.duration||0)-(a.duration||0));
    default: return arr.reverse();
  }
}
function goPage(dir) {
  const max=Math.max(1,Math.ceil(getSortedSessions().length/PAGE_SIZE));
  currentPage=Math.min(max,Math.max(1,currentPage+dir));
  renderSessionList();
}

// ─── Live Session ─────────────────────────────────────────────────────────────
function syncLiveDropdowns() {
  rebuildTypeDropdown('liveType');
  // Autofill buy-in hint from last session
  if (!liveState && sessions.length) {
    const last=[...sessions].sort((a,b)=>sessionTimestamp(b)-sessionTimestamp(a))[0];
    const hint=document.getElementById('liveBuyInHint');
    if (hint) hint.textContent=`(last ended $${last.end.toFixed(2)})`;
    const buyInEl=document.getElementById('liveBuyIn');
    if (buyInEl && !buyInEl.value) buyInEl.value=last.end.toFixed(2);
  }
  // Pre-fill limits from settings
  const llEl=document.getElementById('liveLossLimit'), lcEl=document.getElementById('liveCashTarget');
  if (llEl && !llEl.value && limits.sessLoss>0) llEl.placeholder=`$${limits.sessLoss} (default)`;
  if (lcEl && !lcEl.value && limits.sessTarget>0) lcEl.placeholder=`$${limits.sessTarget} (default)`;
}

function startLive() {
  const buyIn=parseFloat(document.getElementById('liveBuyIn').value);
  if (isNaN(buyIn)||buyIn<=0) { alert('Enter a buy-in amount to start.'); return; }
  const lossInput=parseFloat(document.getElementById('liveLossLimit').value);
  const targInput=parseFloat(document.getElementById('liveCashTarget').value);
  liveState = {
    startTime: Date.now(),
    type:       document.getElementById('liveType').value,
    venue:      document.getElementById('liveVenue').value.trim(),
    buyIn,
    lossLimit:  !isNaN(lossInput)&&lossInput>0 ? lossInput : (limits.sessLoss||0),
    cashTarget: !isNaN(targInput)&&targInput>0 ? targInput : (limits.sessTarget||0),
  };
  localStorage.setItem('brt_live', JSON.stringify(liveState));
  showLiveIndicator(true);
  showLiveActive();
  startLiveTimer();
  scheduleLiveAICoach();
}

function restoreLiveUI() {
  if (!liveState) return;
  document.getElementById('liveIdle').style.display   = 'none';
  document.getElementById('liveActive').style.display = 'block';
  // Restore header
  const typeEl=document.getElementById('liveActiveType'), venueEl=document.getElementById('liveActiveVenue');
  if (typeEl)  typeEl.textContent  = getTypeIcon(liveState.type)+' '+liveState.type;
  if (venueEl) venueEl.textContent = liveState.venue||'';
  startLiveTimer();
  scheduleLiveAICoach();
}

function showLiveActive() {
  document.getElementById('liveIdle').style.display   = 'none';
  document.getElementById('liveActive').style.display = 'block';
  const typeEl=document.getElementById('liveActiveType'), venueEl=document.getElementById('liveActiveVenue');
  if (typeEl)  typeEl.textContent  = getTypeIcon(liveState.type)+' '+liveState.type;
  if (venueEl) venueEl.textContent = liveState.venue||'';
}

function startLiveTimer() {
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = setInterval(() => {
    const elapsed=Math.floor((Date.now()-liveState.startTime)/1000);
    const h=Math.floor(elapsed/3600), m=Math.floor((elapsed%3600)/60), s=elapsed%60;
    const el=document.getElementById('liveClock');
    if (el) el.textContent=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }, 1000);
}

function updateLivePL() {
  if (!liveState) return;
  const current=parseFloat(document.getElementById('liveCurrentStack').value);
  const hero=document.getElementById('livePLHero');
  const sub=document.getElementById('livePLSub');
  const metaEl=document.getElementById('liveStackMeta');

  if (isNaN(current)) {
    if (hero) { hero.textContent='—'; hero.className='live-pl-hero-value'; }
    if (sub)  sub.textContent='Enter your stack below to track';
    if (metaEl) metaEl.textContent='';
    return;
  }

  const pl=current-liveState.buyIn;
  const pct=liveState.buyIn>0?((pl/liveState.buyIn)*100).toFixed(1):0;
  if (hero) { hero.textContent=fmt(pl,true); hero.className='live-pl-hero-value '+(pl>=0?'pos':'neg'); }
  if (sub)  sub.textContent=`Started at $${liveState.buyIn.toFixed(2)} · ${pct}%`;
  if (metaEl) metaEl.textContent=`Stack: $${current.toFixed(2)}`;

  // Limit progress bars
  updateLiveLimitBars(pl);

  // Alerts
  const alertsEl=document.getElementById('liveAlerts');
  if (alertsEl) {
    const msgs=[];
    if (liveState.lossLimit>0 && pl<=-liveState.lossLimit)
      msgs.push({cls:'', txt:`🚨 Stop-loss hit — you're down ${fmt(Math.abs(pl))}. Time to walk away.`});
    if (liveState.cashTarget>0 && pl>=liveState.cashTarget)
      msgs.push({cls:'target-alert', txt:`🎯 Cash-out target reached — you're up ${fmt(pl)}. Lock in the win!`});
    alertsEl.innerHTML=msgs.map(m=>`<div class="live-alert ${m.cls}">${m.txt}</div>`).join('');
  }
}

function updateLiveLimitBars(pl) {
  const barsEl=document.getElementById('liveLimitBars');
  const hasLoss=liveState.lossLimit>0, hasTgt=liveState.cashTarget>0;
  if (!barsEl) return;
  if (!hasLoss&&!hasTgt) { barsEl.style.display='none'; return; }
  barsEl.style.display='flex';

  const lossBar=document.getElementById('liveLossBar');
  const targBar=document.getElementById('liveTargetBar');
  if (lossBar) lossBar.style.display=hasLoss?'block':'none';
  if (targBar) targBar.style.display=hasTgt?'block':'none';

  if (hasLoss) {
    const lost=Math.max(0,-pl), pct=Math.min(100,(lost/liveState.lossLimit)*100);
    const fill=document.getElementById('liveLossFill'), val=document.getElementById('liveLossBarVal');
    if (fill) fill.style.width=pct+'%';
    if (val)  val.textContent=`${fmt(lost)} / ${fmt(liveState.lossLimit)}`;
  }
  if (hasTgt) {
    const gained=Math.max(0,pl), pct=Math.min(100,(gained/liveState.cashTarget)*100);
    const fill=document.getElementById('liveTargetFill'), val=document.getElementById('liveTargetBarVal');
    if (fill) fill.style.width=pct+'%';
    if (val)  val.textContent=`${fmt(gained)} / ${fmt(liveState.cashTarget)}`;
  }
}

function scheduleLiveAICoach() {
  // Show an AI coaching nudge after 20 minutes of live play
  if (liveAITimer) clearTimeout(liveAITimer);
  liveAITimer = setTimeout(() => { generateLiveAITip(); }, 20*60*1000);
  // Also show if we already have history context
  if (sessions.length >= 3) generateLiveAITip();
}

async function generateLiveAITip() {
  if (!liveState) return;
  const stripEl=document.getElementById('liveAIStrip');
  const textEl=document.getElementById('liveAIText');
  if (!stripEl||!textEl) return;
  stripEl.style.display='flex';
  textEl.textContent='Thinking…';
  try {
    const elapsed=Math.round((Date.now()-liveState.startTime)/60000);
    const current=parseFloat(document.getElementById('liveCurrentStack')?.value)||null;
    const pl=current!==null?current-liveState.buyIn:null;
    const context=buildSessionContext();
    const prompt=`The user is currently in a live ${liveState.type} session${liveState.venue?' at '+liveState.venue:''}. Started $${liveState.buyIn.toFixed(2)}, been playing ${elapsed} minutes${pl!==null?`, currently at ${fmt(pl,true)}`:''}.${liveState.lossLimit>0?` Stop-loss: $${liveState.lossLimit}.`:''} ${liveState.cashTarget>0?`Cash-out target: $${liveState.cashTarget}.`:''}\n\nBased on their history and current situation, give ONE short, direct, actionable coaching tip (2-3 sentences max). Be honest and practical.`;
    const response=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:150, system:`You are a sharp gambling coach. Be concise, direct, and useful. ${context}`, messages:[{role:'user',content:prompt}] })
    });
    const data=await response.json();
    const tip=data.content?.map(c=>c.text||'').join('')||'Stay disciplined — stick to your plan.';
    textEl.textContent=tip;
  } catch(e) { textEl.textContent='Stay focused and stick to your session plan.'; }
}

function endLive() {
  if (!liveState) return;
  const current=parseFloat(document.getElementById('liveCurrentStack').value);
  if (isNaN(current)) { alert('Enter your current stack to end the session.'); return; }
  if (!confirm(`End session with a stack of $${current.toFixed(2)}?`)) return;
  clearInterval(liveTimer); liveTimer=null;
  if (liveAITimer) { clearTimeout(liveAITimer); liveAITimer=null; }
  const duration=Math.round((Date.now()-liveState.startTime)/60000);
  const profit=current-liveState.buyIn;
  const notes=document.getElementById('liveNotes')?.value.trim()||'';
  const ts=liveState.startTime;
  sessions.push({ id:Date.now(), timestamp:ts, type:liveState.type, venue:liveState.venue, start:liveState.buyIn, end:current, profit, duration, sessLossLimit:liveState.lossLimit, sessCashTarget:liveState.cashTarget, notes, date:fmtDatetime(ts) });
  save();
  liveState=null; localStorage.removeItem('brt_live');
  showLiveIndicator(false);
  // Reset live UI
  document.getElementById('liveActive').style.display='none';
  document.getElementById('liveIdle').style.display='block';
  ['liveCurrentStack','liveNotes','liveBuyIn','liveLossLimit','liveCashTarget','liveVenue'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  const alertsEl=document.getElementById('liveAlerts'); if(alertsEl) alertsEl.innerHTML='';
  const heroEl=document.getElementById('livePLHero'); if(heroEl){heroEl.textContent='—';heroEl.className='live-pl-hero-value';}
  render();
  switchTab('history', document.querySelector('[data-tab=history]'));
}
function cancelLive() {
  if (!confirm('Abandon this session? Nothing will be saved.')) return;
  clearInterval(liveTimer); liveTimer=null;
  if (liveAITimer) { clearTimeout(liveAITimer); liveAITimer=null; }
  liveState=null; localStorage.removeItem('brt_live');
  showLiveIndicator(false);
  document.getElementById('liveActive').style.display='none';
  document.getElementById('liveIdle').style.display='block';
}

// ─── Chart ────────────────────────────────────────────────────────────────────
function switchChart(mode,btn) {
  chartMode=mode;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); renderChart();
}
function renderChart() {
  const ctx=document.getElementById('bankrollChart'), wrap=ctx.parentElement;
  if (chartInstance){chartInstance.destroy();chartInstance=null;}
  const ss=getSessionsForPeriod();
  if (!ss.length){wrap.classList.add('chart-empty');return;}
  wrap.classList.remove('chart-empty');
  const labels=ss.map((s,i)=>s.venue||`S${i+1}`);
  const tip={backgroundColor:'#1a1a1a',borderColor:'#2e2e2e',borderWidth:1,titleColor:'#a1a1a1',bodyColor:'#f0f0f0',padding:10,callbacks:{label:v=>'  P&L  '+fmt(v.parsed.y||v.parsed.x,true)}};
  const sc={x:{ticks:{color:'#555',font:{size:10},maxRotation:0},grid:{color:'rgba(255,255,255,0.03)'},border:{color:'#252525'}},y:{ticks:{color:'#555',font:{size:10},callback:v=>'$'+v},grid:{color:'rgba(255,255,255,0.04)'},border:{color:'#252525',dash:[4,4]}}};
  if (chartMode==='line') {
    let running=0; const runData=ss.map(s=>parseFloat((running+=s.profit).toFixed(2)));
    const maxV=Math.max(...runData),minV=Math.min(...runData);
    const zeroStop=parseFloat((1-(maxV<=0?0:minV>=0?1:maxV/(maxV-minV||1))).toFixed(3));
    chartInstance=new Chart(ctx,{type:'line',data:{labels,datasets:[{label:'Bankroll',data:runData,borderColor:runData[runData.length-1]>=0?'#22c55e':'#ef4444',borderWidth:2.5,pointRadius:runData.map((_,i)=>i===runData.length-1?5:3),pointHoverRadius:6,pointBackgroundColor:runData.map(v=>v>=0?'#22c55e':'#ef4444'),pointBorderColor:'transparent',tension:0.35,fill:true,backgroundColor:(context)=>{const{ctx:c,chartArea}=context.chart;if(!chartArea)return'transparent';const g=c.createLinearGradient(0,chartArea.top,0,chartArea.bottom);g.addColorStop(0,'rgba(34,197,94,0.22)');g.addColorStop(Math.max(0,Math.min(1,zeroStop)),'rgba(34,197,94,0.04)');if(minV<0){g.addColorStop(Math.max(0,Math.min(1,zeroStop+0.001)),'rgba(239,68,68,0.04)');g.addColorStop(1,'rgba(239,68,68,0.18)');}return g;}}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:tip},scales:sc}});
  } else {
    const bData=ss.map(s=>parseFloat(s.profit.toFixed(2))),bC=ss.map(s=>s.profit>=0?'rgba(34,197,94,0.7)':'rgba(239,68,68,0.7)'),bB=ss.map(s=>s.profit>=0?'#22c55e':'#ef4444');
    chartInstance=new Chart(ctx,{type:'bar',data:{labels,datasets:[{label:'P&L',data:bData,backgroundColor:bC,borderColor:bB,borderWidth:1.5,borderRadius:5,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:tip},scales:{x:{ticks:{color:'#555',font:{size:10},maxRotation:0},grid:{display:false},border:{color:'#252525'}},y:sc.y}}});
  }
}

// ─── Dashboard AI Insight ─────────────────────────────────────────────────────
async function loadDashboardAIInsight() {
  if (!sessions.length || sessions.length < 3) return;
  const stripEl=document.getElementById('dashAIStrip'), textEl=document.getElementById('dashAIText');
  if (!stripEl||!textEl) return;
  stripEl.style.display='flex'; textEl.textContent='Loading insight…';
  try {
    const context=buildSessionContext();
    const response=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ model:'claude-sonnet-4-20250514',max_tokens:120,
        system:`You are a sharp gambling assistant. Give one useful, specific insight about this user's data. Be direct and concise — max 2 sentences. No fluff. ${context}`,
        messages:[{role:'user',content:'Give me one sharp, specific insight about my gambling data right now.'}] })
    });
    const data=await response.json();
    const insight=data.content?.map(c=>c.text||'').join('')||'';
    if (insight) { textEl.textContent=insight; stripEl.style.display='flex'; }
    else stripEl.style.display='none';
  } catch(e) { stripEl.style.display='none'; }
}

// ─── Render: Dashboard ────────────────────────────────────────────────────────
function renderDashboard() {
  const ss=getSessionsForPeriod(), stats=getStats(ss);
  const hero=document.getElementById('heroAmount');
  hero.textContent=fmt(stats.totalProfit,true);
  hero.className='hero-amount '+(stats.totalProfit>0?'pos':stats.totalProfit<0?'neg':'zero');
  document.getElementById('heroSessions').textContent=ss.length;
  document.getElementById('heroAvg').textContent=stats.avg!==null?fmt(stats.avg,true):'—';
  document.getElementById('heroStreak').textContent=stats.streak?stats.streak+stats.streakDir:'—';
  document.getElementById('heroWinRate').textContent=stats.winRate!==null?stats.winRate+'%':'—';
  document.getElementById('sBestWin').textContent=ss.length?fmt(stats.bigWin):'—';
  document.getElementById('sWorstLoss').textContent=ss.length?fmt(stats.bigLoss):'—';
  document.getElementById('sWins').textContent=stats.wins;
  document.getElementById('sLosses').textContent=stats.losses;

  const bh=document.getElementById('bankrollHealth');
  if (limits.bankroll>0) {
    bh.style.display='block';
    const allStats=getStats(sessions), current=limits.bankroll+allStats.totalProfit;
    const pct=Math.max(0,Math.min(100,(current/limits.bankroll)*100));
    document.getElementById('bhPct').textContent=Math.round(pct)+'%';
    document.getElementById('bhCurrent').textContent=fmt(current);
    document.getElementById('bhTotal').textContent=fmt(limits.bankroll);
    const bar=document.getElementById('bhBar');
    bar.style.width=pct+'%'; bar.className='bh-fill '+(pct>60?'healthy':pct>30?'warning':'critical');
  } else bh.style.display='none';

  const limEl=document.getElementById('limitStatus'), limItems=[];
  const addLI=(label,period,limit)=>{
    if(!limit)return;
    const pl=getPeriodLosses(period),used=Math.max(0,-pl),pct=Math.min(100,(used/limit)*100);
    const cls=pct>=100?'lim-hit':pct>=75?'lim-warn':'';
    limItems.push(`<div class="lim-card ${cls}"><div class="lim-card-top"><span class="lim-card-label">${label}</span><span class="lim-card-val">${fmt(used)}/${fmt(limit)}</span></div><div class="lim-track"><div class="lim-fill" style="width:${pct}%"></div></div></div>`);
  };
  addLI('Today','daily',limits.daily); addLI('Week','weekly',limits.weekly); addLI('Month','monthly',limits.monthly);
  if(limItems.length){limEl.style.display='flex';limEl.innerHTML=limItems.join('');}else limEl.style.display='none';

  const disc=getDisciplineStats(), discCard=document.getElementById('disciplineCard');
  if(disc){discCard.style.display='block';document.getElementById('discTarget').textContent=disc.target;document.getElementById('discOk').textContent=disc.ok;document.getElementById('discBreach').textContent=disc.breach;document.getElementById('discRate').textContent=disc.rate+'%';}
  else discCard.style.display='none';

  const{warnings,tips}=getWarningsAndTips();
  const wb=document.getElementById('warnBanner'), tb=document.getElementById('tipBanner');
  if(warnings.length){wb.style.display='block';wb.innerHTML=warnings.map(w=>`<div class="banner-item">${w}</div>`).join('');}else wb.style.display='none';
  if(tips.length&&!warnings.length){tb.style.display='block';tb.innerHTML=tips.map(t=>`<div class="banner-item">${t}</div>`).join('');}else tb.style.display='none';

  const bar=document.getElementById('streakBar'); bar.innerHTML='';
  sessions.slice(-28).forEach(s=>{const d=document.createElement('div');d.className='streak-dot';d.style.background=s.profit>=0?'rgba(34,197,94,0.5)':'rgba(239,68,68,0.5)';d.title=fmt(s.profit,true)+(s.venue?' · '+s.venue:'');bar.appendChild(d);});
  renderChart();
  // Load AI insight async (only when on dashboard)
  if (activeTab==='dashboard') loadDashboardAIInsight();
}

// ─── Render: Session Form ─────────────────────────────────────────────────────
function renderSessionForm() { rebuildTypeDropdown(); }

// ─── Render: History ─────────────────────────────────────────────────────────
function renderFilters() {
  const container=document.getElementById('filterBar'); container.innerHTML='';
  const allBtn=document.createElement('button'); allBtn.className='filter-btn'+(filterType==='All'?' active':''); allBtn.textContent='All'; allBtn.onclick=()=>setFilter('All'); container.appendChild(allBtn);
  getAllTypes().forEach(t=>{
    const wrap=document.createElement('div'); wrap.className='filter-btn-wrap';
    const btn=document.createElement('button'); btn.className='filter-btn'+(filterType===t?' active':''); btn.textContent=getTypeIcon(t)+' '+t; btn.onclick=()=>setFilter(t); wrap.appendChild(btn);
    if(customTypes.includes(t)){const del=document.createElement('button');del.className='filter-del';del.textContent='×';del.onclick=e=>{e.stopPropagation();deleteCustomType(t);};wrap.appendChild(del);}
    container.appendChild(wrap);
  });
}
function renderSessionList() {
  const list=document.getElementById('sessionList'), sorted=getSortedSessions();
  const sel=document.getElementById('sortSelect'); if(sel) sel.value=sortMode;
  if(!sessions.length){list.innerHTML=`<div class="empty-state"><div class="empty-icon">🎲</div>No sessions yet. Add your first one!</div>`;document.getElementById('paginationBar').innerHTML='';return;}
  if(!sorted.length){list.innerHTML=`<div class="empty-state"><div class="empty-icon">${getTypeIcon(filterType)}</div>No ${filterType} sessions.</div>`;document.getElementById('paginationBar').innerHTML='';return;}
  const maxPage=Math.max(1,Math.ceil(sorted.length/PAGE_SIZE));
  if(currentPage>maxPage) currentPage=maxPage;
  const pageItems=sorted.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE);
  list.innerHTML='';
  pageItems.forEach(s=>{
    const pos=s.profit>=0, editing=editingId===s.id, dur=formatDuration(s.duration), comp=getCompliance(s);
    const compBadge=comp==='target'?'<span class="comp-badge" title="Hit target">🎯</span>':comp==='breach'?'<span class="comp-badge" title="Exceeded stop-loss">⚠️</span>':comp==='ok'?'<span class="comp-badge" title="Within limits">✅</span>':'';
    const isSelected=selectedIds.has(s.id);
    const div=document.createElement('div');
    div.className='sess-row'+(editing?' editing':'')+(isSelected?' selected':'');
    div.innerHTML=`
      <div class="sess-check" onclick="toggleSelect(${s.id})"><div class="check-box ${isSelected?'checked':''}"></div></div>
      <div class="sess-badge ${pos?'pos':'neg'}">${getTypeIcon(s.type)}</div>
      <div class="sess-info">
        <div class="sess-top">
          <span class="sess-type">${s.type}</span>
          ${s.venue?`<span class="sess-venue">${s.venue}</span>`:''}
          ${dur?`<span class="sess-duration">⏱ ${dur}</span>`:''}
          ${compBadge}
        </div>
        <div class="sess-bottom">${fmtDatetime(sessionTimestamp(s))} · $${s.start.toFixed(2)} → $${s.end.toFixed(2)}</div>
        ${s.notes?`<div class="notes-pill">${s.notes}</div>`:''}
      </div>
      <div class="sess-profit ${pos?'pos':'neg'}">${fmt(s.profit,true)}</div>
      <div class="sess-actions">
        <button class="sess-ts" onclick="openTimestampModal(${s.id})" title="Edit timestamp">🕐</button>
        <button class="sess-edit" onclick="editSession(${s.id})" title="Edit">✎</button>
        <button class="sess-del" onclick="deleteSession(${s.id})" title="Delete">✕</button>
      </div>`;
    list.appendChild(div);
  });
  const pag=document.getElementById('paginationBar');
  if(maxPage<=1){pag.innerHTML='';return;}
  pag.innerHTML=`<div class="pagination"><button class="pag-btn" onclick="goPage(-1)" ${currentPage===1?'disabled':''}>← Prev</button><span class="pag-info">Page ${currentPage} of ${maxPage} · ${sorted.length} sessions</span><button class="pag-btn" onclick="goPage(1)" ${currentPage===maxPage?'disabled':''}>Next →</button></div>`;
}

// ─── Render: Insights ─────────────────────────────────────────────────────────
function renderInsights() { renderInsightCards();renderMonthlyChart();renderTypeChart();renderDowChart();renderVenues(); }
function renderInsightCards() {
  const container=document.getElementById('insightCards'); if(!sessions.length){container.innerHTML='';return;}
  const cards=[], stats=getStats(sessions);
  if(stats.winRate!==null) cards.push({icon:stats.winRate>=50?'📈':'📉',text:`Win rate: <strong>${stats.winRate}%</strong>. Best win: <strong>${fmt(stats.bigWin)}</strong>, worst loss: <strong>${fmt(stats.bigLoss)}</strong>.`});
  const byType={};sessions.forEach(s=>{byType[s.type]=(byType[s.type]||0)+s.profit;});
  const types=Object.entries(byType).sort((a,b)=>b[1]-a[1]);
  if(types.length>=2) cards.push({icon:getTypeIcon(types[0][0]),text:`<strong>${types[0][0]}</strong> is your most profitable type at <strong>${fmt(types[0][1],true)}</strong>.`});
  const byDow=Array(7).fill(null).map(()=>({sum:0,count:0}));
  sessions.forEach(s=>{const d=new Date(sessionTimestamp(s)).getDay();byDow[d].sum+=s.profit;byDow[d].count++;});
  const dowAvgs=byDow.map(d=>d.count?d.sum/d.count:null);
  const bestDow=dowAvgs.reduce((best,v,i)=>v!==null&&(best===null||v>dowAvgs[best])?i:best,null);
  if(bestDow!==null) cards.push({icon:'📅',text:`Best day: <strong>${DOW_LABELS[bestDow]}</strong> — avg <strong>${fmt(dowAvgs[bestDow],true)}</strong>.`});
  const durS=sessions.filter(s=>s.duration>0);
  if(durS.length>=3){const avg=Math.round(durS.reduce((s,x)=>s+x.duration,0)/durS.length);cards.push({icon:'⏱',text:`Average session: <strong>${formatDuration(avg)}</strong> across ${durS.length} tracked sessions.`});}
  const disc=getDisciplineStats();
  if(disc&&disc.total>=3) cards.push({icon:disc.rate>=70?'🏅':'⚠️',text:`Discipline rate: <strong>${disc.rate}%</strong> (${disc.target+disc.ok}/${disc.total} sessions within limits).`});
  const now2=new Date(), tm=sessions.filter(s=>{const d=new Date(sessionTimestamp(s));return d.getMonth()===now2.getMonth()&&d.getFullYear()===now2.getFullYear();}), lm=sessions.filter(s=>{const d=new Date(sessionTimestamp(s));const l=new Date(now2);l.setMonth(l.getMonth()-1);return d.getMonth()===l.getMonth()&&d.getFullYear()===l.getFullYear();});
  if(tm.length&&lm.length){const tmPL=tm.reduce((s,x)=>s+x.profit,0),lmPL=lm.reduce((s,x)=>s+x.profit,0),diff=tmPL-lmPL;cards.push({icon:diff>=0?'🔼':'🔽',text:`This month: <strong>${fmt(tmPL,true)}</strong> vs last: <strong>${fmt(lmPL,true)}</strong> — <strong>${fmt(Math.abs(diff))}</strong> ${diff>=0?'improvement':'decline'}.`});}
  container.innerHTML=cards.map(c=>`<div class="insight-card"><span class="insight-icon">${c.icon}</span><div class="insight-text">${c.text}</div></div>`).join('');
}
function destroyIC(key){if(insightCharts[key]){insightCharts[key].destroy();delete insightCharts[key];}}
function renderMonthlyChart(){const ctx=document.getElementById('monthlyChart'),wrap=ctx.parentElement;destroyIC('monthly');if(!sessions.length){wrap.classList.add('chart-empty');return;}wrap.classList.remove('chart-empty');const mm={};sessions.forEach(s=>{const d=new Date(sessionTimestamp(s)),k=d.getFullYear()*100+d.getMonth();if(!mm[k])mm[k]={label:d.toLocaleDateString('en-US',{month:'short',year:'2-digit'}),sum:0};mm[k].sum+=s.profit;});const srt=Object.entries(mm).sort((a,b)=>+a[0]-+b[0]).slice(-12);const lb=srt.map(e=>e[1].label),dt=srt.map(e=>parseFloat(e[1].sum.toFixed(2)));const cl=dt.map(v=>v>=0?'rgba(34,197,94,0.7)':'rgba(239,68,68,0.7)'),br=dt.map(v=>v>=0?'#22c55e':'#ef4444');insightCharts['monthly']=new Chart(ctx,{type:'bar',data:{labels:lb,datasets:[{label:'P/L',data:dt,backgroundColor:cl,borderColor:br,borderWidth:1.5,borderRadius:4,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{backgroundColor:'#1a1a1a',borderColor:'#2e2e2e',borderWidth:1,titleColor:'#a1a1a1',bodyColor:'#f0f0f0',padding:8,callbacks:{label:v=>' '+fmt(v.parsed.y,true)}}},scales:{x:{ticks:{color:'#555',font:{size:10}},grid:{display:false},border:{color:'#252525'}},y:{ticks:{color:'#555',font:{size:10},callback:v=>'$'+v},grid:{color:'rgba(255,255,255,0.04)'},border:{color:'#252525',dash:[4,4]}}}}});}
function renderTypeChart(){const ctx=document.getElementById('typeChart'),wrap=ctx.parentElement;destroyIC('type');if(!sessions.length){wrap.classList.add('chart-empty');return;}wrap.classList.remove('chart-empty');const byT={};sessions.forEach(s=>{byT[s.type]=(byT[s.type]||0)+s.profit;});const srt=Object.entries(byT).sort((a,b)=>b[1]-a[1]);const lb=srt.map(e=>e[0]),dt=srt.map(e=>parseFloat(e[1].toFixed(2)));const cl=dt.map(v=>v>=0?'rgba(34,197,94,0.7)':'rgba(239,68,68,0.7)'),br=dt.map(v=>v>=0?'#22c55e':'#ef4444');insightCharts['type']=new Chart(ctx,{type:'bar',data:{labels:lb,datasets:[{label:'P/L',data:dt,backgroundColor:cl,borderColor:br,borderWidth:1.5,borderRadius:4,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{backgroundColor:'#1a1a1a',borderColor:'#2e2e2e',borderWidth:1,titleColor:'#a1a1a1',bodyColor:'#f0f0f0',padding:8,callbacks:{label:v=>' '+fmt(v.parsed.x,true)}}},sections:{y:{ticks:{color:'#888',font:{size:11}},grid:{display:false},border:{color:'#252525'}},x:{ticks:{color:'#555',font:{size:10},callback:v=>'$'+v},grid:{color:'rgba(255,255,255,0.04)'},border:{color:'#252525',dash:[4,4]}}},scales:{y:{ticks:{color:'#888',font:{size:11}},grid:{display:false},border:{color:'#252525'}},x:{ticks:{color:'#555',font:{size:10},callback:v=>'$'+v},grid:{color:'rgba(255,255,255,0.04)'},border:{color:'#252525',dash:[4,4]}}}}})}
function renderDowChart(){const ctx=document.getElementById('dowChart'),wrap=ctx.parentElement;destroyIC('dow');if(!sessions.length){wrap.classList.add('chart-empty');return;}wrap.classList.remove('chart-empty');const bD=Array(7).fill(null).map(()=>({sum:0,count:0}));sessions.forEach(s=>{const d=new Date(sessionTimestamp(s)).getDay();bD[d].sum+=s.profit;bD[d].count++;});const avgs=bD.map(d=>d.count?parseFloat((d.sum/d.count).toFixed(2)):0);const cl=avgs.map(v=>v>=0?'rgba(34,197,94,0.7)':'rgba(239,68,68,0.7)'),br=avgs.map(v=>v>=0?'#22c55e':'#ef4444');insightCharts['dow']=new Chart(ctx,{type:'bar',data:{labels:DOW_LABELS,datasets:[{label:'Avg P/L',data:avgs,backgroundColor:cl,borderColor:br,borderWidth:1.5,borderRadius:4,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{backgroundColor:'#1a1a1a',borderColor:'#2e2e2e',borderWidth:1,titleColor:'#a1a1a1',bodyColor:'#f0f0f0',padding:8,callbacks:{label:v=>' Avg '+fmt(v.parsed.y,true)}}},scales:{x:{ticks:{color:'#888',font:{size:11}},grid:{display:false},border:{color:'#252525'}},y:{ticks:{color:'#555',font:{size:10},callback:v=>'$'+v},grid:{color:'rgba(255,255,255,0.04)'},border:{color:'#252525',dash:[4,4]}}}}})}
function renderVenues(){const bV={};sessions.forEach(s=>{if(!s.venue)return;if(!bV[s.venue])bV[s.venue]={profit:0,count:0};bV[s.venue].profit+=s.profit;bV[s.venue].count++;});const list=Object.entries(bV).sort((a,b)=>b[1].profit-a[1].profit);const sec=document.getElementById('venuesSection'),el=document.getElementById('venuesList');if(!list.length){sec.style.display='none';return;}sec.style.display='block';el.innerHTML=list.slice(0,8).map(([name,d])=>{const pos=d.profit>=0;return`<div class="venue-row"><div class="venue-name">${name}</div><div class="venue-count">${d.count} session${d.count!==1?'s':''}</div><div class="venue-pl ${pos?'pos':'neg'}">${fmt(d.profit,true)}</div></div>`;}).join('');}

// ─── Render: Limits ───────────────────────────────────────────────────────────
function renderLimitsPage() {
  const fields={limBankroll:'bankroll',limDaily:'daily',limWeekly:'weekly',limMonthly:'monthly',limSession:'sessLoss',limSessTarget:'sessTarget',limMonthTarget:'monthTarget'};
  Object.entries(fields).forEach(([id,key])=>{const el=document.getElementById(id);if(el)el.value=limits[key]>0?limits[key]:'';});
  const sec=document.getElementById('periodStatus'); if(!sessions.length){sec.innerHTML='';return;}
  const now2=new Date();
  const mS=sessions.filter(s=>{const d=new Date(sessionTimestamp(s));return d.getMonth()===now2.getMonth()&&d.getFullYear()===now2.getFullYear();});
  const wS=sessions.filter(s=>{const d=new Date(sessionTimestamp(s));const start=new Date(now2);start.setDate(now2.getDate()-now2.getDay());start.setHours(0,0,0,0);return d>=start;});
  const tS=sessions.filter(s=>{const d=new Date(sessionTimestamp(s));return d.toDateString()===now2.toDateString();});
  const mPL=mS.reduce((s,x)=>s+x.profit,0),wPL=wS.reduce((s,x)=>s+x.profit,0),tPL=tS.reduce((s,x)=>s+x.profit,0);
  const rows=[{label:'Today',pl:tPL,limit:limits.daily,sessions:tS.length},{label:'This week',pl:wPL,limit:limits.weekly,sessions:wS.length},{label:'This month',pl:mPL,limit:limits.monthly,sessions:mS.length,target:limits.monthTarget}];
  sec.innerHTML=`<div class="section-label" style="margin-top:1.5rem">Current Period Status</div><div class="period-status-cards">${rows.map(r=>{const pos=r.pl>=0,lA=Math.max(0,-r.pl),lP=r.limit?Math.min(100,(lA/r.limit)*100):0,tP=r.target?Math.min(100,(r.pl/r.target)*100):0;return`<div class="ps-card"><div class="ps-top"><span class="ps-label">${r.label}</span><span class="ps-pl ${pos?'pos':'neg'}">${fmt(r.pl,true)}</span></div><div class="ps-meta">${r.sessions} session${r.sessions!==1?'s':''}</div>${r.limit?`<div class="ps-bar-row"><span class="ps-bar-label">Stop-loss: ${fmt(lA)}/${fmt(r.limit)}</span><div class="ps-track"><div class="ps-fill ${lP>=100?'lim-hit':lP>=75?'lim-warn':''}" style="width:${lP}%"></div></div></div>`:''} ${r.target?`<div class="ps-bar-row"><span class="ps-bar-label">Goal: ${fmt(Math.max(0,r.pl))}/${fmt(r.target)}</span><div class="ps-track"><div class="ps-fill goal" style="width:${tP}%"></div></div></div>`:''}</div>`;}).join('')}</div>`;
}

// ─── AI Panel ─────────────────────────────────────────────────────────────────
function toggleAI() {
  aiPanelOpen = !aiPanelOpen;
  const panel=document.getElementById('aiPanel'), backdrop=document.getElementById('aiPanelBackdrop');
  panel.style.display    = aiPanelOpen ? 'flex' : 'none';
  backdrop.style.display = aiPanelOpen ? 'block' : 'none';
  if (aiPanelOpen) document.getElementById('aiChatInput')?.focus();
}

function buildSessionContext() {
  if (!sessions.length) return 'The user has no recorded sessions yet.';
  const stats=getStats(sessions), now2=new Date();
  const thisMonth=sessions.filter(s=>{const d=new Date(sessionTimestamp(s));return d.getMonth()===now2.getMonth()&&d.getFullYear()===now2.getFullYear();});
  const recent=[...sessions].sort((a,b)=>sessionTimestamp(b)-sessionTimestamp(a)).slice(0,5);
  const byType={};sessions.forEach(s=>{if(!byType[s.type])byType[s.type]={count:0,profit:0};byType[s.type].count++;byType[s.type].profit+=s.profit;});
  const disc=getDisciplineStats();
  return `USER SESSION DATA:
Total sessions: ${sessions.length} | Total P/L: ${fmt(stats.totalProfit,true)} | Win rate: ${stats.winRate}% | Avg/session: ${fmt(stats.avg,true)}
Best win: ${fmt(stats.bigWin)} | Worst loss: ${fmt(stats.bigLoss)} | Current streak: ${stats.streak}${stats.streakDir}
This month: ${thisMonth.length} sessions, ${fmt(thisMonth.reduce((s,x)=>s+x.profit,0),true)}
Discipline: ${disc?`${disc.rate}% (${disc.breach} breaches / ${disc.total} tracked)`:'No limits tracked'}
Limits — Bankroll: ${limits.bankroll?fmt(limits.bankroll):'none'}, Daily: ${limits.daily?fmt(limits.daily):'none'}, Weekly: ${limits.weekly?fmt(limits.weekly):'none'}, Monthly: ${limits.monthly?fmt(limits.monthly):'none'}
By type: ${Object.entries(byType).map(([t,d])=>`${t}: ${d.count} sessions ${fmt(d.profit,true)}`).join(' | ')}
Recent 5: ${recent.map(s=>`${s.type}${s.venue?' @'+s.venue:''} ${fmt(s.profit,true)} ${formatDuration(s.duration)||''}`).join(' | ')}`;
}

function sendQuickPrompt(text) {
  document.getElementById('aiChatInput').value=text; sendAIChat();
}

async function sendAIChat() {
  const input=document.getElementById('aiChatInput');
  const msg=input.value.trim(); if (!msg) return;
  input.value='';
  const chatArea=document.getElementById('aiChatArea');
  document.getElementById('aiQuickChips').style.display='none';
  const userDiv=document.createElement('div'); userDiv.className='ai-bubble user'; userDiv.textContent=msg; chatArea.appendChild(userDiv);
  const loadDiv=document.createElement('div'); loadDiv.className='ai-bubble assistant loading';
  loadDiv.innerHTML='<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
  chatArea.appendChild(loadDiv); chatArea.scrollTop=chatArea.scrollHeight;
  aiChatHistory.push({role:'user',content:msg});
  const system=`You are a smart, direct gambling assistant for BRT PRO. You have the user's full session history. Be honest, specific, data-driven. Promote responsible gambling when relevant. Keep responses concise — 2-4 short paragraphs or bullet points. Reference actual numbers from their data.\n\n${buildSessionContext()}`;
  try {
    const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:800,system,messages:aiChatHistory})});
    const data=await response.json();
    const reply=data.content?.map(c=>c.text||'').join('')||'Sorry, I had trouble responding.';
    aiChatHistory.push({role:'assistant',content:reply});
    loadDiv.className='ai-bubble assistant';
    loadDiv.innerHTML=reply.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/^- (.+)$/gm,'• $1').replace(/\n\n/g,'<br><br>').replace(/\n/g,'<br>');
  } catch(e) {
    loadDiv.className='ai-bubble error'; loadDiv.textContent='Connection error. Check your API access.'; aiChatHistory.pop();
  }
  chatArea.scrollTop=chatArea.scrollHeight;
}

// ─── Main render ──────────────────────────────────────────────────────────────
function render() {
  renderDashboard();
  rebuildTypeDropdown();
  renderSessionForm();
  renderFilters();
  renderSessionList();
  if(activeTab==='insights') renderInsights();
  if(activeTab==='limits')   renderLimitsPage();
}