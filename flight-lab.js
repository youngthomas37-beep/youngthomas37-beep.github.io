(() => {
'use strict';

const $ = (id) => document.getElementById(id);
const DB_NAME = 'ty-flight-lab';
const STORE = 'flights';
const state = {
  flights: [],
  current: null,
  filter: 'all',
  query: '',
  index: 0,
  playing: false,
  speed: 8,
  playStart: 0,
  playT0: 0,
  recording: false,
  lastChart: -1,
};

let scene, camera, renderer, controls, pathGroup, currentMarker, currentLine, currentLineGeo;
let sceneReady = false;
let resizeObserver = null;
let mediaRecorder = null;
let recordStart = 0;
let recordAutoRotate = false;
let recordCanvas = null;
let recordCtx = null;

const fmt = (n, d = 0) => Number.isFinite(n) ? n.toFixed(d) : '—';
const fmtDuration = (seconds) => {
  if (!Number.isFinite(seconds)) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
};
const fmtClock = (seconds) => {
  const t = Math.max(0, Math.floor(seconds)) % 86400;
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].map(n => String(n).padStart(2, '0')).join(':') + ' UTC';
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
};

function haversine(a, b) {
  const R = 6371008.8, rad = Math.PI / 180;
  const p1 = a.lat * rad, p2 = b.lat * rad;
  const dp = (b.lat - a.lat) * rad, dl = (b.lon - a.lon) * rad;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function parseIGC(text, name) {
  const lines = text.replace(/\r/g, '').split('\n');
  let date = '';
  const fix = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('HFDTE')) {
      const m = line.match(/HFDTE(?:DATE:)?(\d{2})(\d{2})(\d{2})/);
      if (m) date = `20${m[3]}-${m[2]}-${m[1]}`;
      continue;
    }
    if (line[0] !== 'B' || line.length < 34) continue;
    const time = line.slice(1, 7);
    if (!/^\d{6}$/.test(time)) continue;
    const ns = line[14], ew = line[23];
    if (!'NS'.includes(ns) || !'EW'.includes(ew)) continue;
    const lat = (+line.slice(7, 9) + (+line.slice(9, 14) / 1000) / 60) * (ns === 'S' ? -1 : 1);
    const lon = (+line.slice(15, 18) + (+line.slice(18, 23) / 1000) / 60) * (ew === 'W' ? -1 : 1);
    const press = Number.parseInt(line.slice(24, 29), 10);
    const gps = Number.parseInt(line.slice(29, 34), 10);
    const alt = Number.isFinite(gps) && gps !== 0 ? gps : press;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(alt)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || alt < -1200 || alt > 10000) continue;
    let t = (+time.slice(0, 2)) * 3600 + (+time.slice(2, 4)) * 60 + (+time.slice(4, 6));
    if (fix.length && t < fix[fix.length - 1].t - 43200) t += 86400;
    if (fix.length && t <= fix[fix.length - 1].t) continue;
    fix.push({ t, lat, lon, alt });
  }
  if (fix.length < 10) return null;
  if (!date) {
    const m = name.match(/20\d{2}-\d{2}-\d{2}/);
    date = m ? m[0] : '未知日期';
  }

  const rad = Math.PI / 180;
  for (let i = 0; i < fix.length; i++) {
    const p = fix[i], a = fix[Math.max(0, i - 5)], b = fix[Math.min(fix.length - 1, i + 5)];
    const dt = Math.max(1, b.t - a.t);
    const dx = (b.lon - a.lon) * 111320 * Math.cos(((a.lat + b.lat) / 2) * rad);
    const dz = (b.lat - a.lat) * 110540;
    p.speed = Math.hypot(dx, dz) / dt * 3.6;
    p.climb = (b.alt - a.alt) / dt;
    p.heading = Math.atan2(dx, dz) / rad;
    p.turn = i ? (((p.heading - fix[i - 1].heading + 540) % 360) - 180) / Math.max(1, p.t - fix[i - 1].t) : 0;
    p.mode = 0;
  }

  const circles = [];
  let dir = 0, start = -1, angle = 0;
  for (let i = 1; i < fix.length; i++) {
    const p = fix[i], dt = Math.max(1, p.t - fix[i - 1].t);
    const ok = p.speed > 4 && p.speed < 65 && Math.abs(p.turn) > 4 && Math.abs(p.turn) < 60;
    const sign = Math.sign(p.turn);
    if (ok && (!dir || dir === sign)) {
      if (!dir) { dir = sign; start = i; angle = 0; }
      angle += Math.abs(p.turn) * dt;
      p.mode = p.climb >= 0.1 ? 1 : -1;
      if (angle >= 340) {
        const a = fix[start];
        const duration = p.t - a.t, gain = p.alt - a.alt;
        if (duration >= 10 && duration <= 180) circles.push({ duration, gain, rate: gain / duration, start, end: i });
        angle = 0;
        start = i;
      }
    } else {
      dir = 0;
      start = -1;
      angle = 0;
    }
  }

  let distance = 0, gain = 0, maxAlt = -Infinity, minAlt = Infinity;
  for (let i = 0; i < fix.length; i++) {
    const p = fix[i];
    maxAlt = Math.max(maxAlt, p.alt);
    minAlt = Math.min(minAlt, p.alt);
    if (i) {
      distance += haversine(fix[i - 1], p);
      gain += Math.max(0, p.alt - fix[i - 1].alt);
    }
  }

  return {
    id: `local-${hash(name + '|' + text.length + '|' + date)}`,
    name,
    date,
    source: 'local',
    text,
    fix,
    stats: { duration: fix[fix.length - 1].t - fix[0].t, distance, gain, maxAlt, minAlt, nCircles: circles.length },
    circles,
    scenePoints: [],
  };
}

