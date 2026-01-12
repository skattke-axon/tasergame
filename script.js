// TASER — game.js (player + all enemies use PNG sprites)

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });

// HUD
const elScore = document.getElementById('score');
const elPoints = document.getElementById('points');
const elWave = document.getElementById('wave');
const elRemaining = document.getElementById('remaining');
const elBestWave = document.getElementById('bestWave');
const elHighScore = document.getElementById('highScore');
const elHealthFill = document.getElementById('healthFill');
const elHealthText = document.getElementById('healthText');
const elModeLabel = document.getElementById('modeLabel');
const waveRow = document.getElementById('waveRow');
const remainingRow = document.getElementById('remainingRow');

// Upgrades UI
const upgradeItems = document.getElementById('upgradeItems');
const ucPoints = document.getElementById('ucPoints');

// Bottom-right controls
const inputToggleBtn = document.getElementById('inputToggleBtn');
const modeToggleBtn = document.getElementById('modeToggleBtn');
const autoFireBtn = document.getElementById('autoFireBtn');

// Overlay UI
const overlay = document.getElementById('overlay');
const panelTitle = document.getElementById('panelTitle');
const panelSubtitle = document.getElementById('panelSubtitle');
const continueBtn = document.getElementById('continueBtn');
const restartBtn = document.getElementById('restartBtn');

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function dist2(ax, ay, bx, by){ const dx=ax-bx, dy=ay-by; return dx*dx + dy*dy; }
function rand(min, max){ return min + Math.random()*(max-min); }
function wrapAngle(a){
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}
function shortestAngleDiff(a, b){ return wrapAngle(b - a); }

// ------------------------------------------------------------
// Config
// ------------------------------------------------------------
const config = {
  boundaryInset: 28,
  boundaryThickness: 6,
  boundaryColor: '#ffd166',

  baseHP: 100,
  iFrames: 0.30,
  contactKnockback: 210,

  baseFireRate: 3.0,
  baseDamage: 16,
  baseBoltSpeed: 520,

  baseMoveSpeed: 280,
  turnAccel: 320.0,
  turnDamp: 14.0,
  maxAngVel: 9.5,

  safeSpawnRadius: 150,
  spawnEdgePadding: 14,

  // Waves
  waveEnemyBase: 26,
  waveEnemyGrowth: 5,
  spawnIntervalBase: 0.42,
  spawnIntervalMin: 0.14,

  // Endless
  endlessBaseSpawnInterval: 0.55,
  endlessMinSpawnInterval: 0.14,
  endlessSpawnAccel: 0.42,
  endlessHpScale: 0.95,
  endlessSpeedScale: 0.22,
  endlessEliteChance: 0.18,

  // Ability
  ringBlastPeriod: 15.0,
};

// ------------------------------------------------------------
// Runtime state
// ------------------------------------------------------------
let DPR = 1;
let W = 960, H = 540;
const bounds = { x: 28, y: 28, w: 900, h: 500 };

const keys = Object.create(null);
const mouse = { x:0, y:0, lmb:false, has:false };

const state = {
  uiMode: 'start', // start | playing | paused | intermission | gameover | win

  gameMode: localStorage.getItem('taser_gameMode') || 'waves', // waves | endless
  inputMode: localStorage.getItem('inputMode') || 'keyboardAim', // keyboardAim | mouseAim
  autoFire: (localStorage.getItem('autoFire') === '1'),

  wave: 1,
  score: 0,
  points: 0,

  totalToSpawn: 0,
  spawned: 0,
  spawnTimer: 0,
  endlessSpawnTimer: 0,

  bestWave: Number(localStorage.getItem('bestWave') || 1),
  highScore: Number(localStorage.getItem('highScore') || 0),
};

const player = {
  x: 0, y: 0, r: 18,
  angle: 0, angVel: 0,
  vx: 0, vy: 0,
  hpMax: config.baseHP,
  hp: config.baseHP,
  iTime: 0,
};

// ------------------------------------------------------------
// SPRITES (put these files next to game.js)
// ------------------------------------------------------------
function loadSprite(src){
  const img = new Image();
  const s = { img, loaded:false, src };
  img.src = src;
  img.onload = () => { s.loaded = true; };
  return s;
}

const PLAYER_SPRITE = loadSprite('taser.png');

const ENEMY_SPRITES = {
  grunt: loadSprite('grunt.png'),
  runner: loadSprite('runner.png'),
  brute: loadSprite('brute.png'),
  tank:  loadSprite('tank.png'),
  boss:  loadSprite('boss.png'),
};

// ------------------------------------------------------------
// Upgrades
// ------------------------------------------------------------
const upgrades = {
  fireRate:0, damage:0, boltSpeed:0, moveSpeed:0, spread:0, pierce:0,
  ringBlast:0,
};
function levelOf(id){ return upgrades[id] ?? 0; }

const shopItems = [
  { id:'fireRate',  name:'Fire Rate',  maxLevel:10, baseCost:18, costScale:1.38, apply(){ upgrades.fireRate++; } },
  { id:'damage',    name:'Damage',     maxLevel:12, baseCost:20, costScale:1.40, apply(){ upgrades.damage++; } },
  { id:'boltSpeed', name:'Bolt Speed', maxLevel:10, baseCost:14, costScale:1.34, apply(){ upgrades.boltSpeed++; } },
  { id:'moveSpeed', name:'Move Speed', maxLevel:10, baseCost:14, costScale:1.36, apply(){ upgrades.moveSpeed++; } },
  { id:'spread',    name:'Spread',     maxLevel:6,  baseCost:35, costScale:1.50, apply(){ upgrades.spread++; } },
  { id:'pierce',    name:'Pierce',     maxLevel:6,  baseCost:38, costScale:1.50, apply(){ upgrades.pierce++; } },
  { id:'ringBlast', name:'Ring Blast', maxLevel:7,  baseCost:120,costScale:1.60, apply(){ upgrades.ringBlast++; } },
];

