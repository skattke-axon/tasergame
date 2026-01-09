// Full-screen canvas + larger arena, slower enemies, HP-driven difficulty,
// paced spawning, no self-destruct on contact, Axon-branded shop UI.
//
// Controls: Arrow Keys move/aim, hold Space to fire.
// Added: Start menu + Pause (P/Esc), smoother rotation using angular acceleration (no speed change).

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// HUD
const elScore = document.getElementById('score');
const elPoints = document.getElementById('points');
const elWave = document.getElementById('wave');
const elRemaining = document.getElementById('remaining');
const elBestWave = document.getElementById('bestWave');
const elHighScore = document.getElementById('highScore');
const elHealthFill = document.getElementById('healthFill');
const elHealthText = document.getElementById('healthText');

// Overlay
const overlay = document.getElementById('overlay');
const panelTitle = document.getElementById('panelTitle');
const panelSubtitle = document.getElementById('panelSubtitle');
const shopList = document.getElementById('shopList');
const continueBtn = document.getElementById('continueBtn');
const restartBtn = document.getElementById('restartBtn');

const keys = {};
addEventListener('keydown', (e) => {
  // Pause toggles (only while playing/paused; doesn't interfere with shop digit input)
  if ((e.code === 'KeyP' || e.code === 'Escape') && (state.mode === 'playing' || state.mode === 'paused')) {
    e.preventDefault();
    togglePause();
    return;
  }

  if (e.code === 'Space') { keys.Space = true; e.preventDefault(); }
  else keys[e.code] = true;

  if (state.mode === 'shop') {
    const idx = parseDigit(e.code);
    if (idx !== null) tryBuy(idx - 1);
    if (e.code === 'Enter') onContinue();
  } else if (state.mode === 'start') {
    if (e.code === 'Enter') onContinue();
  } else if (state.mode === 'paused') {
    if (e.code === 'Enter') onContinue(); // resume
  } else if (state.mode === 'gameover' || state.mode === 'win') {
    if (e.code === 'Enter') onContinue(); // restart
  }
});

addEventListener('keyup', (e) => {
  if (e.code === 'Space') keys.Space = false;
  else keys[e.code] = false;
});
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function parseDigit(code){
  if (!code.startsWith('Digit')) return null;
  const d = Number(code.slice(5));
  if (!Number.isFinite(d) || d < 1 || d > 9) return null;
  return d;
}

// ---- Config (rebalanced) ----
const config = {
  // canvas / arena
  boundaryInset: 28,          // smaller inset => larger playable area
  boundaryThickness: 6,
  boundaryColor: '#ffd166',

  // player
  baseHP: 100,
  iFrames: 0.35,
  contactKnockback: 190,

  // baseline weapon (slower start)
  baseFireRate: 3.0,          // shots/sec
  baseDamage: 16,             // tuned for slower early weapon
  baseBoltSpeed: 520,

  // movement
  baseMoveSpeed: 280,
  // rotation smoothing (accelerated rotation; speed unchanged)
  turnAccel: 300.0,            // rad/s^2
  turnDamp: 14.0,             // 1/s (higher = snappier stop)
  maxAngVel: 9.5,             // rad/s

  // enemies
  safeSpawnRadius: 160,
  spawnEdgePadding: 14,

  // paced spawning
  waveEnemyCount: 20,         // waves 1-19
  spawnIntervalBase: 0.45,    // seconds between spawns early
  spawnIntervalMin: 0.18,     // late waves still paced, not a dump
};

let W = 960, H = 540;
let DPR = 1;

function resize(){
  DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;

  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';

  canvas.width = Math.floor(cssW * DPR);
  canvas.height = Math.floor(cssH * DPR);

  W = canvas.width;
  H = canvas.height;

  // recompute bounds + clamp player/enemies into new arena
  bounds.x = Math.floor(config.boundaryInset * DPR);
  bounds.y = Math.floor(config.boundaryInset * DPR);
  bounds.w = W - bounds.x * 2;
  bounds.h = H - bounds.y * 2;

  clampAllToBounds();
}
addEventListener('resize', resize);

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function dist2(ax,ay,bx,by){ const dx=ax-bx, dy=ay-by; return dx*dx+dy*dy; }
function rand(min,max){ return min + Math.random()*(max-min); }
function wrapAngle(a){
  // keep in [-PI, PI] to avoid numeric growth
  a = (a + Math.PI) % (Math.PI*2);
  if (a < 0) a += Math.PI*2;
  return a - Math.PI;
}
function shortestAngleDiff(a,b){
  // result in [-PI, PI]
  return wrapAngle(b - a);
}