function readZip(file) {
  if (typeof JSZip === 'undefined') throw new Error('ZIP 解析库未加载，请检查网络');
  return JSZip.loadAsync(file).then(zip => {
    const names = Object.keys(zip.files).filter(n => /\.igc$/i.test(n) && !zip.files[n].dir);
    return Promise.all(names.map(async n => ({ name: n.split('/').pop(), text: await zip.files[n].async('string') })));
  });
}

function idbOpen() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('浏览器不支持 IndexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(item) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
async function idbAll() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => { db.close(); resolve(req.result || []); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}
async function idbDelete(id) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

function setStatus(message, kind = '') {
  const el = $('loadStatus');
  el.textContent = message;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

function upsertFlight(f) {
  const i = state.flights.findIndex(x => x.id === f.id);
  if (i >= 0) state.flights[i] = f;
  else state.flights.push(f);
  state.flights.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.name.localeCompare(b.name));
}

function publicFlight(item) {
  const name = String(item.name || item.file || 'IGC').split('/').pop();
  return {
    id: 'public-' + hash(String(item.src || name)),
    name,
    date: item.date || '未知日期',
    source: 'public',
    src: item.src || 'flight-data/igc/' + name,
    text: null,
    fix: null,
    circles: [],
    stats: null,
    scenePoints: [],
  };
}

async function loadPublished() {
  try {
    const res = await fetch('flight-data/igc/index.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.flights || []);
    for (const item of list) if (item && (item.src || item.file)) upsertFlight(publicFlight(item));
    if (!list.length) setStatus('暂无公开 IGC；导入文件，或按下方说明发布公开记录。');
  } catch (err) {
    setStatus('暂无公开目录；导入本机 IGC 即可开始。');
  }
}

async function loadLocal() {
  try {
    const rows = await idbAll();
    let loaded = 0;
    for (const row of rows) {
      const f = parseIGC(row.text, row.name);
      if (!f) continue;
      f.id = row.id;
      f.source = 'local';
      f.text = row.text;
      upsertFlight(f);
      loaded++;
    }
    if (loaded) setStatus(`已从本机记录库载入 ${loaded} 条飞行。`);
  } catch (err) {
    setStatus('本机记录库不可用：' + err.message);
  }
}

function renderList() {
  const list = $('flightList');
  list.innerHTML = '';
  const q = state.query.trim().toLowerCase();
  const rows = state.flights.filter(f => {
    if (state.filter !== 'all' && f.source !== state.filter) return false;
    return !q || (f.date || '').toLowerCase().includes(q) || f.name.toLowerCase().includes(q);
  });
  if (!rows.length) {
    list.innerHTML = '<div class="list-empty">没有匹配的记录。<br>导入一个 .igc，或把 IGC 加进公开目录。</div>';
  }
  rows.forEach(f => {
    const card = document.createElement('div');
    card.className = 'flight-card' + (f === state.current ? ' active' : '');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `打开 ${f.date} ${f.name}`);
    const title = document.createElement('strong');
    title.textContent = f.date || '未知日期';
    const name = document.createElement('small');
    name.textContent = f.name;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const badge = document.createElement('span');
    badge.className = 'pill ' + f.source;
    badge.textContent = f.source === 'public' ? '公开' : '本机';
    meta.appendChild(badge);
    if (f.fix) {
      const n = document.createElement('span');
      n.className = 'pill';
      n.textContent = fmtDuration(f.stats.duration);
      meta.appendChild(n);
    }
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const dl = document.createElement('button');
    dl.type = 'button'; dl.className = 'mini'; dl.title = '下载 IGC'; dl.textContent = '↓';
    dl.addEventListener('click', e => { e.stopPropagation(); downloadFlight(f); });
    actions.appendChild(dl);
    if (f.source === 'local') {
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'mini'; del.title = '删除本机记录'; del.textContent = '×';
      del.addEventListener('click', e => { e.stopPropagation(); deleteLocal(f); });
      actions.appendChild(del);
    }
    card.append(title, name, meta, actions);
    card.addEventListener('click', () => selectFlight(f));
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectFlight(f); } });
    list.appendChild(card);
  });
  $('recordCount').textContent = String(state.flights.length);
  $('exportBtn').disabled = !state.flights.some(f => f.source === 'local');
}