function costOf(item){
  const lvl = levelOf(item.id);
  let cost = Math.floor(item.baseCost * Math.pow(item.costScale, lvl));
  if (item.id === 'ringBlast'){
    if (lvl >= 5) cost = Math.floor(cost * 2.6);
    if (lvl >= 6) cost = Math.floor(cost * 1.7);
  }
  return cost;
}

function stats(){
  return {
    fireRate: config.baseFireRate + upgrades.fireRate * 0.55,
    damage: config.baseDamage + upgrades.damage * 4,
    boltSpeed: config.baseBoltSpeed + upgrades.boltSpeed * 55,
    moveSpeed: config.baseMoveSpeed + upgrades.moveSpeed * 18,
    spread: upgrades.spread,
    pierce: upgrades.pierce,
  };
}

// ------------------------------------------------------------
// Audio (safe if files fail)
// ------------------------------------------------------------
const SFX_FILES = {
  fire: 'sfx_fire.mp3',
  hit: 'sfx_hit.mp3',
  death: 'sfx_death.mp3',
  ui: 'sfx_ui_click.mp3',
  wave: 'sfx_wave_start.mp3',
  bossSpawn: 'sfx_boss_spawn.mp3',
  bossDefeat: 'sfx_boss_defeat.mp3',
  music: 'sfx_music_loop.mp3',
};

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const buffers = Object.create(null);

async function loadSfx(name, url){
  try{
    const res = await fetch(url, { cache:'force-cache' });
    const ab = await res.arrayBuffer();
    buffers[name] = await audioCtx.decodeAudioData(ab);
  } catch {}
}

(async function loadAllSfx(){
  const jobs = [];
  for (const k in SFX_FILES){
    if (k === 'music') continue;
    jobs.push(loadSfx(k, SFX_FILES[k]));
  }
  await Promise.all(jobs);
})();

function playBuf(name, {vol=1, rate=1} = {}){
  const buf = buffers[name];
  if (!buf) return;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = audioCtx.createGain();
  g.gain.value = vol;
  src.connect(g).connect(audioCtx.destination);
  try{ src.start(); } catch {}
}

let musicAudio = null;
function startMusic(){
  const url = SFX_FILES.music;
  if (!url) return;
  if (!musicAudio){
    musicAudio = new Audio(url);
    musicAudio.loop = true;
    musicAudio.volume = 0.18;
  }
  musicAudio.play().catch(()=>{});
}

// ------------------------------------------------------------
// Resize
// ------------------------------------------------------------
function clampPlayerToBounds(){
  const minX = bounds.x + player.r, maxX = bounds.x + bounds.w - player.r;
  const minY = bounds.y + player.r, maxY = bounds.y + bounds.h - player.r;
  player.x = clamp(player.x, minX, maxX);
  player.y = clamp(player.y, minY, maxY);
}

function resize(){
  DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.floor(innerWidth * DPR);
  canvas.height = Math.floor(innerHeight * DPR);
  W = canvas.width; H = canvas.height;

  bounds.x = Math.floor(config.boundaryInset * DPR);
  bounds.y = Math.floor(config.boundaryInset * DPR);
  bounds.w = Math.max(1, W - bounds.x * 2);
  bounds.h = Math.max(1, H - bounds.y * 2);

  document.documentElement.style.setProperty('--arena-inset', `${config.boundaryInset}px`);

  player.r = 18 * DPR;
  clampPlayerToBounds();
}
addEventListener('resize', resize);

// ------------------------------------------------------------
// Timer (active time)
// ------------------------------------------------------------
let runActive = false;
let runStart = 0;
let pausedAccum = 0;
let pauseStart = 0;

function resetRunTimer(){ runActive=false; runStart=0; pausedAccum=0; pauseStart=0; }
function startRunTimer(){ runActive=true; runStart=performance.now(); pausedAccum=0; pauseStart=0; }
function pauseRunTimer(){ if (!runActive) return; if (!pauseStart) pauseStart = performance.now(); }
function resumeRunTimer(){ if (!runActive) return; if (pauseStart){ pausedAccum += performance.now() - pauseStart; pauseStart = 0; } }
function runTimeMs(){
  if (!runActive) return 0;
  const now = performance.now();
  let total = now - runStart - pausedAccum;
  if (pauseStart) total -= (now - pauseStart);
  return Math.max(0, Math.floor(total));
}

// ------------------------------------------------------------
// UI
// ------------------------------------------------------------
function setUiMode(mode){
  state.uiMode = mode;
  overlay.classList.toggle('hidden', mode === 'playing');

  if (mode === 'playing') resumeRunTimer();
  else pauseRunTimer();

  if (mode === 'start'){
    panelTitle.textContent = 'TASER';
    panelSubtitle.textContent = '';
    continueBtn.textContent = 'Start';
    restartBtn.classList.add('hidden');
  } else if (mode === 'paused'){
    panelTitle.textContent = 'Paused';
    panelSubtitle.textContent = '';
    continueBtn.textContent = 'Resume';
    restartBtn.classList.remove('hidden');
  } else if (mode === 'intermission'){
    panelTitle.textContent = `Wave ${state.wave} Complete`;
    panelSubtitle.textContent = '';
    continueBtn.textContent = 'Continue';
    restartBtn.classList.remove('hidden');
  } else if (mode === 'gameover'){
    panelTitle.textContent = 'Run Ended';
    panelSubtitle.textContent = `Score ${state.score}`;
    continueBtn.textContent = 'Restart';
    restartBtn.classList.remove('hidden');
  } else if (mode === 'win'){
    panelTitle.textContent = 'Victory';
    panelSubtitle.textContent = `Final Score ${state.score}`;
    continueBtn.textContent = 'Restart';
    restartBtn.classList.remove('hidden');
  }
}

function setInputMode(mode){
  if (mode !== 'keyboardAim' && mode !== 'mouseAim') return;
  state.inputMode = mode;
  localStorage.setItem('inputMode', mode);
  inputToggleBtn.textContent = 'Switch Input';
}