// Bounds object is mutated on resize
const bounds = { x: 28, y: 28, w: 900, h: 500 };

const state = {
  mode: 'start', // start | playing | paused | shop | gameover | win
  wave: 1,
  score: 0,
  points: 0,

  // wave spawning state
  totalToSpawn: 0,
  spawned: 0,
  spawnTimer: 0,

  bestWave: Number(localStorage.getItem('bestWave') || 1),
  highScore: Number(localStorage.getItem('highScore') || 0),
};

const player = {
  x: 0, y: 0,
  r: 18,
  size: 36,
  angle: 0,
  angVel: 0,
  vx: 0, vy: 0,
  hpMax: config.baseHP,
  hp: config.baseHP,
  iTime: 0,
};

const upgrades = {
  fireRate: 0,
  damage: 0,
  boltSpeed: 0,
  moveSpeed: 0,
  spread: 0,
  pierce: 0,
};

function levelOf(id){ return upgrades[id] ?? 0; }

const shopItems = [
  { id:'fireRate', name:'Fire Rate', desc:'Increase shots per second.', maxLevel:10, baseCost:18, costScale:1.38, apply(){ upgrades.fireRate++; } },
  { id:'damage', name:'Damage', desc:'Bolts deal more damage.', maxLevel:12, baseCost:20, costScale:1.40, apply(){ upgrades.damage++; } },
  { id:'boltSpeed', name:'Bolt Speed', desc:'Bolts fly faster.', maxLevel:10, baseCost:14, costScale:1.34, apply(){ upgrades.boltSpeed++; } },
  { id:'moveSpeed', name:'Move Speed', desc:'Move faster (Arrow Keys).', maxLevel:8, baseCost:14, costScale:1.34, apply(){ upgrades.moveSpeed++; } },
  { id:'spread', name:'Spread', desc:'Fire extra bolts in a cone.', maxLevel:6, baseCost:35, costScale:1.50, apply(){ upgrades.spread++; } },
  { id:'pierce', name:'Pierce', desc:'Bolts pass through enemies.', maxLevel:6, baseCost:38, costScale:1.50, apply(){ upgrades.pierce++; } },
];

function costOf(item){
  const lvl = levelOf(item.id);
  return Math.floor(item.baseCost * Math.pow(item.costScale, lvl));
}

function effectiveStats(){
  // Values are scaled so early upgrades feel good, later costs ramp.
  const fireRate = config.baseFireRate + upgrades.fireRate * 0.55; // ~3.0 -> ~8.5 max
  const damage = config.baseDamage + upgrades.damage * 4;          // 16 -> 64 max-ish
  const boltSpeed = config.baseBoltSpeed + upgrades.boltSpeed * 55;
  const moveSpeed = config.baseMoveSpeed + upgrades.moveSpeed * 18;
  const spreadCount = upgrades.spread; // +N
  const pierce = upgrades.pierce;
  return { fireRate, damage, boltSpeed, moveSpeed, spreadCount, pierce };
}

// ---- Enemies (slower + very light speed ramp; difficulty mostly HP) ----
const EnemyType = { GRUNT:'grunt', RUNNER:'runner', TANK:'tank', BRUTE:'brute' };

function enemyArchetype(type){
  switch(type){
    case EnemyType.RUNNER: return { r: 12, hp: 20, speed: 70,  dmg: 8,  color:'#9ef6ff', score: 10 };
    case EnemyType.TANK:   return { r: 20, hp: 85, speed: 38,  dmg: 14, color:'#c4b5fd', score: 22 };
    case EnemyType.BRUTE:  return { r: 16, hp: 50, speed: 52,  dmg: 12, color:'#ff9bb3', score: 16 };
    default:              return { r: 14, hp: 34, speed: 48,  dmg: 10, color:'#e6eef8', score: 12 };
  }
}