function downloadFlight(f) {
  if (f.source === 'local' && f.text) {
    const blob = new Blob([f.text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else if (f.src) {
    const a = document.createElement('a');
    a.href = f.src; a.download = f.name;
    a.click();
  }
}

async function deleteLocal(f) {
  if (!confirm(`删除本机记录「${f.name}」？`)) return;
  try {
    await idbDelete(f.id);
    state.flights = state.flights.filter(x => x !== f);
    if (state.current === f) { clearStage(); }
    renderList();
    setStatus('已删除本机记录。');
  } catch (err) { setStatus('删除失败：' + err.message); }
}

async function addFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  setStatus('正在读取文件…');
  const imported = [];
  let savedAll = true;
  for (const file of files) {
    try {
      if (file.size > 60 * 1024 * 1024) throw new Error('文件过大');
      let entries = [];
      if (/\.zip$/i.test(file.name)) {
        entries = await readZip(file);
      } else if (/\.igc$/i.test(file.name)) {
        entries = [{ name: file.name, text: await file.text() }];
      } else {
        continue;
      }
      for (const entry of entries) {
        const f = parseIGC(entry.text, entry.name);
        if (!f) continue;
        try {
          await idbPut({ id: f.id, name: f.name, date: f.date, text: f.text, createdAt: Date.now() });
        } catch (err) {
          savedAll = false;
          setStatus('记录已载入，但本机保存失败：' + err.message);
        }
        upsertFlight(f);
        imported.push(f);
      }
    } catch (err) {
      setStatus('读取失败：' + file.name + ' · ' + err.message);
    }
  }
  renderList();
  if (imported.length) {
    setStatus(`已导入 ${imported.length} 条飞行。${savedAll ? '本机记录保存在当前浏览器。' : '部分记录未能保存到本机。'}`, savedAll ? 'ok' : 'error');
    selectFlight(imported[0]);
  } else {
    setStatus('没有找到有效 IGC。请检查文件是否包含 B 记录和 HFDTE 日期。');
  }
}

async function selectFlight(f) {
  if (f.source === 'public' && !f.text) {
    setStatus('正在读取公开 IGC…');
    try {
      const res = await fetch(f.src, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const parsed = parseIGC(await res.text(), f.name);
      if (!parsed) throw new Error('IGC 格式无效');
      Object.assign(f, parsed, { id: f.id, name: f.name, date: f.date || parsed.date, source: 'public', src: f.src, text: null });
      setStatus('公开记录已载入。');
    } catch (err) {
      setStatus('公开 IGC 读取失败：' + err.message);
      return;
    }
  }
  if (!f.fix) { setStatus('该记录没有可解析的轨迹。'); return; }
  pause();
  state.current = f;
  state.index = 0;
  state.lastChart = -1;
  $('flightTitle').textContent = f.date || '飞行记录';
  $('flightMeta').textContent = `${f.name} · ${f.source === 'public' ? '公开记录' : '本机记录'}`;
  $('sourceBadge').textContent = f.source === 'public' ? '公开' : '本机';
  $('emptyState').hidden = true;
  $('viewportTitle').hidden = false;
  $('viewportTitle').textContent = `Thomas Young | ${f.date || '—'} | 3D flight & circling replay`;
  $('hud').hidden = false;
  $('legend3d').hidden = false;
  $('playBtn').disabled = false;
  $('pauseBtn').disabled = true;
  $('resetBtn').disabled = false;
  $('seek').disabled = false;
  $('speed').disabled = false;
  $('recordBtn').disabled = false;
  $('seek').max = String(f.fix.length - 1);
  $('seek').value = '0';
  renderSeekTicks(f);
  renderDetails(f);
  buildScene(f);
  setIndex(0);
  renderList();
}

function renderDetails(f) {
  const s = f.stats;
  $('maxAlt').textContent = `${fmt(s.maxAlt)} m`;
  $('duration').textContent = fmtDuration(s.duration);
  $('distance').textContent = `${fmt(s.distance / 1000, 1)} km`;
  $('gain').textContent = `${fmt(s.gain)} m`;
  $('nCircles').textContent = String(s.nCircles);
  $('fixes').textContent = String(f.fix.length);
  $('circleInfo').textContent = s.nCircles ? '自动识别 · 实验性' : '未识别到完整圈';
  const tbody = $('circleRows');
  tbody.innerHTML = '';
  if (!f.circles.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4; td.textContent = '这条轨迹没有完整盘旋圈';
    tr.appendChild(td); tbody.appendChild(tr);
  } else {
    f.circles.slice(0, 40).forEach((c, i) => {
      const tr = document.createElement('tr');
      [i + 1, Math.round(c.duration), Math.round(c.gain), c.rate.toFixed(2)].forEach(v => {
        const td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }
}

function renderSeekTicks(f) {
  const el = $('seekTicks');
  el.replaceChildren();
  if (!f) return;
  const total = Math.max(0, (f.fix[f.fix.length - 1].t - f.fix[0].t) / 60);
  const count = 8;
  for (let i = 0; i <= count; i++) {
    const span = document.createElement('span');
    span.textContent = Math.round(total * i / count) + 'm';
    el.appendChild(span);
  }
}

function clearStage() {
  state.current = null;
  $('flightTitle').textContent = '三维彩色轨迹回放';
  $('flightMeta').textContent = '选择左侧的一条飞行记录，或导入新的 IGC。';
  $('sourceBadge').textContent = '—';
  $('emptyState').hidden = false;
  $('viewportTitle').hidden = true;
  $('hud').hidden = true;
  $('legend3d').hidden = true;
  $('playBtn').disabled = true;
  $('pauseBtn').disabled = true;
  $('resetBtn').disabled = true;
  $('seek').disabled = true;
  $('speed').disabled = true;
  $('recordBtn').disabled = true;
  $('seek').value = '0';
  $('seekTicks').replaceChildren();
  ['maxAlt','duration','distance','gain','nCircles','fixes'].forEach(id => $(id).textContent = '—');
  $('circleInfo').textContent = '—';
  $('circleRows').innerHTML = '<tr><td colspan="4">选择飞行后显示</td></tr>';
  drawTelemetry(null, 0);
  if (pathGroup) pathGroup.clear();
  if (currentMarker) currentMarker.visible = false;
  if (currentLine) currentLine.visible = false;
}

/* ---------- three.js ---------- */
function initScene() {
  if (typeof THREE === 'undefined' || typeof THREE.OrbitControls === 'undefined') {
    $('emptyState').innerHTML = '<strong>3D 渲染库未加载</strong><span>请检查网络后刷新页面。</span>';
    return;
  }
  const host = $('view');
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x02060a, 0.012);
  camera = new THREE.PerspectiveCamera(40, host.clientWidth / host.clientHeight, 0.1, 200);
  camera.position.set(19, 14, 22);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.setClearColor(0x02060a, 0);
  renderer.outputEncoding = THREE.sRGBEncoding;
  host.appendChild(renderer.domElement);
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 7;
  controls.maxDistance = 62;
  controls.target.set(0, 3.8, 0);
  controls.autoRotateSpeed = 0.55;

  scene.add(new THREE.HemisphereLight(0xbde7ff, 0x162b28, 1.05));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(8, 18, 10); scene.add(key);
  const fill = new THREE.DirectionalLight(0x52b7b1, 0.45);
  fill.position.set(-12, 6, -8); scene.add(fill);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 34),
    new THREE.MeshBasicMaterial({ color: 0x02080c, transparent: true, opacity: 0.78 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  scene.add(ground);

  const addGrid = (size, divisions, color, opacity, rotation, position) => {
    const g = new THREE.GridHelper(size, divisions, color, color);
    g.rotation.set(rotation[0], rotation[1], rotation[2]);
    g.position.set(position[0], position[1], position[2]);
    g.material.transparent = true;
    g.material.opacity = opacity;
    g.material.depthWrite = false;
    scene.add(g);
    return g;
  };
  addGrid(24, 12, 0x2b4d56, 0.62, [0, 0, 0], [0, 0.01, 0]);
  addGrid(24, 12, 0x24454e, 0.34, [Math.PI / 2, 0, 0], [0, 6, -12]);
  addGrid(24, 12, 0x24454e, 0.30, [0, 0, Math.PI / 2], [-12, 6, 0]);

  const northLabel = makeTextSprite('North (m)', '#e4eef0', 1.15);
  northLabel.position.set(0, 0.35, -10.6); scene.add(northLabel);
  const eastLabel = makeTextSprite('East (m)', '#a9bcc1', 1.05);
  eastLabel.position.set(13.4, 0.22, 0); scene.add(eastLabel);
  const altLabel = makeTextSprite('GPS altitude (m)', '#a9bcc1', 1.05);
  altLabel.position.set(-13.4, 4.6, 0); scene.add(altLabel);

  pathGroup = new THREE.Group();
  scene.add(pathGroup);

  currentMarker = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.20, 18, 18), new THREE.MeshBasicMaterial({ color: 0xffb21a }));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(), color: 0xffb21a, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  halo.scale.set(1.8, 1.8, 1);
  currentMarker.add(core, halo);
  currentMarker.visible = false;
  scene.add(currentMarker);

  currentLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  currentLine = new THREE.Line(currentLineGeo, new THREE.LineBasicMaterial({ color: 0xffb21a, transparent: true, opacity: 0.42 }));
  currentLine.visible = false;
  scene.add(currentLine);

  renderer.domElement.addEventListener('dblclick', resetCamera);
  resizeObserver = new ResizeObserver(resizeScene);
  resizeObserver.observe(host);
  window.addEventListener('resize', resizeScene);
  sceneReady = true;
  renderer.setAnimationLoop(animate);
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(150,255,237,.75)');
  grad.addColorStop(1, 'rgba(80,220,210,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function makeTextSprite(text, color, scale) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = '500 28px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(text).width) + 24;
  c.width = width; c.height = 52;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, 27);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false,
  }));
  sprite.scale.set((width / 52) * scale, scale, 1);
  sprite.renderOrder = 20;
  return sprite;
}

function resizeScene() {
  if (!sceneReady || !renderer || !camera) return;
  const host = $('view');
  camera.aspect = host.clientWidth / host.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(host.clientWidth, host.clientHeight);
}

function resetCamera() {
  if (!sceneReady) return;
  camera.position.set(19, 14, 22);
  controls.target.set(0, 3.8, 0);
  controls.update();
}

function clearPath() {
  if (!pathGroup) return;
  pathGroup.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material.dispose();
    }
  });
  pathGroup.clear();
}