function setGameMode(mode){
  if (mode !== 'waves' && mode !== 'endless') return;
  state.gameMode = mode;
  localStorage.setItem('taser_gameMode', mode);

  modeToggleBtn.textContent = `Mode: ${mode === 'waves' ? 'Waves' : 'Endless'}`;
  elModeLabel.textContent = (mode === 'waves') ? 'Waves' : 'Endless';
  waveRow.style.display = (mode === 'waves') ? '' : 'none';
  remainingRow.style.display = (mode === 'waves') ? '' : 'none';
}

function setAutoFire(on){
  state.autoFire = !!on;
  localStorage.setItem('autoFire', state.autoFire ? '1' : '0');
  autoFireBtn.textContent = `Auto Fire: ${state.autoFire ? 'On' : 'Off'}`;
  if (state.autoFire){
    keys.Space = false;
    mouse.lmb = false;
  }
}

// ------------------------------------------------------------
// Input
// ------------------------------------------------------------
function togglePause(){
  if (state.uiMode === 'playing'){
    keys.Space = false;
    mouse.lmb = false;
    setUiMode('paused');
  } else if (state.uiMode === 'paused'){
    setUiMode('playing');
  }
}

function onContinue(){
  if (state.uiMode === 'start'){ startNewRun(); return; }
  if (state.uiMode === 'paused'){ setUiMode('playing'); return; }
  if (state.uiMode === 'intermission'){ setUiMode('playing'); startWave(state.wave + 1); return; }
  if (state.uiMode === 'gameover' || state.uiMode === 'win'){ startNewRun(); return; }
}

addEventListener('keydown', (e) => {
  if ((e.code === 'KeyP' || e.code === 'Escape') && (state.uiMode === 'playing' || state.uiMode === 'paused')){
    e.preventDefault();
    togglePause();
    return;
  }
  if (e.code === 'Enter' && state.uiMode !== 'playing'){
    e.preventDefault();
    onContinue();
    return;
  }
  if (e.code === 'Space'){ keys.Space = true; e.preventDefault(); }
  else keys[e.code] = true;
});

addEventListener('keyup', (e) => {
  if (e.code === 'Space') keys.Space = false;
  else keys[e.code] = false;
});

addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  mouse.lmb = false;
});

window.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - r.left) * DPR;
  mouse.y = (e.clientY - r.top) * DPR;
  mouse.has = true;
});

window.addEventListener('mousedown', (e) => {
  const t = e.target;
  if (t && t.closest && t.closest('#overlay, #upgradeColumn, #bottomRightControls')) return;
  if (e.button === 0) mouse.lmb = true;
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.lmb = false; });

// Buttons
continueBtn.addEventListener('click', async () => {
  if (audioCtx.state !== 'running') await audioCtx.resume().catch(()=>{});
  startMusic();
  playBuf('ui', {vol:0.6});
  onContinue();
});
restartBtn.addEventListener('click', () => { playBuf('ui',{vol:0.6}); startNewRun(); });

inputToggleBtn.addEventListener('click', () => { playBuf('ui', {vol:0.6}); setInputMode(state.inputMode === 'keyboardAim' ? 'mouseAim' : 'keyboardAim'); });
modeToggleBtn.addEventListener('click', () => { playBuf('ui', {vol:0.6}); setGameMode(state.gameMode === 'waves' ? 'endless' : 'waves'); });
autoFireBtn.addEventListener('click', () => { playBuf('ui', {vol:0.6}); setAutoFire(!state.autoFire); });

// ------------------------------------------------------------
// Entities
// ------------------------------------------------------------
const EnemyType = { GRUNT:'grunt', RUNNER:'runner', TANK:'tank', BRUTE:'brute' };

function enemyArch(type){
  switch(type){
    case EnemyType.RUNNER: return { r:12, hp:22, speed:76, dmg:9,  color:'#9ef6ff', score:10 };
    case EnemyType.TANK:   return { r:20, hp:92, speed:42, dmg:15, color:'#c4b5fd', score:24 };
    case EnemyType.BRUTE:  return { r:16, hp:56, speed:58, dmg:13, color:'#ff9bb3', score:18 };
    default:              return { r:14, hp:38, speed:52, dmg:11, color:'#e6eef8', score:12 };
  }
}

function pickWeighted(items){
  let total = 0;
  for (const it of items) total += it.w;
  let r = Math.random() * total;
  for (const it of items){ r -= it.w; if (r <= 0) return it.v; }
  return items[items.length - 1].v;
}

function waveHpMul(wave){
  const t = clamp((wave - 1) / 19, 0, 1);
  return 1 + 2.7 * (t*t);
}
function waveSpMul(wave){
  const t = clamp((wave - 1) / 19, 0, 1);
  return 1 + 0.26 * t;
}

function chooseTypeWaves(wave){
  const t = clamp((wave - 1) / 19, 0, 1);
  return pickWeighted([
    { v: EnemyType.GRUNT,  w: 60 - 24*t },
    { v: EnemyType.RUNNER, w: 18 + 6*t  },
    { v: EnemyType.BRUTE,  w: 14 + 16*t },
    { v: EnemyType.TANK,   w: 8  + 22*t },
  ]);
}

function chooseTypeEndless(sec){
  const t = clamp(sec / 240, 0, 1);
  const eliteBoost = clamp((sec - 45) / 180, 0, 1) * config.endlessEliteChance;
  return pickWeighted([
    { v: EnemyType.GRUNT,  w: 62 - 30*t },
    { v: EnemyType.RUNNER, w: 20 + 6*t  },
    { v: EnemyType.BRUTE,  w: 12 + 16*t + 18*eliteBoost },
    { v: EnemyType.TANK,   w: 6  + 8*t  + 22*eliteBoost },
  ]);
}