function hpMultiplier(wave){
  // main difficulty driver: HP ramps strongly; wave 20 mobs never happen (boss only)
  const t = clamp((wave - 1) / 19, 0, 1);
  return 1 + 2.1 * (t*t); // up to ~3.1x
}

function speedMultiplier(wave){
  // very light speed ramp: ~1.00 -> ~1.18 by wave 20
  const t = clamp((wave - 1) / 19, 0, 1);
  return 1 + 0.18 * t;
}

function chooseEnemyType(wave){
  // composition slowly shifts to tougher enemies
  const t = clamp((wave - 1) / 19, 0, 1);
  return pickWeighted([
    { v: EnemyType.GRUNT,  w: 62 - 26*t },
    { v: EnemyType.RUNNER, w: 18 + 6*t  },
    { v: EnemyType.BRUTE,  w: 14 + 14*t },
    { v: EnemyType.TANK,   w: 6  + 22*t },
  ]);
}

function pickWeighted(items){
  let total = 0;
  for (const it of items) total += it.w;
  let r = Math.random() * total;
  for (const it of items){ r -= it.w; if (r <= 0) return it.v; }
  return items[items.length-1].v;
}

const enemies = [];
let boss = null;

function spawnPositionNearEdges(){
  const left = bounds.x + Math.floor(config.spawnEdgePadding * DPR);
  const right = bounds.x + bounds.w - Math.floor(config.spawnEdgePadding * DPR);
  const top = bounds.y + Math.floor(config.spawnEdgePadding * DPR);
  const bottom = bounds.y + bounds.h - Math.floor(config.spawnEdgePadding * DPR);

  const edge = Math.floor(Math.random() * 4);
  let x, y;
  if (edge === 0) { x = left; y = rand(top, bottom); }
  else if (edge === 1) { x = right; y = rand(top, bottom); }
  else if (edge === 2) { x = rand(left, right); y = top; }
  else { x = rand(left, right); y = bottom; }
  return { x, y };
}

function spawnEnemy(wave){
  const type = chooseEnemyType(wave);
  const arch = enemyArchetype(type);

  const hpMul = hpMultiplier(wave);
  const spMul = speedMultiplier(wave);

  let p = spawnPositionNearEdges();
  let tries = 0;
  const safeR = config.safeSpawnRadius * DPR;
  while (dist2(p.x, p.y, player.x, player.y) < safeR*safeR && tries < 80){
    p = spawnPositionNearEdges();
    tries++;
  }

  enemies.push({
    type,
    x: p.x, y: p.y,
    r: arch.r * DPR,
    hpMax: Math.round(arch.hp * hpMul),
    hp: Math.round(arch.hp * hpMul),
    speed: arch.speed * spMul * DPR,
    contactDmg: arch.dmg,
    color: arch.color,
    baseScore: arch.score,
    hitFlash: 0,
  });
}

function spawnBoss(){
  const t = 1; // wave 20
  boss = {
    x: bounds.x + bounds.w/2,
    y: bounds.y + bounds.h/2,
    r: 46 * DPR,
    hpMax: Math.round(1700 * (1 + 0.6*t)),
    hp: Math.round(1700 * (1 + 0.6*t)),
    speed: 58 * DPR,
    contactDmg: 18,
    color: '#ffd166',
    hitFlash: 0,
    dashTimer: 2.4,
    dashTimeLeft: 0,
    dashVx: 0, dashVy: 0,
    scoreValue: 700,
  };
}

// ---- Combat ----
const bolts = [];
const particles = [];
let fireCooldown = 0;

function spawnExplosion(x, y, color){
  const n = 10 + Math.floor(Math.random()*10);
  for (let i=0;i<n;i++){
    const a = Math.random()*Math.PI*2;
    const sp = rand(45, 210) * DPR;
    particles.push({ x, y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, life:rand(0.20,0.50), r:rand(2,4)*DPR, color });
  }
}