function modeColor(mode) {
  return new THREE.Color(mode ? 0x19d38a : 0x3b9cff).convertSRGBToLinear();
}

function buildScene(f) {
  if (!sceneReady) return;
  clearPath();
  const fix = f.fix;
  const lat0 = fix.reduce((s, p) => s + p.lat, 0) / fix.length;
  const lon0 = fix.reduce((s, p) => s + p.lon, 0) / fix.length;
  const minAlt = Math.min(...fix.map(p => p.alt));
  const maxAlt = Math.max(...fix.map(p => p.alt));
  const raw = fix.map(p => ({
    x: (p.lon - lon0) * 111320 * Math.cos(lat0 * Math.PI / 180),
    z: -(p.lat - lat0) * 110540,
    y: p.alt - minAlt,
    climb: p.climb,
  }));
  const xs = raw.map(p => p.x), zs = raw.map(p => p.z);
  const span = Math.max(500, Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  const hs = 21 / span;
  const vs = 9.2 / Math.max(250, maxAlt - minAlt);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cz = (Math.max(...zs) + Math.min(...zs)) / 2;
  f.scenePoints = raw.map(p => new THREE.Vector3((p.x - cx) * hs, p.y * vs + 0.08, (p.z - cz) * hs));

  const step = Math.max(1, Math.ceil(f.scenePoints.length / 620));
  const sample = [];
  for (let i = 0; i < f.scenePoints.length; i += step) sample.push({ p: f.scenePoints[i], mode: fix[i].mode });
  if (sample[sample.length - 1].p !== f.scenePoints[f.scenePoints.length - 1]) {
    sample.push({ p: f.scenePoints[f.scenePoints.length - 1], mode: fix[fix.length - 1].mode });
  }
  if (sample.length < 2) return;

  const curve = new THREE.CatmullRomCurve3(sample.map(s => s.p), false, 'centripetal', 0.5);
  const tubular = Math.min(760, Math.max(100, sample.length * 2));
  const radial = 6;
  const geo = new THREE.TubeGeometry(curve, tubular, 0.10, radial, false);
  const colors = new Float32Array(geo.attributes.position.count * 3);
  const per = radial + 1;
  for (let i = 0; i < geo.attributes.position.count; i++) {
    const seg = Math.min(tubular, Math.floor(i / per));
    const idx = Math.min(sample.length - 1, Math.round(seg / tubular * (sample.length - 1)));
    const c = modeColor(sample[idx].mode);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  pathGroup.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true })));
  const glowGeo = new THREE.TubeGeometry(curve, tubular, 0.19, radial, false);
  glowGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  pathGroup.add(new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.06,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })));

  const shadowPts = f.scenePoints.map(p => new THREE.Vector3(p.x, 0.012, p.z));
  pathGroup.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(shadowPts),
    new THREE.LineBasicMaterial({ color: 0x245b78, transparent: true, opacity: 0.42 })
  ));

  const drops = [];
  const dropStep = Math.max(1, Math.floor(f.scenePoints.length / 22));
  for (let i = 0; i < f.scenePoints.length; i += dropStep) {
    const p = f.scenePoints[i];
    drops.push(p.x, 0.015, p.z, p.x, p.y, p.z);
  }
  pathGroup.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(drops, 3)),
    new THREE.LineBasicMaterial({ color: 0x2b5b6b, transparent: true, opacity: 0.16 })
  ));

  addMarker(f.scenePoints[0], 0x3b9cff, 0.14);
  addMarker(f.scenePoints[f.scenePoints.length - 1], 0xffb21a, 0.16);

  for (let k = 1; k <= 5; k++) {
    const i = Math.min(f.scenePoints.length - 2, Math.floor((f.scenePoints.length - 1) * k / 6));
    const p = f.scenePoints[i], q = f.scenePoints[i + 1];
    const tangent = q.clone().sub(p).normalize();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.105, 0.3, 6), new THREE.MeshBasicMaterial({ color: 0xd8fff4 }));
    cone.position.copy(p);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    pathGroup.add(cone);
  }

  currentMarker.visible = true;
  currentLine.visible = true;
  $('emptyState').hidden = true;
  camera.position.set(19, 14, 22);
  controls.target.set(0, 3.8, 0);
  controls.update();
}