function spawnEdge(){
  const left = bounds.x + Math.floor(config.spawnEdgePadding * DPR);
  const right = bounds.x + bounds.w - Math.floor(config.spawnEdgePadding * DPR);
  const top = bounds.y + Math.floor(config.spawnEdgePadding * DPR);
  const bottom = bounds.y + bounds.h - Math.floor(config.spawnEdgePadding * DPR);
  const edge = Math.floor(Math.random() * 4);
  if (edge === 0) return { x: left,  y: rand(top, bottom) };
  if (edge === 1) return { x: right, y: rand(top, bottom) };
  if (edge === 2) return { x: rand(left, right), y: top };
  return { x: rand(left, right), y: bottom };
}

const enemies = [];
let boss = null;

function spawnEnemyWaves(wave){
  const type = chooseTypeWaves(wave);
  const a = enemyArch(type);
  const hpMul = waveHpMul(wave);
  const spMul = waveSpMul(wave);

  let p = spawnEdge();
  let tries = 0;
  const safeR = config.safeSpawnRadius * DPR;
  while (dist2(p.x, p.y, player.x, player.y) < safeR*safeR && tries < 80){
    p = spawnEdge(); tries++;
  }

  enemies.push({
    type,
    x: p.x, y: p.y,
    r: a.r * DPR,
    hpMax: Math.round(a.hp * hpMul),
    hp: Math.round(a.hp * hpMul),
    speed: a.speed * spMul * DPR,
    contactDmg: a.dmg,
    color: a.color,
    baseScore: a.score,
    hitFlash: 0,
  });
}

function endlessMuls(sec){
  return {
    hpMul: 1 + config.endlessHpScale * (sec / 120),
    spMul: 1 + config.endlessSpeedScale * (sec / 120),
  };
}

function spawnEnemyEndless(sec){
  const type = chooseTypeEndless(sec);
  const a = enemyArch(type);
  const { hpMul, spMul } = endlessMuls(sec);

  let p = spawnEdge();
  let tries = 0;
  const safeR = config.safeSpawnRadius * DPR;
  while (dist2(p.x, p.y, player.x, player.y) < safeR*safeR && tries < 80){
    p = spawnEdge(); tries++;
  }

  enemies.push({
    type,
    x: p.x, y: p.y,
    r: a.r * DPR,
    hpMax: Math.round(a.hp * hpMul),
    hp: Math.round(a.hp * hpMul),
    speed: a.speed * spMul * DPR,
    contactDmg: a.dmg,
    color: a.color,
    baseScore: a.score,
    hitFlash: 0,
  });
}

function spawnBoss(){
  const r = 48 * DPR;
  const padding = 24 * DPR;
  boss = {
    x: bounds.x + bounds.w - r - padding,
    y: bounds.y + bounds.h / 2,
    r,
    hpMax: 2100 * 5,
    hp: 2100 * 5,
    speed: 62 * DPR,
    contactDmg: 20,
    color: '#ffd166',
    hitFlash: 0,
    dashTimer: 2.2,
    dashTimeLeft: 0,
    dashVx: 0,
    dashVy: 0,
    scoreValue: 900,
  };
  playBuf('bossSpawn', {vol:0.9});
}

// ------------------------------------------------------------
// Combat
// ------------------------------------------------------------
const bolts = [];
const particles = [];
let fireCooldown = 0;

// ring blast timing
let ringBlastTimer = config.ringBlastPeriod;
const pendingRingBursts = []; // {t, ringIndex}

function spawnExplosion(x, y, color){
  const n = 10 + Math.floor(Math.random() * 12);
  for (let i=0;i<n;i++){
    const a = Math.random() * Math.PI * 2;
    const sp = rand(55, 240) * DPR;
    particles.push({ x,y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, life:rand(0.20,0.55), r:rand(2,4)*DPR, color });
  }
}

function shouldFire(){
  if (state.autoFire) return true;
  if (state.inputMode === 'keyboardAim') return !!keys.Space;
  return mouse.lmb || !!keys.Space;
}

function fire(dt){
  const s = stats();
  fireCooldown -= dt;
  if (!shouldFire()) return;
  if (fireCooldown > 0) return;

  fireCooldown = 1 / s.fireRate;
  playBuf('fire', {vol:0.6, rate:0.98 + Math.random()*0.06});

  const baseA = player.angle;
  const count = 1 + s.spread;
  const cone = (s.spread === 0) ? 0 : (Math.PI/52) * (1 + s.spread * 0.7);
  const muzzle = 28 * DPR;

  for (let i=0;i<count;i++){
    const t = (count === 1) ? 0 : (i/(count-1))*2 - 1;
    const a = baseA + t*cone;
    bolts.push({
      x: player.x + Math.cos(a)*muzzle,
      y: player.y + Math.sin(a)*muzzle,
      vx: Math.cos(a) * s.boltSpeed * DPR,
      vy: Math.sin(a) * s.boltSpeed * DPR,
      life: 1.5,
      r: 5 * DPR,
      dmg: s.damage,
      pierceLeft: s.pierce,
    });
  }
}

function triggerRingBurst(ringIndex){
  const lvl = upgrades.ringBlast;
  if (lvl <= 0) return;

  const s = stats();
  const boltsCount = 12 + Math.min(18, lvl * 3);
  const dmgMult = 1.35 + 0.08 * (lvl - 1);
  const damage = Math.round(s.damage * dmgMult);
  const speed = s.boltSpeed * DPR;
  const muzzle = 26 * DPR;
  const angleOffset = ringIndex * (Math.PI / boltsCount) * 0.55;

  playBuf('fire', {vol:0.32, rate:0.86 + ringIndex*0.05});

  for (let i=0;i<boltsCount;i++){
    const a = angleOffset + (i / boltsCount) * Math.PI * 2;
    bolts.push({
      x: player.x + Math.cos(a)*muzzle,
      y: player.y + Math.sin(a)*muzzle,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      life: 1.25,
      r: 5 * DPR,
      dmg: damage,
      pierceLeft: s.pierce,
    });
  }
}