function fireBolts(dt){
  const s = effectiveStats();
  fireCooldown -= dt;
  if (!keys.Space) return;
  if (fireCooldown > 0) return;

  fireCooldown = 1 / s.fireRate;

  const baseAngle = player.angle;
  const count = 1 + s.spreadCount;
  const cone = (s.spreadCount === 0) ? 0 : (Math.PI/52) * (1 + s.spreadCount*0.7);

  for (let i=0;i<count;i++){
    const t = (count === 1) ? 0 : (i/(count-1))*2 - 1;
    const a = baseAngle + t*cone;

    const muzzle = 28 * DPR;
    const bx = player.x + Math.cos(a) * muzzle;
    const by = player.y + Math.sin(a) * muzzle;

    bolts.push({
      x: bx, y: by,
      vx: Math.cos(a) * s.boltSpeed * DPR,
      vy: Math.sin(a) * s.boltSpeed * DPR,
      life: 1.6,
      r: 5 * DPR,
      dmg: s.damage,
      pierceLeft: s.pierce,
    });
  }
}

function updateBolts(dt){
  for (let i=bolts.length-1;i>=0;i--){
    const b = bolts[i];
    b.x += b.vx*dt;
    b.y += b.vy*dt;
    b.life -= dt;
    if (b.life <= 0 || b.x < bounds.x-80 || b.x > bounds.x+bounds.w+80 || b.y < bounds.y-80 || b.y > bounds.y+bounds.h+80){
      bolts.splice(i,1);
    }
  }
}

function dealDamageToEnemy(e, amount){
  e.hp -= amount;
  e.hitFlash = 0.10;
}
function scoreForKill(wave, baseScore){
  // higher waves more valuable; early upgrades come quickly, later buys are meaningful
  const t = clamp((wave - 1) / 19, 0, 1);
  const mult = 1 + 1.8 * (t*t);              // up to ~2.8x
  const score = Math.round(baseScore * mult);
  const points = Math.max(1, Math.round(score * 0.22)); // points slower than score
  return { score, points };
}