function addMarker(p, color, radius) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 14, 14), new THREE.MeshBasicMaterial({ color }));
  m.position.copy(p);
  pathGroup.add(m);
}

function currentPosition(index) {
  const f = state.current;
  if (!f || !f.scenePoints.length) return null;
  const i = clamp(index, 0, f.scenePoints.length - 1);
  const i0 = Math.floor(i), i1 = Math.min(f.scenePoints.length - 1, i0 + 1);
  const a = f.scenePoints[i0], b = f.scenePoints[i1];
  return a.clone().lerp(b, i - i0);
}

function updateMarker() {
  if (!sceneReady || !state.current) return;
  const p = currentPosition(state.index);
  if (!p) return;
  currentMarker.position.copy(p);
  currentLineGeo.setFromPoints([new THREE.Vector3(p.x, 0.02, p.z), p]);
}

function animate() {
  if (!sceneReady) return;
  if (controls) controls.update();
  if (state.current && state.recording) {
    const t = Math.min(1, (performance.now() - recordStart) / 12000);
    setIndex(t * (state.current.fix.length - 1));
    if (t >= 1) stopRecording();
  } else if (state.current && state.playing) {
    const f = state.current;
    const targetT = state.playT0 + (performance.now() - state.playStart) / 1000 * state.speed;
    if (targetT >= f.fix[f.fix.length - 1].t) {
      setIndex(f.fix.length - 1);
      pause();
    } else {
      setIndex(indexAtTime(f, targetT));
    }
  }
  renderer.render(scene, camera);
  if (state.recording) drawVideoFrame();
}