function triggerRingBlast(){
  const lvl = upgrades.ringBlast;
  if (lvl <= 0) return;

  const extra = Math.max(0, lvl - 5); // lvl6 => 1 extra ring, lvl7 => 2 extra rings
  const totalRings = 1 + extra;

  pendingRingBursts.push({ t:0, ringIndex:0 });
  for (let i=1;i<totalRings;i++){
    pendingRingBursts.push({ t:0.09*i, ringIndex:i });
  }
}

function updateRingBlast(dt){
  if (upgrades.ringBlast <= 0) return;

  ringBlastTimer -= dt;
  if (ringBlastTimer <= 0){
    triggerRingBlast();
    ringBlastTimer = config.ringBlastPeriod;
  }

  for (let i=pendingRingBursts.length-1;i>=0;i--){
    const b = pendingRingBursts[i];
    b.t -= dt;
    if (b.t <= 0){
      triggerRingBurst(b.ringIndex);
      pendingRingBursts.splice(i,1);
    }
  }
}

function updateBolts(dt){
  for (let i=bolts.length-1;i>=0;i--){
    const b = bolts[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (
      b.life <= 0 ||
      b.x < bounds.x-120 || b.x > bounds.x+bounds.w+120 ||
      b.y < bounds.y-120 || b.y > bounds.y+bounds.h+120
    ){
      bolts.splice(i,1);
    }
  }
}

function scoreForKill(wave, baseScore){
  const t = clamp((wave - 1) / 19, 0, 1);
  const mult = 1 + 2.0*(t*t);
  const score = Math.round(baseScore * mult);
  const points = Math.max(1, Math.round(score * 0.24));
  return { score, points };
}

function collideBolts(){
  for (let i=bolts.length-1;i>=0;i--){
    const b = bolts[i];

    for (let j=enemies.length-1;j>=0;j--){
      const e = enemies[j];
      const rr = b.r + e.r;
      if (dist2(b.x,b.y,e.x,e.y) <= rr*rr){
        e.hp -= b.dmg;
        e.hitFlash = 0.10;

        particles.push({ x:b.x, y:b.y, vx:rand(-75,75)*DPR, vy:rand(-75,75)*DPR, life:0.12, r:2*DPR, color:'#52f5ff' });

        if (e.hp <= 0){
          playBuf('death', {vol:0.9, rate:0.95 + Math.random()*0.12});
          spawnExplosion(e.x, e.y, e.color);

          const gain = (state.gameMode === 'waves')
            ? scoreForKill(state.wave, e.baseScore)
            : { score: e.baseScore, points: Math.max(1, Math.round(e.baseScore * 0.25)) };

          state.score += gain.score;
          state.points += gain.points;

          enemies.splice(j,1);
          markShopDirty();
        }

        if (b.pierceLeft > 0) b.pierceLeft--;
        else { bolts.splice(i,1); break; }
      }
    }

    if (i >= bolts.length) continue;

    if (boss){
      const rr = b.r + boss.r;
      if (dist2(b.x,b.y,boss.x,boss.y) <= rr*rr){
        boss.hp -= b.dmg;
        boss.hitFlash = 0.10;

        particles.push({ x:b.x, y:b.y, vx:rand(-75,75)*DPR, vy:rand(-75,75)*DPR, life:0.12, r:2*DPR, color:'#52f5ff' });

        if (boss.hp <= 0){
          playBuf('bossDefeat', {vol:1.0});
          spawnExplosion(boss.x, boss.y, boss.color);
          state.score += boss.scoreValue;
          boss = null;
          setUiMode('win');
        }

        if (b.pierceLeft > 0) b.pierceLeft--;
        else bolts.splice(i,1);
      }
    }
  }
}

function applyPlayerHit(dmg, fromX, fromY){
  if (player.iTime > 0) return;

  player.hp -= dmg;
  player.iTime = config.iFrames;

  const dx = player.x - fromX;
  const dy = player.y - fromY;
  const len = Math.hypot(dx,dy) || 1;
  player.x += (dx/len) * (config.contactKnockback * DPR) * 0.06;
  player.y += (dy/len) * (config.contactKnockback * DPR) * 0.06;

  clampPlayerToBounds();
  spawnExplosion(player.x, player.y, '#52f5ff');

  playBuf('hit', {vol:0.9, rate:0.95 + Math.random()*0.1});

  if (player.hp <= 0) onDeath();
}

function onDeath(){
  playBuf('death', {vol:1.0});

  state.bestWave = Math.max(state.bestWave, state.wave);
  state.highScore = Math.max(state.highScore, state.score);
  localStorage.setItem('bestWave', String(state.bestWave));
  localStorage.setItem('highScore', String(state.highScore));

  setUiMode('gameover');
}

// ------------------------------------------------------------
// Enemy update
// ------------------------------------------------------------
function updateEnemies(dt){
  for (const e of enemies){
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const len = Math.hypot(dx,dy) || 1;

    e.x += (dx/len) * e.speed * dt;
    e.y += (dy/len) * e.speed * dt;

    e.x = clamp(e.x, bounds.x + e.r, bounds.x + bounds.w - e.r);
    e.y = clamp(e.y, bounds.y + e.r, bounds.y + bounds.h - e.r);

    if (e.hitFlash > 0) e.hitFlash -= dt;

    const rr = e.r + player.r;
    if (dist2(e.x,e.y,player.x,player.y) <= rr*rr){
      applyPlayerHit(e.contactDmg, e.x, e.y);
      const rx = e.x - player.x, ry = e.y - player.y;
      const rlen = Math.hypot(rx,ry) || 1;
      e.x += (rx/rlen) * 44 * DPR * dt;
      e.y += (ry/rlen) * 44 * DPR * dt;
    }
  }

  if (boss){
    if (boss.hitFlash > 0) boss.hitFlash -= dt;

    boss.dashTimer -= dt;
    if (boss.dashTimer <= 0 && boss.dashTimeLeft <= 0){
      boss.dashTimer = rand(1.8, 2.8);
      boss.dashTimeLeft = rand(0.35, 0.60);
      const dx = player.x - boss.x;
      const dy = player.y - boss.y;
      const len = Math.hypot(dx,dy) || 1;
      const dashSpeed = boss.speed * 3.2;
      boss.dashVx = (dx/len) * dashSpeed;
      boss.dashVy = (dy/len) * dashSpeed;
    }

    let vx, vy;
    if (boss.dashTimeLeft > 0){
      boss.dashTimeLeft -= dt;
      vx = boss.dashVx; vy = boss.dashVy;
    } else {
      const dx = player.x - boss.x;
      const dy = player.y - boss.y;
      const len = Math.hypot(dx,dy) || 1;
      vx = (dx/len) * boss.speed;
      vy = (dy/len) * boss.speed;
    }

    boss.x += vx * dt;
    boss.y += vy * dt;

    boss.x = clamp(boss.x, bounds.x + boss.r, bounds.x + bounds.w - boss.r);
    boss.y = clamp(boss.y, bounds.y + boss.r, bounds.y + bounds.h - boss.r);

    const rr = boss.r + player.r;
    if (dist2(boss.x,boss.y,player.x,player.y) <= rr*rr){
      applyPlayerHit(boss.contactDmg, boss.x, boss.y);
      const rx = boss.x - player.x, ry = boss.y - player.y;
      const rlen = Math.hypot(rx,ry) || 1;
      boss.x += (rx/rlen) * 58 * DPR * dt;
      boss.y += (ry/rlen) * 58 * DPR * dt;
    }
  }
}

// ------------------------------------------------------------
// Player update
// ------------------------------------------------------------
function updatePlayer(dt){
  const s = stats();

  if (state.inputMode === 'keyboardAim'){
    const ix = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
    const iy = (keys.ArrowDown  ? 1 : 0) - (keys.ArrowUp   ? 1 : 0);

    if (ix !== 0 || iy !== 0){
      const len = Math.hypot(ix,iy) || 1;
      player.vx = (ix/len) * s.moveSpeed * DPR;
      player.vy = (iy/len) * s.moveSpeed * DPR;

      const target = Math.atan2(iy, ix);
      const diff = shortestAngleDiff(player.angle, target);
      const accel = clamp(diff * config.turnAccel, -config.turnAccel, config.turnAccel);
      player.angVel += accel * dt;
    } else {
      player.vx = 0; player.vy = 0;
    }

    player.angVel *= Math.exp(-config.turnDamp * dt);
    player.angVel = clamp(player.angVel, -config.maxAngVel, config.maxAngVel);
    player.angle = wrapAngle(player.angle + player.angVel * dt);
  } else {
    const ix = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const iy = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0);

    if (ix !== 0 || iy !== 0){
      const len = Math.hypot(ix,iy) || 1;
      player.vx = (ix/len) * s.moveSpeed * DPR;
      player.vy = (iy/len) * s.moveSpeed * DPR;
    } else {
      player.vx = 0; player.vy = 0;
    }

    if (mouse.has){
      player.angle = Math.atan2(mouse.y - player.y, mouse.x - player.x);
    }
    player.angVel = 0;
  }

  player.x += player.vx * dt;
  player.y += player.vy * dt;

  clampPlayerToBounds();
  if (player.iTime > 0) player.iTime -= dt;
}