function collideBolts(){
  for (let i=bolts.length-1;i>=0;i--){
    const b = bolts[i];

    // enemies
    for (let j=enemies.length-1;j>=0;j--){
      const e = enemies[j];
      const rr = b.r + e.r;
      if (dist2(b.x,b.y,e.x,e.y) <= rr*rr){
        dealDamageToEnemy(e, b.dmg);

        // hit spark
        particles.push({ x:b.x, y:b.y, vx:rand(-70,70)*DPR, vy:rand(-70,70)*DPR, life:0.12, r:2*DPR, color:'#52f5ff' });

        if (e.hp <= 0){
          spawnExplosion(e.x, e.y, e.color);
          const gain = scoreForKill(state.wave, e.baseScore);
          state.score += gain.score;
          state.points += gain.points;
          enemies.splice(j,1);
        }

        if (b.pierceLeft > 0) b.pierceLeft--;
        else { bolts.splice(i,1); break; }
      }
    }
    if (i >= bolts.length) continue;

    // boss
    if (boss){
      const rr = b.r + boss.r;
      if (dist2(b.x,b.y,boss.x,boss.y) <= rr*rr){
        boss.hp -= b.dmg;
        boss.hitFlash = 0.10;
        particles.push({ x:b.x, y:b.y, vx:rand(-70,70)*DPR, vy:rand(-70,70)*DPR, life:0.12, r:2*DPR, color:'#52f5ff' });

        if (boss.hp <= 0){
          spawnExplosion(boss.x, boss.y, boss.color);
          state.score += boss.scoreValue;
          boss = null;
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

  // knockback away
  const dx = player.x - fromX;
  const dy = player.y - fromY;
  const len = Math.hypot(dx,dy) || 1;
  player.x += (dx/len) * (config.contactKnockback * DPR) * 0.06;
  player.y += (dy/len) * (config.contactKnockback * DPR) * 0.06;

  clampPlayerToBounds();
  spawnExplosion(player.x, player.y, '#52f5ff');

  if (player.hp <= 0) onDeath();
}

function onDeath(){
  state.bestWave = Math.max(state.bestWave, state.wave);
  state.highScore = Math.max(state.highScore, state.score);
  localStorage.setItem('bestWave', String(state.bestWave));
  localStorage.setItem('highScore', String(state.highScore));

  openOverlay('gameover', 'Run Ended', `You reached Wave ${state.wave}. Score ${state.score}. Points and upgrades reset.`);
}

// ---- Enemy AI ----
function updateEnemies(dt){
  // normal enemies
  for (const e of enemies){
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const len = Math.hypot(dx,dy) || 1;
    e.x += (dx/len) * e.speed * dt;
    e.y += (dy/len) * e.speed * dt;

    e.x = clamp(e.x, bounds.x + e.r, bounds.x + bounds.w - e.r);
    e.y = clamp(e.y, bounds.y + e.r, bounds.y + bounds.h - e.r);

    if (e.hitFlash > 0) e.hitFlash -= dt;

    // contact damage, enemy does NOT die
    const rr = e.r + player.r;
    if (dist2(e.x,e.y,player.x,player.y) <= rr*rr){
      applyPlayerHit(e.contactDmg, e.x, e.y);

      // repel enemy a little to reduce “damage pinning”
      const rx = e.x - player.x;
      const ry = e.y - player.y;
      const rlen = Math.hypot(rx,ry) || 1;
      e.x += (rx/rlen) * 40 * DPR * dt;
      e.y += (ry/rlen) * 40 * DPR * dt;
    }
  }

  // boss
  if (boss){
    if (boss.hitFlash > 0) boss.hitFlash -= dt;

    boss.dashTimer -= dt;
    if (boss.dashTimer <= 0 && boss.dashTimeLeft <= 0){
      boss.dashTimer = rand(2.0, 3.1);
      boss.dashTimeLeft = rand(0.35, 0.55);
      const dx = player.x - boss.x;
      const dy = player.y - boss.y;
      const len = Math.hypot(dx,dy) || 1;
      const dashSpeed = boss.speed * 3.1;
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

    boss.x += vx*dt;
    boss.y += vy*dt;
    boss.x = clamp(boss.x, bounds.x + boss.r, bounds.x + bounds.w - boss.r);
    boss.y = clamp(boss.y, bounds.y + boss.r, bounds.y + bounds.h - boss.r);

    const rr = boss.r + player.r;
    if (dist2(boss.x,boss.y,player.x,player.y) <= rr*rr){
      applyPlayerHit(boss.contactDmg, boss.x, boss.y);
      // slight repel
      const rx = boss.x - player.x;
      const ry = boss.y - player.y;
      const rlen = Math.hypot(rx,ry) || 1;
      boss.x += (rx/rlen) * 55 * DPR * dt;
      boss.y += (ry/rlen) * 55 * DPR * dt;
    }
  }
}

// ---- Player movement (aim = movement direction) ----
function updatePlayer(dt){
  const s = effectiveStats();
  const ix = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
  const iy = (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0);

  if (ix !== 0 || iy !== 0){
    const len = Math.hypot(ix,iy) || 1;
    player.vx = (ix/len) * s.moveSpeed * DPR;
    player.vy = (iy/len) * s.moveSpeed * DPR;

    // smoother rotation: angular acceleration toward target
    const target = Math.atan2(iy, ix);
    const diff = shortestAngleDiff(player.angle, target);

    // accelerate angular velocity in direction of the diff
    const accel = clamp(diff * config.turnAccel, -config.turnAccel, config.turnAccel);
    player.angVel += accel * dt;
  } else {
    player.vx = 0; player.vy = 0;
  }

  // damp + clamp angular velocity, always
  player.angVel *= Math.exp(-config.turnDamp * dt);
  player.angVel = clamp(player.angVel, -config.maxAngVel, config.maxAngVel);
  player.angle = wrapAngle(player.angle + player.angVel * dt);

  player.x += player.vx * dt;
  player.y += player.vy * dt;

  clampPlayerToBounds();
  if (player.iTime > 0) player.iTime -= dt;
}

function clampPlayerToBounds(){
  const minX = bounds.x + player.r, maxX = bounds.x + bounds.w - player.r;
  const minY = bounds.y + player.r, maxY = bounds.y + bounds.h - player.r;
  player.x = clamp(player.x, minX, maxX);
  player.y = clamp(player.y, minY, maxY);
}

function clampAllToBounds(){
  // player
  player.r = 18 * DPR;
  player.size = 36 * DPR;
  clampPlayerToBounds();

  // enemies
  for (const e of enemies){
    e.x = clamp(e.x, bounds.x + e.r, bounds.x + bounds.w - e.r);
    e.y = clamp(e.y, bounds.y + e.r, bounds.y + bounds.h - e.r);
  }

  // boss
  if (boss){
    boss.x = clamp(boss.x, bounds.x + boss.r, bounds.x + bounds.w - boss.r);
    boss.y = clamp(boss.y, bounds.y + boss.r, bounds.y + bounds.h - boss.r);
  }
}

// ---- Particles ----
function updateParticles(dt){
  for (let i=particles.length-1;i>=0;i--){
    const p = particles[i];
    p.x += p.vx*dt;
    p.y += p.vy*dt;
    p.vx *= Math.exp(-6*dt);
    p.vy *= Math.exp(-6*dt);
    p.life -= dt;
    if (p.life <= 0) particles.splice(i,1);
  }
}

// ---- Wave spawning (paced) ----
function startWave(wave){
  // reset player health each wave (as requested)
  player.hpMax = config.baseHP;
  player.hp = player.hpMax;
  player.iTime = 0;

  // center player
  player.x = bounds.x + bounds.w/2;
  player.y = bounds.y + bounds.h/2;
  player.vx = 0; player.vy = 0;
  player.angVel = 0;

  enemies.length = 0;
  bolts.length = 0;
  particles.length = 0;
  boss = null;

  state.wave = wave;
  state.spawned = 0;

  if (wave < 20){
    state.totalToSpawn = config.waveEnemyCount;
    state.spawnTimer = 0; // spawn immediately on start
  } else {
    state.totalToSpawn = 0;
    state.spawned = 0;
    spawnBoss();
  }
}

function spawnIntervalForWave(wave){
  // pace stays paced; slightly faster later but never “all at once”
  const t = clamp((wave - 1) / 19, 0, 1);
  const interval = config.spawnIntervalBase - 0.18 * t; // 0.45 -> 0.27
  return Math.max(config.spawnIntervalMin, interval);
}

function updateSpawning(dt){
  if (state.wave >= 20) return;
  if (state.spawned >= state.totalToSpawn) return;

  state.spawnTimer -= dt;
  if (state.spawnTimer > 0) return;

  spawnEnemy(state.wave);
  state.spawned++;

  state.spawnTimer = spawnIntervalForWave(state.wave);
}

function waveRemaining(){
  const leftToSpawn = Math.max(0, state.totalToSpawn - state.spawned);
  const alive = enemies.length + (boss ? 1 : 0);
  return alive + leftToSpawn;
}

function finishWaveIfNeeded(){
  const remaining = waveRemaining();
  if (remaining > 0) return;

  if (state.wave >= 20){
    state.bestWave = Math.max(state.bestWave, 20);
    state.highScore = Math.max(state.highScore, state.score);
    localStorage.setItem('bestWave', String(state.bestWave));
    localStorage.setItem('highScore', String(state.highScore));
    openOverlay('win', 'Boss Defeated', `Final Score ${state.score}. Points and upgrades reset.`);
    return;
  }

  openShop();
}

// ---- UI / Shop / Menus ----
function setMode(mode){
  state.mode = mode;
  const show = (mode === 'start' || mode === 'paused' || mode === 'shop' || mode === 'gameover' || mode === 'win');
  if (show) overlay.classList.remove('hidden');
  else overlay.classList.add('hidden');
}

function renderShop(){
  shopList.innerHTML = '';
  shopItems.forEach((item, idx) => {
    const lvl = levelOf(item.id);
    const maxed = lvl >= item.maxLevel;
    const cost = costOf(item);

    const row = document.createElement('div');
    row.className = 'shopItem';

    const idxBox = document.createElement('div');
    idxBox.className = 'idx';
    idxBox.textContent = String(idx+1);

    const body = document.createElement('div');
    body.className = 'body';

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = `${item.name} (Lv ${lvl}/${item.maxLevel})`;

    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = item.desc;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const costEl = document.createElement('div');
    costEl.innerHTML = `Cost: <span class="cost">${maxed ? 'MAX' : cost}</span>`;
    const ptsEl = document.createElement('div');
    ptsEl.textContent = `You: ${state.points} pts`;
    meta.appendChild(costEl);
    meta.appendChild(ptsEl);

    body.appendChild(name);
    body.appendChild(desc);
    body.appendChild(meta);

    const btn = document.createElement('button');
    btn.textContent = maxed ? 'Maxed' : 'Buy';
    btn.disabled = maxed || state.points < cost;
    btn.addEventListener('click', () => tryBuy(idx));

    row.appendChild(idxBox);
    row.appendChild(body);
    row.appendChild(btn);
    shopList.appendChild(row);
  });
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
  renderShop();
  syncHud();
}

function openShop(){
  setMode('shop');
  panelTitle.textContent = `Wave ${state.wave} Complete`;
  panelSubtitle.textContent = `Spend points to upgrade. Points carry during this run.`;
  continueBtn.textContent = (state.wave === 19) ? 'Fight Boss' : 'Continue';
  restartBtn.classList.add('hidden');
  renderShop();
  syncHud();
}

function openOverlay(mode, title, subtitle){
  setMode(mode);
  panelTitle.textContent = title;
  panelSubtitle.textContent = subtitle;
  shopList.innerHTML = '';

  if (mode === 'start'){
    continueBtn.textContent = 'Start';
    restartBtn.classList.add('hidden');
  } else if (mode === 'paused'){
    continueBtn.textContent = 'Resume';
    restartBtn.classList.remove('hidden');
  } else {
    // gameover/win
    continueBtn.textContent = 'Restart';
    restartBtn.classList.add('hidden');
  }

  syncHud();
}

function togglePause(){
  if (state.mode === 'playing'){
    keys.Space = false; // avoid “stuck firing” when unpausing
    openOverlay('paused', 'Paused', `Wave ${state.wave} • Score ${state.score} • Points ${state.points}`);
  } else if (state.mode === 'paused'){
    setMode('playing');
  }
}

function onContinue(){
  if (state.mode === 'start'){
    startNewRun(); // starts wave 1 (fresh)
    return;
  }

  if (state.mode === 'paused'){
    setMode('playing');
    return;
  }

  if (state.mode === 'gameover' || state.mode === 'win'){
    startNewRun();
    return;
  }

  if (state.mode === 'shop'){
    // advance to next wave
    setMode('playing');
    startWave(state.wave + 1);
    syncHud();
  }
}

continueBtn.addEventListener('click', onContinue);
restartBtn.addEventListener('click', () => startNewRun());

// ---- HUD sync ----
function syncHud(){
  elScore.textContent = String(state.score);
  elPoints.textContent = String(state.points);
  elWave.textContent = String(state.wave);
  elRemaining.textContent = String(waveRemaining());
  elBestWave.textContent = String(state.bestWave);
  elHighScore.textContent = String(state.highScore);

  const hpPct = clamp(player.hp / player.hpMax, 0, 1);
  elHealthFill.style.width = `${hpPct*100}%`;
  elHealthFill.style.background =
    hpPct > 0.45 ? 'linear-gradient(90deg,#34d399,#22c55e)' :
    hpPct > 0.2  ? 'linear-gradient(90deg,#fbbf24,#f59e0b)' :
                  'linear-gradient(90deg,#fb7185,#ef4444)';
  elHealthText.textContent = `HP ${Math.max(0, Math.ceil(player.hp))} / ${player.hpMax}`;
}

// ---- Draw ----
function drawGrid(){
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = '#fff';
  const step = Math.floor(64 * DPR);
  for (let x=0; x<W; x+=step){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y=0; y<H; y+=step){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  ctx.restore();
}

function drawBoundary(){
  ctx.save();
  ctx.lineWidth = config.boundaryThickness * DPR;
  ctx.strokeStyle = config.boundaryColor;
  ctx.strokeRect(
    bounds.x - (config.boundaryThickness*DPR)/2,
    bounds.y - (config.boundaryThickness*DPR)/2,
    bounds.w + config.boundaryThickness*DPR,
    bounds.h + config.boundaryThickness*DPR
  );
  ctx.restore();
}

function polygon(x,y,r,sides,rot){
  ctx.beginPath();
  for (let i=0;i<sides;i++){
    const a = rot + (i/sides)*Math.PI*2;
    const px = x + Math.cos(a)*r;
    const py = y + Math.sin(a)*r;
    if (i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
  }
  ctx.closePath();
  ctx.fill();
}

function drawEnemies(){
  for (const e of enemies){
    ctx.save();
    ctx.globalAlpha = e.hitFlash > 0 ? 0.65 : 1;
    ctx.fillStyle = e.color;

    if (e.type === EnemyType.TANK) polygon(e.x, e.y, e.r, 6, 0.2);
    else if (e.type === EnemyType.RUNNER) polygon(e.x, e.y, e.r, 4, Math.PI/4);
    else if (e.type === EnemyType.BRUTE) polygon(e.x, e.y, e.r, 10, 0);
    else { ctx.beginPath(); ctx.arc(e.x,e.y,e.r,0,Math.PI*2); ctx.fill(); }

    // micro HP bar above
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
    ctx.fillStyle = boss.color;
    ctx.beginPath();
    ctx.arc(boss.x,boss.y,boss.r,0,Math.PI*2);
    ctx.fill();

    // boss hp bar top-center inside arena
    const barW = Math.min(520*DPR, bounds.w*0.7);
    const barH = 10*DPR;
    const x = bounds.x + (bounds.w - barW)/2;
    const y = bounds.y - 22*DPR;
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(230,238,248,.14)';
    roundRect(x, y, barW, barH, 10*DPR, true);
    ctx.fillStyle = '#ffd166';
    roundRect(x, y, barW*clamp(boss.hp/boss.hpMax,0,1), barH, 10*DPR, true);

    ctx.restore();
  }
}

function roundRect(x,y,w,h,r,fill){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
  if (fill) ctx.fill();
}

function drawBolts(){
  for (const b of bolts){
    ctx.save();
    ctx.fillStyle = '#52f5ff';
    ctx.beginPath();
    ctx.ellipse(b.x,b.y,b.r,b.r,0,0,Math.PI*2);
    ctx.fill();

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
    ctx.globalAlpha = clamp(p.life / 0.5, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
}

function drawPlayer(){
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(player.angle);

  const inv = player.iTime > 0;
  ctx.globalAlpha = inv ? 0.72 : 1;

  // simple taser-ish silhouette (no external image needed)
  ctx.fillStyle = '#e6eef8';
  // body
  roundRect(-18*DPR, -12*DPR, 36*DPR, 24*DPR, 6*DPR, true);
  // front
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(18*DPR, -5*DPR, 14*DPR, 10*DPR);
  // grip
  ctx.fillStyle = 'rgba(230,238,248,.85)';
  roundRect(-6*DPR, 6*DPR, 14*DPR, 16*DPR, 5*DPR, true);

  ctx.restore();
}

// ---- Main update/draw loop ----
function update(dt){
  if (state.mode !== 'playing') return;

  updatePlayer(dt);
  updateSpawning(dt);

  fireBolts(dt);
  updateBolts(dt);
  updateEnemies(dt);
  collideBolts();
  updateParticles(dt);

  finishWaveIfNeeded();
  syncHud();
}

function draw(){
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,W,H);

  drawGrid();
  drawBoundary();
  drawParticles();
  drawBolts();
  drawEnemies();
  drawPlayer();
}

// ---- Run lifecycle ----
function startNewRun(){
  // reset run-only economy
  state.wave = 1;
  state.score = 0;
  state.points = 0;

  for (const k in upgrades) upgrades[k] = 0;

  setMode('playing');
  startWave(1);
  syncHud();
}

// ---- Init ----
function init(){
  resize();

  state.bestWave = Number(localStorage.getItem('bestWave') || 1);
  state.highScore = Number(localStorage.getItem('highScore') || 0);

  // Start menu first (no mechanics running yet)
  openOverlay('start', 'Taser Arena', 'Start a run • Survive waves • Upgrade between waves • Boss on Wave 20');

  let last = performance.now();
  function loop(now){
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
init();