function indexAtTime(f, t) {
  let lo = 0, hi = f.fix.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (f.fix[mid].t <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/* ---------- playback ---------- */
function setIndex(value) {
  if (!state.current) return;
  const max = state.current.fix.length - 1;
  const i = clamp(value, 0, max);
  state.index = i;
  const p = state.current.fix[Math.round(i)];
  $('hudAlt').textContent = `${fmt(p.alt)} m`;
  $('hudSpeed').textContent = `${fmt(p.speed, 1)} km/h`;
  $('hudClimb').textContent = `${p.climb >= 0 ? '+' : ''}${fmt(p.climb, 2)} m/s`;
  $('seek').value = String(i);
  $('clock').textContent = fmtClock(p.t);
  updateMarker();
  const rounded = Math.round(i);
  if (rounded !== state.lastChart) {
    state.lastChart = rounded;
    drawTelemetry(state.current, i);
  }
}

function pause() {
  state.playing = false;
  const play = $('playBtn'), pause = $('pauseBtn');
  if (play) play.textContent = '▶ 播放';
  if (pause) pause.disabled = true;
}

function startPlay() {
  if (!state.current || state.recording || state.playing) return;
  if (state.index >= state.current.fix.length - 1) state.index = 0;
  state.playT0 = state.current.fix[Math.round(state.index)].t;
  state.playStart = performance.now();
  state.playing = true;
  $('playBtn').textContent = '▶ 播放';
  $('pauseBtn').disabled = false;
}

/* ---------- telemetry chart ---------- */
function drawTelemetry(f, index) {
  const canvas = $('telemetryCanvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.max(320, canvas.clientWidth), H = Math.max(180, canvas.clientHeight || 260);
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fffdf7';
  ctx.fillRect(0, 0, W, H);
  if (!f) {
    ctx.fillStyle = '#8a9389';
    ctx.font = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('导入 IGC 后显示高度、地速与爬升率剖面', W / 2, H / 2);
    return;
  }
  const m = { l: 42, r: 44, t: 16, b: 44 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const t0 = f.fix[0].t, duration = Math.max(1, f.fix[f.fix.length - 1].t - t0);
  const minAlt = Math.min(...f.fix.map(p => p.alt)), maxAlt = Math.max(...f.fix.map(p => p.alt));
  const aPad = Math.max(50, (maxAlt - minAlt) * 0.1);
  const aMin = minAlt - aPad, aMax = maxAlt + aPad;
  const maxSpeed = Math.max(20, ...f.fix.map(p => p.speed)) * 1.1;
  const X = t => m.l + (t - t0) / duration * iw;
  const Y = a => m.t + (1 - (a - aMin) / (aMax - aMin)) * ih;
  const S = s => m.t + (1 - s / maxSpeed) * ih;

  ctx.strokeStyle = '#e8e8dc';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = m.t + ih * i / 4;
    ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(W - m.r, y); ctx.stroke();
    ctx.fillStyle = '#8a9389';
    ctx.font = '10px ui-monospace, SFMono-Regular, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(String(Math.round(aMax - (aMax - aMin) * i / 4)), m.l - 7, y + 3);
    ctx.textAlign = 'left';
    ctx.fillText(String(Math.round(maxSpeed * (1 - i / 4))), W - m.r + 7, y + 3);
  }
  ctx.strokeStyle = '#c9c9bb';
  ctx.beginPath(); ctx.moveTo(m.l, m.t); ctx.lineTo(m.l, H - m.b); ctx.lineTo(W - m.r, H - m.b); ctx.stroke();

  const step = Math.max(1, Math.ceil(f.fix.length / Math.max(1, iw)));
  const sample = [];
  for (let i = 0; i < f.fix.length; i += step) sample.push(f.fix[i]);
  if (sample[sample.length - 1] !== f.fix[f.fix.length - 1]) sample.push(f.fix[f.fix.length - 1]);

  const grad = ctx.createLinearGradient(0, m.t, 0, H - m.b);
  grad.addColorStop(0, 'rgba(47,90,76,.22)');
  grad.addColorStop(1, 'rgba(47,90,76,.01)');
  ctx.beginPath();
  sample.forEach((p, i) => { const x = X(p.t), y = Y(p.alt); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.lineTo(X(sample[sample.length - 1].t), H - m.b);
  ctx.lineTo(X(sample[0].t), H - m.b);
  ctx.closePath(); ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath();
  sample.forEach((p, i) => { const x = X(p.t), y = Y(p.alt); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.strokeStyle = '#2f5a4c'; ctx.lineWidth = 2; ctx.stroke();

  ctx.beginPath();
  sample.forEach((p, i) => { const x = X(p.t), y = S(p.speed); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.strokeStyle = '#e3a34e'; ctx.lineWidth = 1.5; ctx.stroke();

  const base = H - 27;
  ctx.strokeStyle = '#dedfd3'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(m.l, base); ctx.lineTo(W - m.r, base); ctx.stroke();
  for (let i = 0; i < sample.length; i++) {
    const p = sample[i];
    const v = clamp(p.climb * 4, -8, 8);
    ctx.fillStyle = p.climb >= 0 ? 'rgba(88,184,105,.55)' : 'rgba(218,112,86,.55)';
    ctx.fillRect(X(p.t) - 0.8, v >= 0 ? base - v : base, 1.6, Math.abs(v));
  }

  const cur = f.fix[clamp(Math.round(index), 0, f.fix.length - 1)];
  const cx = X(cur.t);
  ctx.strokeStyle = '#a35c3d'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.moveTo(cx, m.t); ctx.lineTo(cx, H - m.b); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#a35c3d';
  ctx.beginPath(); ctx.arc(cx, Y(cur.alt), 3.5, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = '#8a9389';
  ctx.font = '10px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('m', m.l, H - 8);
  ctx.textAlign = 'right';
  ctx.fillText('km/h', W - m.r, H - 8);
  ctx.textAlign = 'center';
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const t = duration * i / ticks;
    ctx.fillText((t / 60).toFixed(0) + '′', X(t0 + t), H - 8);
  }
}

/* ---------- recording ---------- */
function drawVideoFrame() {
  if (!recordCtx || !state.current || !renderer) return;
  const W = recordCanvas.width, H = recordCanvas.height;
  const ctx = recordCtx;
  ctx.fillStyle = '#02060a';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(renderer.domElement, 0, 0, W, H);
  const pad = Math.round(W * 0.026);
  const titleSize = Math.max(13, Math.round(W / 62));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `500 ${titleSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillStyle = '#edf5f6';
  ctx.fillText(`Thomas Young | ${state.current.date} | 3D flight & circling replay`, pad, pad);

  const legend = [['滑翔 / 其他', '#4da3ff'], ['盘旋候选', '#19d38a'], ['当前位置', '#ffb21a']];
  const legendSize = Math.max(11, Math.round(W / 92));
  ctx.font = `500 ${legendSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  let ly = pad + legendSize / 2;
  for (const [label, color] of legend) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(W - pad - 8, ly, Math.max(3, legendSize * 0.28), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#dfecee';
    ctx.fillText(label, W - pad - 18, ly);
    ly += legendSize + 12;
  }

  const p = state.current.fix[Math.round(state.index)] || state.current.fix[0];
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.font = `500 ${legendSize}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  ctx.fillStyle = '#cfe1e3';
  ctx.fillText(`${Math.round(p.alt)} m  ·  ${p.speed.toFixed(1)} km/h  ·  ${p.climb >= 0 ? '+' : ''}${p.climb.toFixed(2)} m/s`, pad, H - pad);
}

function stopRecording() {
  if (!state.recording || !mediaRecorder) return;
  state.recording = false;
  try { mediaRecorder.stop(); } catch (_) {}
  $('recordBtn').textContent = '● 下载 3D 视频';
  $('recordBtn').disabled = false;
  if (controls) controls.autoRotate = recordAutoRotate;
}

function recordVideo() {
  if (!state.current || state.recording) return;
  if (!renderer || !window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    setStatus('当前浏览器不支持 canvas 视频录制，请使用 Chrome / Edge。');
    return;
  }
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mime = types.find(t => MediaRecorder.isTypeSupported(t));
  if (!mime) { setStatus('当前浏览器没有可用的 WebM 录制编码。'); return; }
  recordCanvas = document.createElement('canvas');
  recordCanvas.width = renderer.domElement.width;
  recordCanvas.height = renderer.domElement.height;
  recordCtx = recordCanvas.getContext('2d');
  renderer.render(scene, camera);
  drawVideoFrame();
  const stream = recordCanvas.captureStream(30);
  const chunks = [];
  try {
    mediaRecorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
  } catch (err) {
    setStatus('无法启动录制：' + err.message);
    return;
  }
  mediaRecorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const blob = new Blob(chunks, { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safe = (state.current?.date || 'flight').replace(/[^0-9A-Za-z-]/g, '-');
    a.href = url; a.download = `flight-${safe}-3d.webm`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    recordCanvas = null;
    recordCtx = null;
    setStatus('3D 视频已生成并开始下载。', 'ok');
  };
  pause();
  state.index = 0;
  setIndex(0);
  recordAutoRotate = controls.autoRotate;
  controls.autoRotate = true;
  recordStart = performance.now();
  state.recording = true;
  mediaRecorder.start(100);
  $('recordBtn').textContent = '● 录制中…';
  $('recordBtn').disabled = true;
  setStatus('正在录制 12 秒 3D 回放…');
}

/* ---------- wire up ---------- */
function wire() {
  $('pickBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('dragover'); }));
  drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));
  $('search').addEventListener('input', e => { state.query = e.target.value; renderList(); });
  document.querySelectorAll('[data-filter]').forEach(btn => btn.addEventListener('click', () => {
    state.filter = btn.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b === btn));
    renderList();
  }));
  $('playBtn').addEventListener('click', startPlay);
  $('pauseBtn').addEventListener('click', pause);
  $('resetBtn').addEventListener('click', () => { pause(); setIndex(0); });
  $('seek').addEventListener('input', e => { pause(); setIndex(Number(e.target.value)); });
  $('speed').addEventListener('change', e => { state.speed = Number(e.target.value); });
  $('rotateBtn').addEventListener('click', () => {
    if (!controls) return;
    controls.autoRotate = !controls.autoRotate;
    $('rotateBtn').setAttribute('aria-pressed', String(controls.autoRotate));
    $('rotateBtn').textContent = controls.autoRotate ? '停止旋转' : '自动旋转';
  });
  $('viewBtn').addEventListener('click', resetCamera);
  $('recordBtn').addEventListener('click', recordVideo);
  $('exportBtn').addEventListener('click', exportLocal);
  $('telemetryCanvas').addEventListener('pointermove', e => {
    if (!state.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = clamp(e.clientX - r.left, 42, r.width - 44);
    const ratio = (x - 42) / Math.max(1, r.width - 86);
    pause();
    setIndex(ratio * (state.current.fix.length - 1));
  });
  window.addEventListener('resize', () => drawTelemetry(state.current, state.index));
}

async function exportLocal() {
  const local = state.flights.filter(f => f.source === 'local' && f.text);
  if (!local.length) { setStatus('没有可导出的本机 IGC。'); return; }
  if (typeof JSZip === 'undefined') { setStatus('ZIP 库未加载，无法导出。'); return; }
  const zip = new JSZip();
  local.forEach(f => zip.file(f.name.replace(/[\\/:*?"<>|]/g, '_'), f.text));
  zip.file('README.txt', '本文件由 Thomas Young Paragliding Flight Lab 导出。\n仅包含当前浏览器中保存的 IGC 记录。\n');
  try {
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'flight-lab-local-igc.zip'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    setStatus(`已导出 ${local.length} 条本机记录。`, 'ok');
  } catch (err) { setStatus('导出失败：' + err.message); }
}

async function boot() {
  initScene();
  wire();
  drawTelemetry(null, 0);
  await Promise.all([loadPublished(), loadLocal()]);
  renderList();
  if (state.flights.length) {
    selectFlight(state.flights[0]);
  } else {
    setStatus('导入一个 IGC 或 ZIP 开始；也可以把 IGC 发布到 flight-data/igc/。');
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