// ------------------------------------------------------------
// Particles
// ------------------------------------------------------------
function updateParticles(dt){
  for (let i=particles.length-1;i>=0;i--){
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= Math.exp(-6 * dt);
    p.vy *= Math.exp(-6 * dt);
    p.life -= dt;
    if (p.life <= 0) particles.splice(i,1);
  }
}

// ------------------------------------------------------------
// Spawning / progression
// ------------------------------------------------------------
function enemyCountForWave(wave){
  const n = config.waveEnemyBase + (wave - 1) * config.waveEnemyGrowth;
  return Math.min(200, n);
}
function spawnIntervalForWave(wave){
  const t = clamp((wave - 1) / 19, 0, 1);
  const interval = config.spawnIntervalBase - 0.26 * t;
  return Math.max(config.spawnIntervalMin, interval);
}

function updateSpawning(dt){
  if (state.gameMode === 'waves'){
    if (state.wave >= 20) return;
    if (state.spawned >= state.totalToSpawn) return;

    state.spawnTimer -= dt;
    if (state.spawnTimer > 0) return;

    spawnEnemyWaves(state.wave);
    state.spawned++;
    state.spawnTimer = spawnIntervalForWave(state.wave);
    return;
  }

  // endless
  const sec = runTimeMs() / 1000;
  const targetInterval = Math.max(
    config.endlessMinSpawnInterval,
    config.endlessBaseSpawnInterval * Math.exp(-config.endlessSpawnAccel * (sec / 120))
  );

  state.endlessSpawnTimer -= dt;
  if (state.endlessSpawnTimer > 0) return;

  const cap = 40 + Math.floor(sec / 12);
  if (enemies.length < cap) spawnEnemyEndless(sec);

  state.endlessSpawnTimer = targetInterval;
}

function waveRemaining(){
  const leftToSpawn = Math.max(0, state.totalToSpawn - state.spawned);
  const alive = enemies.length + (boss ? 1 : 0);
  return alive + leftToSpawn;
}

function finishWaveIfNeeded(){
  if (state.gameMode !== 'waves') return;
  if (state.uiMode !== 'playing') return;

  const remaining = waveRemaining();
  if (remaining > 0) return;
  if (state.wave >= 20) return;

  playBuf('wave', {vol:0.9});
  setUiMode('intermission');
}

// ------------------------------------------------------------
// Upgrades UI
// ------------------------------------------------------------
let shopDirty = true;
function markShopDirty(){ shopDirty = true; }

