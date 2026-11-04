(() => {
'use strict';
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rad = Math.PI / 180;
const deg = 180 / Math.PI;

let polar = [];
let bestLD = null;
let alpha0 = null;

async function loadPolar() {
  try {
    const res = await fetch('flight-data/xfoil-naca2412-re300k.csv', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    polar = text.trim().split(/\r?\n/).slice(1).map(line => {
      const c = line.split(',');
      return { alpha: +c[0], cl: +c[1], cd: +c[2], cm: +c[3], ld: +c[4] };
    }).filter(r => Number.isFinite(r.alpha) && Number.isFinite(r.cl) && Number.isFinite(r.cd)).sort((a, b) => a.alpha - b.alpha);
    bestLD = polar.reduce((a, r) => (r.ld > a.ld ? r : a), polar[0]);
    for (let i = 0; i < polar.length - 1; i++) {
      const a = polar[i], b = polar[i + 1];
      if ((a.cl <= 0 && b.cl >= 0) || (a.cl >= 0 && b.cl <= 0)) {
        const t = Math.abs(a.cl) / (Math.abs(a.cl) + Math.abs(b.cl) || 1);
        alpha0 = a.alpha + (b.alpha - a.alpha) * t;
        break;
      }
    }
    const clmax = polar.reduce((a, r) => (r.cl > a.cl ? r : a), polar[0]);
    $('statClmax').textContent = clmax.cl.toFixed(3);
    $('statClmaxAlpha').textContent = `α = ${clmax.alpha.toFixed(1)}°`;
    $('statLdmax').textContent = bestLD.ld.toFixed(1);
    $('statLdmaxAlpha').textContent = `α = ${bestLD.alpha.toFixed(1)}°`;
    $('statAlpha0').textContent = alpha0 === null ? '—' : `${alpha0.toFixed(2)}°`;
    drawPolar('cl');
    initSim();
  } catch (err) {
    $('polarCaption').textContent = 'XFOIL 数据加载失败：' + err.message + '（请通过本地服务器或 GitHub Pages 打开）';
    initSim();
  }
}

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawPolar(metric) {
  const canvas = $('polarChart');
  if (!canvas) return;
  const host = canvas.parentElement;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(320, host.clientWidth - 20);
  const H = 390;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fbfaf3';
  ctx.fillRect(0, 0, W, H);
  const m = { l: 52, r: 48, t: 20, b: 40 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const green = '#2f5a4c', amber = '#b57a37', grid = '#e3e5d9', ink = '#536158';
  ctx.font = '10px system-ui,-apple-system,"Segoe UI",sans-serif';
  if (!polar.length) {
    ctx.fillStyle = '#8a9389'; ctx.textAlign = 'center';
    ctx.fillText('等待 XFOIL 数据…', W / 2, H / 2);
    return;
  }

  let xa, xb, ya, yb, xvals, yvals, xlabel, ylabel, points;
  if (metric === 'cd') {
    xa = -0.3; xb = 1.4; ya = 0; yb = 0.07;
    xvals = polar.map(r => r.cl); yvals = polar.map(r => r.cd); points = polar;
    xlabel = 'C_L'; ylabel = 'C_D';
  } else if (metric === 'ld') {
    xa = -4; xb = 14; ya = -20; yb = 85;
    xvals = polar.map(r => r.alpha); yvals = polar.map(r => r.ld); points = polar;
    xlabel = '迎角 α (°)'; ylabel = 'L / D';
  } else {
    xa = -4; xb = 14; ya = -0.4; yb = 1.5;
    xvals = polar.map(r => r.alpha); yvals = polar.map(r => r.cl); points = polar;
    xlabel = '迎角 α (°)'; ylabel = 'C_L';
  }
  const X = v => m.l + (v - xa) / (xb - xa) * iw;
  const Y = v => m.t + (1 - (v - ya) / (yb - ya)) * ih;

  ctx.strokeStyle = grid; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = m.t + ih * i / 4;
    ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(W - m.r, y); ctx.stroke();
    ctx.fillStyle = '#8a9389'; ctx.textAlign = 'right';
    ctx.fillText((yb - (yb - ya) * i / 4).toFixed(metric === 'cd' ? 3 : 1), m.l - 7, y + 3);
  }
  for (let i = 0; i <= 5; i++) {
    const x = m.l + iw * i / 5;
    ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, H - m.b); ctx.stroke();
    ctx.fillStyle = '#8a9389'; ctx.textAlign = 'center';
    ctx.fillText((xa + (xb - xa) * i / 5).toFixed(metric === 'cd' ? 1 : 0), x, H - 20);
  }
  ctx.strokeStyle = '#bfc9b9';
  ctx.beginPath(); ctx.moveTo(m.l, m.t); ctx.lineTo(m.l, H - m.b); ctx.lineTo(W - m.r, H - m.b); ctx.stroke();

  if (metric === 'cl' || metric === 'ld') {
    ctx.fillStyle = '#8a9389'; ctx.textAlign = 'center';
    ctx.fillText(xlabel, m.l + iw / 2, H - 5);
    ctx.save(); ctx.translate(13, m.t + ih / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(ylabel, 0, 0); ctx.restore();
  } else {
    ctx.fillStyle = '#8a9389'; ctx.textAlign = 'center';
    ctx.fillText(xlabel, m.l + iw / 2, H - 5);
    ctx.save(); ctx.translate(13, m.t + ih / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(ylabel, 0, 0); ctx.restore();
  }

  // zero reference lines
  if (ya < 0 && yb > 0) {
    ctx.strokeStyle = '#c7cbbd'; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(m.l, Y(0)); ctx.lineTo(W - m.r, Y(0)); ctx.stroke(); ctx.setLineDash([]);
  }

  // line
  ctx.beginPath();
  let started = false;
  points.forEach((p, i) => {
    const x = X(metric === 'cd' ? p.cl : p.alpha);
    const y = Y(metric === 'cd' ? p.cd : (metric === 'ld' ? p.ld : p.cl));
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = green; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();

  // points
  points.forEach(p => {
    const x = X(metric === 'cd' ? p.cl : p.alpha);
    const y = Y(metric === 'cd' ? p.cd : (metric === 'ld' ? p.ld : p.cl));
    ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fillStyle = '#fbfaf3'; ctx.fill();
    ctx.strokeStyle = green; ctx.lineWidth = 1.2; ctx.stroke();
  });

  // annotate best L/D in ld mode
  if (metric === 'ld' && bestLD) {
    const x = X(bestLD.alpha), y = Y(bestLD.ld);
    ctx.fillStyle = amber;
    ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8b5c2c'; ctx.textAlign = 'left';
    ctx.fillText(`max L/D ${bestLD.ld.toFixed(1)} @ ${bestLD.alpha.toFixed(1)}°`, x + 8, y - 8);
  }
  if (metric === 'cl') {
    const clmax = polar.reduce((a, r) => (r.cl > a.cl ? r : a), polar[0]);
    const x = X(clmax.alpha), y = Y(clmax.cl);
    ctx.fillStyle = amber;
    ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8b5c2c'; ctx.textAlign = 'right';
    ctx.fillText(`C_Lmax ${clmax.cl.toFixed(2)}`, x - 8, y + 14);
  }

  const legend = $('polarLegend');
  legend.innerHTML = metric === 'cd'
    ? '<span><i class="legend-line"></i>NACA 2412 阻力极曲线</span><span><i class="legend-dot"></i>XFOIL 数据点</span>'
    : metric === 'ld'
      ? '<span><i class="legend-line"></i>升阻比 L/D</span><span><i class="legend-dot"></i>最大 L/D</span>'
      : '<span><i class="legend-line"></i>升力系数 C_L</span><span><i class="legend-dot"></i>C_Lmax</span>';
  const captions = {
    cl: '横轴为迎角 α（°），纵轴为升力系数 C_L。数据由 XFOIL 6.99 计算：NACA 2412，Re = 3.0×10⁵，Ncrit = 9。',
    ld: '横轴为迎角，纵轴为二维升阻比 L/D。二维最大 L/D 不代表整伞滑翔比；整伞还受绳阻、三维尾涡和柔性变形影响。',
    cd: '阻力极曲线：横轴 C_L，纵轴 C_D。低阻“桶底”对应较好的巡航迎角；高 C_L 端阻力迅速上升。'
  };
  $('polarCaption').textContent = captions[metric];
}

function initPolarTabs() {
  document.querySelectorAll('.polar-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.polar-tab').forEach(b => b.classList.toggle('active', b === btn));
      drawPolar(btn.dataset.metric);
    });
  });
  window.addEventListener('resize', () => {
    const active = document.querySelector('.polar-tab.active');
    drawPolar(active ? active.dataset.metric : 'cl');
  });
}

/* ---------- simplified 6DOF ---------- */
const sim = {
  running: true,
  t: 0,
  pos: { x: 0, y: 0, z: 500 },
  vel: { x: 10, y: 0, z: 0 },
  q: [Math.cos(0.0275), 0, Math.sin(0.0275), 0],
  omega: { x: 0, y: 0, z: 0 },
  controls: { brake: 0, speed: 0, turn: 0 },
  trail: [],
  status: 'flying',
  lastTrail: 0,
  lastFrame: 0,
  gustTimer: 0,
};
let simReady = false;

const qMul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
const qNorm = q => {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return q.map(v => v / n);
};
const qRotate = (q, v) => {
  const [w, x, y, z] = q;
  const vx = v[0], vy = v[1], vz = v[2];
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
};
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const norm3 = v => Math.hypot(v[0], v[1], v[2]);
const lerpPolar = (alphaDeg, key) => {
  if (!polar.length) return key === 'cl' ? 0.6 : 0.04;
  const a = clamp(alphaDeg, polar[0].alpha, polar[polar.length - 1].alpha);
  for (let i = 0; i < polar.length - 1; i++) {
    if (a >= polar[i].alpha && a <= polar[i + 1].alpha) {
      const t = (a - polar[i].alpha) / (polar[i + 1].alpha - polar[i].alpha || 1);
      return polar[i][key] + (polar[i + 1][key] - polar[i][key]) * t;
    }
  }
  return polar[polar.length - 1][key];
};

function resetSim() {
  sim.t = 0;
  sim.pos = { x: 0, y: 0, z: 500 };
  sim.vel = { x: 10, y: 0, z: 0 };
  sim.q = [Math.cos(0.0275), 0, Math.sin(0.0275), 0];
  sim.omega = { x: 0, y: 0, z: 0 };
  sim.controls = { brake: 0, speed: 0, turn: 0 };
  sim.trail = [{ x: 0, y: 0, z: 500 }];
  sim.lastTrail = 0;
  sim.status = 'flying';
  sim.running = true;
  $('brake').value = '0'; $('speedbar').value = '0'; $('turn').value = '0';
  $('brakeOut').textContent = '0%'; $('speedOut').textContent = '0%'; $('turnOut').textContent = '0';
  $('simPause').textContent = '暂停';
  const status = $('simStatus');
  status.textContent = '飞行中';
  status.classList.remove('landed');
}

function stepSim(dt) {
  if (!sim.running || sim.status !== 'flying') return;
  sim.t += dt;
  const c = sim.controls;
  const q = sim.q;
  const fwd = qRotate(q, [1, 0, 0]);
  const right = qRotate(q, [0, 1, 0]);
  const up = qRotate(q, [0, 0, 1]);
  const V = Math.max(0.5, norm3([sim.vel.x, sim.vel.y, sim.vel.z]));
  const gamma = Math.atan2(sim.vel.z, Math.hypot(sim.vel.x, sim.vel.y) || 1);
  const pitch = Math.asin(clamp(fwd[2], -1, 1));
  const roll = Math.atan2(right[2], up[2]);
  const yaw = Math.atan2(fwd[1], fwd[0]);
  const alpha = clamp(pitch - gamma, -0.18, 0.28);
  const alphaDeg = alpha * deg;
  let cl = lerpPolar(alphaDeg, 'cl') + c.brake * 0.13 - c.speed * 0.05;
  cl = clamp(cl, -0.25, 1.45);
  let cd = lerpPolar(alphaDeg, 'cd') + 0.036 + c.brake * 0.035 + c.speed * 0.006;
  cd = clamp(cd, 0.012, 0.16);
  const rho = 1.225, S = 25, mass = 100, g = 9.81;
  const qbar = 0.5 * rho * V * V * S;
  const lift = qbar * cl;
  const drag = qbar * cd;
  const vhat = [sim.vel.x / V, sim.vel.y / V, sim.vel.z / V];
  let fx = up[0] * lift - vhat[0] * drag;
  let fy = up[1] * lift - vhat[1] * drag;
  let fz = up[2] * lift - vhat[2] * drag - mass * g;
  if (sim.gustTimer > 0) {
    fx += 18; fz += 70;
    sim.gustTimer -= dt;
  }
  sim.vel.x += fx / mass * dt;
  sim.vel.y += fy / mass * dt;
  sim.vel.z += fz / mass * dt;
  sim.pos.x += sim.vel.x * dt;
  sim.pos.y += sim.vel.y * dt;
  sim.pos.z += sim.vel.z * dt;

  // attitude targets: pitch follows flight path + trimmed alpha, bank follows turn input
  const alphaTarget = 0.055 + c.brake * 0.085 - c.speed * 0.055;
  const pitchTarget = clamp(gamma + alphaTarget, -0.6, 0.85);
  const rollTarget = c.turn * 0.62;
  const yawTarget = Math.atan2(sim.vel.y, sim.vel.x) + c.turn * 0.03;
  const errPitch = wrap(pitchTarget - pitch);
  const errRoll = wrap(rollTarget - roll);
  const errYaw = wrap(yawTarget - yaw);
  const accPitch = clamp(3.3 * errPitch - 2.1 * sim.omega.y, -3, 3);
  const accRoll = clamp(4.0 * errRoll - 2.2 * sim.omega.x, -4, 4);
  const accYaw = clamp(1.4 * errYaw - 1.2 * sim.omega.z, -2, 2);
  sim.omega.y += accPitch * dt;
  sim.omega.x += accRoll * dt;
  sim.omega.z += accYaw * dt;
  sim.omega.x = clamp(sim.omega.x, -2.5, 2.5);
  sim.omega.y = clamp(sim.omega.y, -2.5, 2.5);
  sim.omega.z = clamp(sim.omega.z, -2.0, 2.0);
  const dq = qMul(q, [0, sim.omega.x, sim.omega.y, sim.omega.z]);
  sim.q = qNorm([
    q[0] + 0.5 * dq[0] * dt,
    q[1] + 0.5 * dq[1] * dt,
    q[2] + 0.5 * dq[2] * dt,
    q[3] + 0.5 * dq[3] * dt,
  ]);

  if (sim.pos.z <= 0) {
    sim.pos.z = 0;
    sim.status = 'landed';
    sim.running = false;
    $('simStatus').textContent = '接地 · 重置后再飞';
    $('simStatus').classList.add('landed');
  }
  if (sim.t - sim.lastTrail > 0.18) {
    sim.lastTrail = sim.t;
    sim.trail.push({ x: sim.pos.x, y: sim.pos.y, z: sim.pos.z });
    if (sim.trail.length > 700) sim.trail.shift();
  }
  updateSimReadouts(cl, cd, alpha, roll, gamma);
}

function updateSimReadouts(cl, cd, alpha, roll, gamma) {
  $('simAlt').textContent = Math.max(0, sim.pos.z).toFixed(0) + ' m';
  $('simSpeed').textContent = (norm3([sim.vel.x, sim.vel.y, sim.vel.z]) * 3.6).toFixed(1) + ' km/h';
  $('simClimb').textContent = (sim.vel.z >= 0 ? '+' : '') + sim.vel.z.toFixed(2) + ' m/s';
  $('simAlpha').textContent = (alpha * deg).toFixed(1) + '°';
  $('simBank').textContent = (roll * deg).toFixed(0) + '°';
  $('simLD').textContent = cd > 0 ? (cl / cd).toFixed(1) : '—';
}

function drawSim() {
  const canvas = $('simCanvas');
  if (!canvas || !canvas.parentElement) return;
  const host = canvas.parentElement;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(300, host.clientWidth), H = Math.max(320, host.clientHeight);
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const alt = Math.max(0, sim.pos.z);
  const x = sim.pos.x;
  const zMin = Math.max(0, alt - 80);
  const zMax = zMin + 230;
  const xMin = x - 120, xMax = x + 180;
  const mapX = v => (v - xMin) / (xMax - xMin) * W;
  const mapZ = v => H - ((v - zMin) / (zMax - zMin)) * H;

  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#071b26'); sky.addColorStop(0.55, '#0d2a34'); sky.addColorStop(1, '#163a40');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

  // altitude grid
  ctx.strokeStyle = 'rgba(120,180,180,.13)'; ctx.lineWidth = 1;
  ctx.font = '9px ui-monospace,SFMono-Regular,Consolas,monospace';
  const start = Math.ceil(zMin / 50) * 50;
  for (let a = start; a <= zMax; a += 50) {
    const y = mapZ(a);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.fillStyle = 'rgba(170,205,203,.5)';
    ctx.fillText(a + 'm', 8, y - 3);
  }
  // ground
  if (zMin <= 0) {
    const gy = mapZ(0);
    ctx.fillStyle = '#0a1717'; ctx.fillRect(0, gy, W, H - gy);
    ctx.strokeStyle = '#486c5f'; ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
  }

  // trail
  if (sim.trail.length > 1) {
    ctx.beginPath();
    sim.trail.forEach((p, i) => {
      const sx = mapX(p.x), sy = mapZ(p.z);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    });
    ctx.strokeStyle = 'rgba(93,206,190,.55)'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  // pilot and canopy
  const px = mapX(sim.pos.x), py = mapZ(sim.pos.z);
  const fwd = qRotate(sim.q, [1, 0, 0]);
  const right = qRotate(sim.q, [0, 1, 0]);
  const up = qRotate(sim.q, [0, 0, 1]);
  const pitch = Math.asin(clamp(fwd[2], -1, 1));
  const roll = Math.atan2(right[2], up[2]);
  const canopyScale = 0.92;
  const canopyX = px + fwd[0] * 4 * canopyScale;
  const canopyY = py + fwd[2] * 4 * canopyScale - 34 * canopyScale;
  ctx.save();
  ctx.translate(canopyX, canopyY);
  ctx.rotate(-pitch * 0.8);
  // lines
  ctx.strokeStyle = 'rgba(180,210,196,.55)'; ctx.lineWidth = 1;
  [[-52, 8], [-28, 4], [0, 3], [28, 4], [52, 8]].forEach(([lx, ly]) => {
    ctx.beginPath(); ctx.moveTo(lx * canopyScale, ly * canopyScale); ctx.lineTo(0, 34 * canopyScale); ctx.stroke();
  });
  // canopy arc
  ctx.beginPath();
  ctx.moveTo(-58 * canopyScale, 10 * canopyScale);
  ctx.quadraticCurveTo(0, -22 * canopyScale, 58 * canopyScale, 10 * canopyScale);
  ctx.quadraticCurveTo(0, 4 * canopyScale, -58 * canopyScale, 10 * canopyScale);
  ctx.fillStyle = '#1d584b'; ctx.fill();
  ctx.strokeStyle = '#67b9a4'; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.restore();

  // pilot
  ctx.fillStyle = '#e2b36d';
  ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(226,179,109,.6)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + 13); ctx.stroke();

  // velocity vector
  const V = Math.max(0.5, norm3([sim.vel.x, sim.vel.y, sim.vel.z]));
  const vx = sim.vel.x / V, vz = sim.vel.z / V;
  const vLen = 42;
  ctx.strokeStyle = 'rgba(235,248,244,.7)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + vx * vLen, py - vz * vLen); ctx.stroke();
  ctx.fillStyle = 'rgba(235,248,244,.75)';
  ctx.beginPath(); ctx.arc(px + vx * vLen, py - vz * vLen, 2.3, 0, Math.PI * 2); ctx.fill();

  // bank / turn readout in canvas
  ctx.fillStyle = 'rgba(210,235,230,.7)'; ctx.font = '10px ui-monospace,SFMono-Regular,Consolas,monospace';
  ctx.fillText(`α ${(Math.asin(clamp(fwd[2], -1, 1)) - Math.atan2(sim.vel.z, Math.hypot(sim.vel.x, sim.vel.y) || 1)) * deg >= 0 ? '+' : ''}${((Math.asin(clamp(fwd[2], -1, 1)) - Math.atan2(sim.vel.z, Math.hypot(sim.vel.x, sim.vel.y) || 1)) * deg).toFixed(1)}°`, 12, H - 32);
  ctx.fillText(`bank ${(roll * deg).toFixed(0)}°`, 12, H - 18);

  // mini map
  const mx = W - 126, my = 12, mw = 114, mh = 92;
  ctx.fillStyle = 'rgba(3,12,16,.62)'; ctx.fillRect(mx, my, mw, mh);
  ctx.strokeStyle = 'rgba(92,144,139,.45)'; ctx.strokeRect(mx + .5, my + .5, mw - 1, mh - 1);
  ctx.fillStyle = 'rgba(180,210,203,.55)'; ctx.font = '8px system-ui,sans-serif';
  ctx.fillText('TOP VIEW', mx + 6, my + 12);
  const span = 1400;
  const mapPoint = (p) => ({ x: mx + mw / 2 + p.x / span * mw, y: my + mh / 2 + p.y / span * mh });
  ctx.beginPath();
  sim.trail.forEach((p, i) => { const q = mapPoint(p); if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); });
  ctx.strokeStyle = 'rgba(93,206,190,.65)'; ctx.lineWidth = 1; ctx.stroke();
  const cp = mapPoint(sim.pos);
  ctx.fillStyle = '#e2b36d'; ctx.beginPath(); ctx.arc(cp.x, cp.y, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(180,210,203,.5)'; ctx.fillText('N', mx + mw - 12, my + 12);
}

function animateSim(now) {
  if (!simReady) return;
  const dt = Math.min(0.05, (now - (sim.lastFrame || now)) / 1000);
  sim.lastFrame = now;
  if (sim.running && dt > 0) {
    // 2 substeps for stability
    stepSim(dt / 2);
    if (sim.status === 'flying') stepSim(dt / 2);
  }
  drawSim();
  requestAnimationFrame(animateSim);
}

function initSim() {
  if (simReady) return;
  simReady = true;
  sim.trail = [{ x: 0, y: 0, z: 500 }];
  $('brake').addEventListener('input', e => {
    sim.controls.brake = +e.target.value / 100;
    $('brakeOut').textContent = e.target.value + '%';
  });
  $('speedbar').addEventListener('input', e => {
    sim.controls.speed = +e.target.value / 100;
    $('speedOut').textContent = e.target.value + '%';
  });
  $('turn').addEventListener('input', e => {
    sim.controls.turn = +e.target.value / 100;
    $('turnOut').textContent = e.target.value > 0 ? '右 ' + e.target.value + '%' : e.target.value < 0 ? '左 ' + Math.abs(e.target.value) + '%' : '直';
  });
  $('simGust').addEventListener('click', () => {
    if (sim.status !== 'flying') return;
    sim.vel.z += 2.8;
    sim.vel.x += 1.4;
    sim.gustTimer = 0.6;
  });
  $('simPause').addEventListener('click', () => {
    sim.running = !sim.running;
    $('simPause').textContent = sim.running ? '暂停' : '继续';
  });
  $('simReset').addEventListener('click', resetSim);
  requestAnimationFrame(animateSim);
}

document.addEventListener('DOMContentLoaded', () => {
  initPolarTabs();
  loadPolar();
});
})();