function renderUpgrades(){
  shopDirty = false;
  upgradeItems.innerHTML = '';

  for (let i=0;i<shopItems.length;i++){
    const item = shopItems[i];
    const lvl = levelOf(item.id);
    const maxed = lvl >= item.maxLevel;
    const cost = costOf(item);
    const canBuy = (!maxed && state.points >= cost);

    const pill = document.createElement('div');
    pill.className = `upPill${canBuy ? ' canBuy' : ''}${maxed ? ' maxed' : ''}`;

    const left = document.createElement('div');
    left.className = 'upLeft';

    const name = document.createElement('div');
    name.className = 'upName';
    name.textContent = item.name;

    const lvEl = document.createElement('div');
    lvEl.className = 'upLv';
    lvEl.textContent = `Level ${lvl}/${item.maxLevel}`;

    left.appendChild(name);
    left.appendChild(lvEl);

    const right = document.createElement('div');
    right.className = 'upCost';
    right.textContent = maxed ? 'MAX' : `${cost} pts`;

    pill.appendChild(left);
    pill.appendChild(right);

    pill.addEventListener('click', async () => {
      if (audioCtx.state !== 'running') await audioCtx.resume().catch(()=>{});
      startMusic();
      playBuf('ui', {vol:0.55});
      tryBuy(i);
    });

    upgradeItems.appendChild(pill);
  }

  ucPoints.textContent = String(state.points);
}

function tryBuy(index){
  const item = shopItems[index];
  if (!item) return;

  const lvl = levelOf(item.id);
  if (lvl >= item.maxLevel) return;

  const cost = costOf(item);
  if (state.points < cost) return;

  state.points -= cost;
  item.apply();

  if (item.id === 'ringBlast' && lvl === 0){
    ringBlastTimer = config.ringBlastPeriod;
    pendingRingBursts.length = 0;
  }

  markShopDirty();
  syncHud();
}

// ------------------------------------------------------------
// HUD sync
// ------------------------------------------------------------
function syncHud(){
  elScore.textContent = String(state.score);
  elPoints.textContent = String(state.points);

  if (state.gameMode === 'waves'){
    elWave.textContent = String(state.wave);
    elRemaining.textContent = String(waveRemaining());
  } else {
    elWave.textContent = '—';
    elRemaining.textContent = '—';
  }

  elBestWave.textContent = String(state.bestWave);
  elHighScore.textContent = String(state.highScore);

  const hpPct = clamp(player.hp / player.hpMax, 0, 1);
  elHealthFill.style.width = `${hpPct * 100}%`;
  elHealthFill.style.background =
    hpPct > 0.45 ? 'linear-gradient(90deg,#34d399,#22c55e)' :
    hpPct > 0.2  ? 'linear-gradient(90deg,#fbbf24,#f59e0b)' :
                  'linear-gradient(90deg,#fb7185,#ef4444)';
  elHealthText.textContent = `HP ${Math.max(0, Math.ceil(player.hp))} / ${player.hpMax}`;

  ucPoints.textContent = String(state.points);
}

// ------------------------------------------------------------
// Drawing
// ------------------------------------------------------------
let bgGrad = null;
function ensureBg(){
  if (!bgGrad || bgGrad._w !== W || bgGrad._h !== H){
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#05202b');
    g.addColorStop(1, '#073343');
    bgGrad = g;
    bgGrad._w = W; bgGrad._h = H;
  }
}

function drawBackground(){
  ensureBg();
  ctx.fillStyle = bgGrad || '#05202b';
  ctx.fillRect(0, 0, W, H);

  const vg = ctx.createRadialGradient(W*0.5, H*0.4, Math.min(W,H)*0.1, W*0.5, H*0.6, Math.max(W,H)*0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

function drawGrid(){
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = '#ffffff';
  const step = Math.floor(64 * DPR);
  for (let x=0; x<=W; x+=step){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y=0; y<=H; y+=step){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  ctx.restore();
}

function drawArena(){
  ctx.save();
  ctx.fillStyle = 'rgba(4,11,15,0.22)';
  ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);

  ctx.lineWidth = Math.max(1, config.boundaryThickness * DPR);
  ctx.strokeStyle = config.boundaryColor;
  ctx.strokeRect(
    bounds.x - ctx.lineWidth/2,
    bounds.y - ctx.lineWidth/2,
    bounds.w + ctx.lineWidth,
    bounds.h + ctx.lineWidth
  );
  ctx.restore();
}

function roundRectPath(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

function drawSpriteCentered(sprite, x, y, targetH){
  // targetH is "height on screen"; width keeps aspect ratio
  const img = sprite.img;
  const aspect = img.width / img.height;
  const h = targetH;
  const w = h * aspect;
  ctx.drawImage(img, x - w/2, y - h/2, w, h);
}

function drawEnemies(){
  for (const e of enemies){
    ctx.save();
    ctx.globalAlpha = e.hitFlash > 0 ? 0.65 : 1;

    const spr = ENEMY_SPRITES[e.type];
    if (spr && spr.loaded && spr.img.width > 0){
      // Match sprite height to enemy diameter (2*r) so collisions stay consistent
      drawSpriteCentered(spr, e.x, e.y, e.r * 2);
    } else {
      // fallback: simple circle if sprite missing
      ctx.fillStyle = e.color;
      ctx.beginPath(); ctx.arc(e.x,e.y,e.r,0,Math.PI*2); ctx.fill();
    }

    // HP bar (unchanged)
    const pct = clamp(e.hp / e.hpMax, 0, 1);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = 'rgba(230,238,248,.18)';
    ctx.fillRect(e.x - e.r, e.y - e.r - 10*DPR, e.r*2, 3*DPR);
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillRect(e.x - e.r, e.y - e.r - 10*DPR, e.r*2*pct, 3*DPR);

    ctx.restore();
  }

  if (boss){
    ctx.save();
    ctx.globalAlpha = boss.hitFlash > 0 ? 0.65 : 1;

    const spr = ENEMY_SPRITES.boss;
    if (spr && spr.loaded && spr.img.width > 0){
      drawSpriteCentered(spr, boss.x, boss.y, boss.r * 2);
    } else {
      ctx.fillStyle = boss.color;
      ctx.beginPath(); ctx.arc(boss.x,boss.y,boss.r,0,Math.PI*2); ctx.fill();
    }

    // boss HP bar (unchanged)
    const barW = Math.min(520*DPR, bounds.w*0.7);
    const barH = 10*DPR;
    const x = bounds.x + (bounds.w - barW)/2;
    const y = bounds.y - 22*DPR;

    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(230,238,248,.14)';
    roundRectPath(x,y,barW,barH,10*DPR); ctx.fill();
    ctx.fillStyle = '#ffd166';
    roundRectPath(x,y,barW*clamp(boss.hp/boss.hpMax,0,1),barH,10*DPR); ctx.fill();

    ctx.restore();
  }
}

function drawBolts(){
  for (const b of bolts){
    ctx.save();
    ctx.fillStyle = '#52f5ff';
    ctx.beginPath(); ctx.ellipse(b.x,b.y,b.r,b.r,0,0,Math.PI*2); ctx.fill();

    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#9ef6ff';
    ctx.beginPath();
    ctx.ellipse(b.x - b.vx*0.018, b.y - b.vy*0.018, 12*DPR, 6*DPR, 0, 0, Math.PI*2);
    ctx.fill();

    ctx.restore();
  }
}

function drawParticles(){
  for (const p of particles){
    ctx.save();
    ctx.globalAlpha = clamp(p.life / 0.55, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
}

function drawPlayer(){
  // draw sprite rotated like before; if missing, fallback to simple pill shape
  if (PLAYER_SPRITE.loaded && PLAYER_SPRITE.img.width > 0){
    // size: base height roughly matches the old "body" thickness
    const targetH = 40 * DPR;
    const img = PLAYER_SPRITE.img;
    const aspect = img.width / img.height;
    const h = targetH;
    const w = h * aspect;

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle);
    ctx.globalAlpha = (player.iTime > 0) ? 0.72 : 1.0;
    ctx.drawImage(img, -w/2, -h/2, w, h);
    ctx.restore();
    return;
  }

  // fallback
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(player.angle);
  ctx.globalAlpha = (player.iTime > 0) ? 0.72 : 1.0;
  ctx.fillStyle = '#e6eef8';
  roundRectPath(-18*DPR,-12*DPR,36*DPR,24*DPR,6*DPR); ctx.fill();
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(18*DPR,-5*DPR,14*DPR,10*DPR);
  ctx.restore();
}

// ------------------------------------------------------------
// Run start/reset
// ------------------------------------------------------------
function startWave(wave){
  player.hpMax = config.baseHP;
  player.hp = player.hpMax;
  player.iTime = 0;

  player.x = bounds.x + bounds.w/2;
  player.y = bounds.y + bounds.h/2;
  player.vx = player.vy = 0;
  player.angle = 0;
  player.angVel = 0;

  enemies.length = 0;
  bolts.length = 0;
  particles.length = 0;
  boss = null;

  state.wave = wave;
  state.spawned = 0;
  state.spawnTimer = 0;

  ringBlastTimer = config.ringBlastPeriod;
  pendingRingBursts.length = 0;

  if (wave < 20){
    state.totalToSpawn = enemyCountForWave(wave);
  } else {
    state.totalToSpawn = 0;
    spawnBoss();
  }

  resetRunTimer();
  startRunTimer();

  markShopDirty();
  syncHud();
}

function startEndless(){
  player.hpMax = config.baseHP;
  player.hp = player.hpMax;
  player.iTime = 0;

  player.x = bounds.x + bounds.w/2;
  player.y = bounds.y + bounds.h/2;
  player.vx = player.vy = 0;
  player.angle = 0;
  player.angVel = 0;

  enemies.length = 0;
  bolts.length = 0;
  particles.length = 0;
  boss = null;

  state.endlessSpawnTimer = 0;

  ringBlastTimer = config.ringBlastPeriod;
  pendingRingBursts.length = 0;

  resetRunTimer();
  startRunTimer();

  markShopDirty();
  syncHud();
}

function startNewRun(){
  state.score = 0;
  state.points = 0;
  for (const k in upgrades) upgrades[k] = 0;

  if (state.gameMode === 'waves') startWave(1);
  else startEndless();

  setUiMode('playing');
}

// ------------------------------------------------------------
// Main loop
// ------------------------------------------------------------
function update(dt){
  if (state.uiMode === 'start' || state.uiMode === 'paused' || state.uiMode === 'gameover' || state.uiMode === 'win'){
    if (shopDirty) renderUpgrades();
    syncHud();
    return;
  }

  if (state.uiMode === 'intermission'){
    if (shopDirty) renderUpgrades();
    syncHud();
    return;
  }

  updatePlayer(dt);
  updateSpawning(dt);

  updateRingBlast(dt);

  fire(dt);
  updateBolts(dt);
  updateEnemies(dt);
  collideBolts();
  updateParticles(dt);

  finishWaveIfNeeded();

  syncHud();
  if (shopDirty) renderUpgrades();
}

function draw(){
  drawBackground();
  drawGrid();
  drawArena();
  drawParticles();
  drawBolts();
  drawEnemies();
  drawPlayer();
}

let last = performance.now();
function loop(now){
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  try { update(dt); } catch (e) { console.error('update error', e); }
  try { draw(); } catch (e) { console.error('draw error', e); }

  requestAnimationFrame(loop);
}

// ------------------------------------------------------------
// Boot
// ------------------------------------------------------------
function boot(){
  resize();

  setGameMode(state.gameMode);
  setInputMode(state.inputMode);
  setAutoFire(state.autoFire);

  markShopDirty();
  renderUpgrades();
  syncHud();
  setUiMode('start');

  requestAnimationFrame(loop);
}

boot();