/* =========================================================================
   เกมฝึกเอาตัวรอดจากอุบัติเหตุบนท้องถนน (เวอร์ชันประเทศไทย 🇹🇭)
   ========================================================================= */

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const W = canvas.width;   // 960
const H = canvas.height;  // 600

const GOAL_Y = 85;
const HOME_Y = 560;
const PLAYER_SPEED = 190;

const STORAGE_KEY = 'roadSafetyThaiHighScore';

const STATE = {
  MENU: 'MENU', HOWTO: 'HOWTO', PLAYING: 'PLAYING', PAUSED: 'PAUSED',
  LEVEL_COMPLETE: 'LEVEL_COMPLETE', GAME_OVER: 'GAME_OVER', WIN: 'WIN'
};
let state = STATE.MENU;

/* ---------------------------------------------------------------------
   PARTICLES & FLOATING TEXT ENGINE
   --------------------------------------------------------------------- */
let particles = [];
let floatTexts = [];
let globalTime = 0;

function spawnParticles(x, y, count, color, speedScale = 1) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (Math.random() * 80 + 40) * speedScale;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: Math.random() * 5 + 3,
      color,
      alpha: 1,
      life: Math.random() * 0.4 + 0.4
    });
  }
}

function spawnExhaust(car) {
  const rearX = car.x - car.dir * (car.w / 2);
  const exhaustY = car.y + car.h / 4;
  particles.push({
    x: rearX + (Math.random() * 4 - 2),
    y: exhaustY + (Math.random() * 4 - 2),
    vx: -car.dir * (Math.random() * 15 + 10),
    vy: (Math.random() - 0.5) * 8,
    size: Math.random() * 4 + 2,
    color: 'rgba(200, 200, 200, 0.4)',
    alpha: 0.5,
    life: 0.35
  });
}

function addFloatText(x, y, text, color) {
  floatTexts.push({ x, y, text, color, alpha: 1, scale: 0.5, life: 1.2 });
}

function updateParticlesAndText(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.alpha -= dt / p.life;
    p.size = Math.max(0, p.size - dt * 2);
    if (p.alpha <= 0 || p.size <= 0) particles.splice(i, 1);
  }

  for (let i = floatTexts.length - 1; i >= 0; i--) {
    const ft = floatTexts[i];
    ft.y -= dt * 35;
    ft.scale = Math.min(1.2, ft.scale + dt * 4);
    ft.alpha -= dt / ft.life;
    if (ft.alpha <= 0) floatTexts.splice(i, 1);
  }
}

/* ---------------------------------------------------------------------
   AUDIO SYSTEM
   --------------------------------------------------------------------- */
let audioCtx = null;
let soundOn = true;

function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { audioCtx = null; }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function beep(freq, dur, type = 'sine', vol = 0.18, delay = 0) {
  if (!soundOn) return;
  ensureAudio();
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

const SFX = {
  click: () => beep(520, 0.08, 'square', 0.12),
  good: () => { beep(660, 0.1, 'sine'); beep(880, 0.16, 'sine', 0.16, 0.09); },
  bad: () => { beep(180, 0.05, 'sawtooth', 0.2); },
  crash: () => { beep(120, 0.35, 'sawtooth', 0.25); beep(80, 0.4, 'square', 0.2, 0.05); },
  levelUp: () => { beep(523, 0.12); beep(659, 0.12, 'sine', 0.18, 0.1); beep(784, 0.2, 'sine', 0.2, 0.2); },
  win: () => { [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.22, 'sine', 0.2, i * 0.14)); },
  honk: () => { beep(400, 0.15, 'triangle', 0.15); }
};

/* ---------------------------------------------------------------------
   VEHICLES CONFIG
   --------------------------------------------------------------------- */
const VEHICLE_TYPES = [
  { type: 'taxi_pink', color: '#ff2a8d', roofColor: '#d81b60', w: 54, h: 26, name: 'แท็กซี่ชมพู' },
  { type: 'taxi_green_yellow', color: '#ffca28', secondary: '#2e7d32', w: 54, h: 26, name: 'แท็กซี่เขียวเหลือง' },
  { type: 'tuktuk', color: '#0277bd', roof: '#fbc02d', w: 44, h: 24, name: 'ตุ๊กตุ๊ก' },
  { type: 'car_red', color: '#e53935', roofColor: '#b71c1c', w: 52, h: 26, name: 'เก๋งแดง' },
  { type: 'pickup', color: '#546e7a', roofColor: '#37474f', w: 58, h: 28, name: 'กระบะ' },
  { type: 'bike', color: '#f57c00', w: 34, h: 18, name: 'มอเตอร์ไซค์' },
  { type: 'bus', color: '#ff6f00', secondary: '#ffffff', w: 85, h: 32, name: 'รถเมล์' }
];

function getRandomVehicleType() {
  return VEHICLE_TYPES[Math.floor(Math.random() * VEHICLE_TYPES.length)];
}

/* --- รถหน้าเมนูหลัก --- */
const menuStreetCars = [
  { x: -100, y: 330, dir: 1, speed: 110, vData: VEHICLE_TYPES[0], w: 54, h: 26 },
  { x: 380, y: 380, dir: -1, speed: 100, vData: VEHICLE_TYPES[2], w: 44, h: 24 },
  { x: -350, y: 330, dir: 1, speed: 135, vData: VEHICLE_TYPES[6], w: 85, h: 32 },
  { x: W + 120, y: 380, dir: -1, speed: 115, vData: VEHICLE_TYPES[1], w: 54, h: 26 },
  { x: W + 380, y: 380, dir: -1, speed: 125, vData: VEHICLE_TYPES[5], w: 34, h: 18 }
];

function makeLane(cars, roadY, offsetY, dir, speed, count, turning = false, laneIdx = 0) {
  const minSpacing = 160; 
  for (let i = 0; i < count; i++) {
    const v = getRandomVehicleType();
    const startX = dir === 1 ? (i * -minSpacing) - 60 : W + (i * minSpacing) + 60;
    cars.push({
      x: startX, y: roadY + offsetY, w: v.w, h: v.h,
      dir, speed, baseSpeed: speed,
      vData: v,
      turning, turnBlink: Math.random() * 2,
      laneIdx
    });
  }
}

/* ---------------------------------------------------------------------
   BUILD ROAD & LEVELS
   --------------------------------------------------------------------- */
function buildRoad(config) {
  const cars = [];
  const numLanes = config.lanes.length;
  const laneH = config.height / numLanes;

  config.lanes.forEach((laneCfg, idx) => {
    const autoOffset = -config.height / 2 + (idx + 0.5) * laneH;
    const finalOffset = laneCfg.offset !== undefined ? laneCfg.offset : autoOffset;

    makeLane(
      cars, config.y, finalOffset, laneCfg.dir,
      laneCfg.speed, laneCfg.count, laneCfg.turning || false, idx
    );
  });

  return {
    y: config.y,
    height: config.height,
    numLanes: numLanes,
    crosswalkX: config.crosswalkX || [380, 580],
    hasLight: config.hasLight !== undefined ? config.hasLight : true,
    durations: config.durations || { green: 4000, yellow: 1200, red: 4500 },
    phase: 'green',
    phaseTimer: 0,
    cars,
    state: 'below',
    crossed: false,
    crossingState: null,
  };
}

function buildLevel(n) {
  switch (n) {
    case 1:
      return {
        name: 'ด่าน 1: ข้ามทางม้าลายตามสัญญาณไฟ',
        mission: 'รอไฟแดงคนข้าม แล้วข้ามทางม้าลายอย่างปลอดภัย',
        timeLimit: 90,
        roads: [buildRoad({
          y: 320, height: 90, crosswalkX: [380, 580], hasLight: true,
          durations: { green: 4200, yellow: 1200, red: 4600 },
          lanes: [
            { offset: -22.5, dir: 1, speed: 95, count: 2 },
            { offset: 22.5, dir: -1, speed: 95, count: 2 },
          ],
        })],
      };
    case 2:
      return {
        name: 'ด่าน 2: สัญญาณไฟจราจรและขอทาง',
        mission: 'ใช้สัญญาณไฟและกด [Spacebar] หรือ [✋] เพื่อยกมือขอทางที่ทางม้าลาย',
        timeLimit: 80,
        roads: [buildRoad({
          y: 320, height: 90, crosswalkX: [380, 580], hasLight: true,
          durations: { green: 4500, yellow: 1200, red: 4500 },
          lanes: [
            { offset: -22.5, dir: 1, speed: 125, count: 3 },
            { offset: 22.5, dir: -1, speed: 125, count: 3 },
          ],
        })],
      };
    case 3:
      return {
        name: 'ด่าน 3: ข้าม 2 ถนนปลอดภัย',
        mission: 'สังเกตสัญญาณไฟและทางม้าลายในการข้ามถนนทั้ง 2 สาย',
        timeLimit: 85,
        roads: [
          buildRoad({
            y: 220, height: 90, crosswalkX: [380, 580], hasLight: true,
            durations: { green: 4000, yellow: 1000, red: 4200 },
            lanes: [
              { offset: -22.5, dir: 1, speed: 110, count: 2, turning: true },
              { offset: 22.5, dir: -1, speed: 110, count: 2 },
            ],
          }),
          buildRoad({
            y: 420, height: 90, crosswalkX: [380, 580], hasLight: true,
            durations: { green: 4500, yellow: 1200, red: 4500 },
            lanes: [
              { offset: -22.5, dir: 1, speed: 135, count: 3 },
              { offset: 22.5, dir: -1, speed: 135, count: 2, turning: true },
            ],
          }),
        ],
      };
    case 4:
      return {
        name: 'ด่าน 4: การจราจรหนาแน่นหน้าตลาด',
        mission: 'ใช้ทางม้าลาย และรอสัญญาณไฟแดงจังหวะรถว่าง',
        timeLimit: 85,
        roads: [
          buildRoad({
            y: 210, height: 90, crosswalkX: [370, 590], hasLight: true,
            durations: { green: 3800, yellow: 1000, red: 4200 },
            lanes: [
              { offset: -22.5, dir: 1, speed: 140, count: 3 },
              { offset: 22.5, dir: -1, speed: 140, count: 3 },
            ],
          }),
          buildRoad({
            y: 430, height: 90, crosswalkX: [370, 590], hasLight: true,
            durations: { green: 4000, yellow: 1000, red: 4000 },
            lanes: [
              { offset: -22.5, dir: -1, speed: 150, count: 3 },
              { offset: 22.5, dir: 1, speed: 150, count: 3 },
            ],
          }),
        ],
      };
    case 5:
      return {
        name: 'ด่าน 5: ท้องถนนกรุงเทพฯ สภาพจราจรซับซ้อน',
        mission: 'ข้ามให้ครบ 3 ถนน โดยใช้ทางม้าลายและสัญญาณไฟ',
        timeLimit: 100,
        roads: [
          buildRoad({
            y: 180, height: 80, crosswalkX: [380, 580], hasLight: true,
            durations: { green: 3800, yellow: 1000, red: 4000 },
            lanes: [
              { offset: -20, dir: 1, speed: 145, count: 2, turning: true },
              { offset: 20, dir: -1, speed: 145, count: 2 },
            ],
          }),
          buildRoad({
            y: 320, height: 80, crosswalkX: [380, 580], hasLight: true,
            durations: { green: 4000, yellow: 1000, red: 4200 },
            lanes: [
              { offset: -20, dir: 1, speed: 160, count: 3 },
              { offset: 20, dir: -1, speed: 160, count: 3 },
            ],
          }),
          buildRoad({
            y: 460, height: 80, crosswalkX: [370, 590], hasLight: true,
            durations: { green: 3800, yellow: 1000, red: 4000 },
            lanes: [
              { offset: -20, dir: 1, speed: 155, count: 3, turning: true },
              { offset: 20, dir: -1, speed: 155, count: 3 },
            ],
          }),
        ],
      };
  }
}

const TOTAL_LEVELS = 5;

let game = {
  score: 0,
  highScore: Number(localStorage.getItem(STORAGE_KEY) || 0),
  levelIndex: 1,
  missionsCompleted: 0,
  timeLeft: 90,
  level: null,
  player: null,
  keys: {},
  lastTime: 0,
};

function newPlayer() {
  return { x: W / 2, y: HOME_Y, w: 28, h: 36, moving: false, dir: 'up', animT: 0, raisingHand: false };
}

function startNewGame() {
  game.score = 0;
  game.levelIndex = 1;
  game.missionsCompleted = 0;
  loadLevel(1);
}

function loadLevel(n) {
  game.levelIndex = n;
  game.level = buildLevel(n);
  game.timeLeft = game.level.timeLimit;
  game.player = newPlayer();
  document.getElementById('missionDesc').textContent = game.level.mission;
  updateHUD();
  setHint(hintForLevel(n));
}

function hintForLevel(n) {
  const base = 'เดิน: ปุ่มลูกศร/WASD • ✋ ชูมือ: [Spacebar] • ';
  switch (n) {
    case 1: return base + 'รอไฟแดงคนข้าม แล้วข้ามทางม้าลาย';
    case 2: return base + 'ยืนที่ทางม้าลาย แล้วกด Spacebar ค้างไว้เพื่อชูมือขอทาง!';
    case 3: return base + 'ระวังรถ ข้ามทางม้าลายตามสัญญาณไฟ';
    case 4: return base + 'รถเยอะมาก! ใช้ทางม้าลายและชูมือขอทาง';
    case 5: return base + 'ด่านสุดท้าย! ใช้ทางม้าลายและสัญญาณไฟอย่างเคร่งครัด';
  }
  return base;
}

/* ---------------------------------------------------------------------
   INPUT BINDINGS & UI HELPERS
   --------------------------------------------------------------------- */
const KEYMAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
  W: 'up', S: 'down', A: 'left', D: 'right',
  ' ': 'hand',
};

window.addEventListener('keydown', (e) => {
  ensureAudio();
  if (KEYMAP[e.key]) { game.keys[KEYMAP[e.key]] = true; e.preventDefault(); }
  if (e.key === 'Escape' && (state === STATE.PLAYING || state === STATE.PAUSED)) togglePause();
});

window.addEventListener('keyup', (e) => {
  if (KEYMAP[e.key]) { game.keys[KEYMAP[e.key]] = false; e.preventDefault(); }
});

function bindTouch(id, dir) {
  const el = document.getElementById(id);
  if (!el) return;
  const on = (e) => { e.preventDefault(); ensureAudio(); game.keys[dir] = true; };
  const off = (e) => { e.preventDefault(); game.keys[dir] = false; };
  el.addEventListener('touchstart', on, { passive: false });
  el.addEventListener('touchend', off, { passive: false });
  el.addEventListener('touchcancel', off, { passive: false });
  el.addEventListener('mousedown', on);
  el.addEventListener('mouseup', off);
  el.addEventListener('mouseleave', off);
}
bindTouch('tUp', 'up'); bindTouch('tDown', 'down');
bindTouch('tLeft', 'left'); bindTouch('tRight', 'right');
bindTouch('tHand', 'hand');

function updateHUD() {
  document.getElementById('scoreValue').innerHTML = `${game.score} <span class="star">★</span>`;
  document.getElementById('timeValue').textContent = formatTime(game.timeLeft);
  document.getElementById('levelValue').textContent = `${game.levelIndex} / ${TOTAL_LEVELS}`;
  document.getElementById('missionProgress').textContent = `(${game.missionsCompleted} / ${TOTAL_LEVELS})`;
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function setHint(msg) {
  document.getElementById('hintPanel').textContent = msg;
}

function showToast(text, type = 'good') {
  const toast = document.getElementById('feedbackToast');
  toast.textContent = text;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), 2200);
}

function showScreen(screenId) {
  const screens = ['menuScreen', 'howtoScreen', 'pauseScreen', 'levelCompleteScreen', 'gameOverScreen', 'winScreen'];
  screens.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (id === screenId) el.classList.remove('hidden');
      else el.classList.add('hidden');
    }
  });

  const hud = document.getElementById('hud');
  const touch = document.getElementById('touchControls');
  if (state === STATE.PLAYING || state === STATE.PAUSED) {
    hud.classList.remove('hidden');
    touch.classList.remove('hidden');
  } else {
    hud.classList.add('hidden');
    touch.classList.add('hidden');
  }
}

function togglePause() {
  if (state === STATE.PLAYING) {
    state = STATE.PAUSED;
    showScreen('pauseScreen');
  } else if (state === STATE.PAUSED) {
    state = STATE.PLAYING;
    showScreen('');
  }
}



/* ---------------------------------------------------------------------
   UPDATE LOGIC
   --------------------------------------------------------------------- */
function update(dt) {
  globalTime += dt;
  if (state === STATE.PLAYING) {
    updateTimer(dt);
    updatePlayer(dt);
    game.level.roads.forEach(road => updateRoad(road, dt));
    checkCollisions();
    checkCrossings();
    checkGoal();
  } else if (state === STATE.MENU || state === STATE.HOWTO) {
    updateMenuScene(dt);
  }
  updateParticlesAndText(dt);
}

function updateMenuScene(dt) {
  menuClouds.forEach(c => {
    c.x += c.speed * dt;
    if (c.x - 60 * c.scale > W) c.x = -60 * c.scale;
  });

  menuBirds.forEach(b => {
    b.x += b.speed * dt;
    if (b.x > W + 20) b.x = -20;
  });

  // อัปเดตรถหน้าเมนูด้วยระบบ Anti-Overlap (ไม่ทับกันเด็ดขาด)
  menuStreetCars.forEach(car => {
    if (car.baseSpeed === undefined) car.baseSpeed = car.speed;
    if (car.currSpeed === undefined) car.currSpeed = car.speed;

    let targetSpeed = car.baseSpeed;

    // คำนวณระยะห่างหาคันหน้าในเลนและทิศทางเดียวกัน
    let aheadDist = Infinity;
    let aheadCar = null;

    menuStreetCars.forEach(other => {
      if (other === car || other.dir !== car.dir || other.y !== car.y) return;
      const dist = car.dir === 1 ? (other.x - car.x) : (car.x - other.x);
      if (dist > 0 && dist < aheadDist) {
        aheadDist = dist;
        aheadCar = other;
      }
    });

    // ถ้าระยะห่างประชิดกว่าค่าปลอดภัย (safeGap) ให้สั่งหยุดรถทันที
    if (aheadCar) {
      const safeGap = (car.w / 2 + aheadCar.w / 2) + 24;
      const gap = aheadDist - safeGap;

      if (gap <= 0) {
        targetSpeed = 0;
        car.currSpeed = 0; // เบรกหยุดสนิททันที
      } else if (gap < 100) {
        const followSpeed = Math.min(aheadCar.currSpeed, car.baseSpeed * (gap / 100));
        targetSpeed = Math.min(targetSpeed, followSpeed);
      }
    }

    // ปรับความเร็วอย่างนุ่มนวล
    car.currSpeed += (targetSpeed - car.currSpeed) * Math.min(1, dt * 8);
    car.x += car.dir * car.currSpeed * dt;

    // ป้องกันรถวนกลับมาสปอว์นทับกัน
    const minRespawnGap = 150;
    if (car.dir === 1 && car.x - car.w / 2 > W + 120) {
      const isBlocked = menuStreetCars.some(o => o !== car && o.dir === 1 && o.y === car.y && o.x < minRespawnGap);
      if (!isBlocked) {
        car.x = -120;
        car.vData = getRandomVehicleType();
        car.w = car.vData.w;
        car.h = car.vData.h;
        car.currSpeed = car.baseSpeed;
      }
    } else if (car.dir === -1 && car.x + car.w / 2 < -120) {
      const isBlocked = menuStreetCars.some(o => o !== car && o.dir === -1 && o.y === car.y && o.x > W - minRespawnGap);
      if (!isBlocked) {
        car.x = W + 120;
        car.vData = getRandomVehicleType();
        car.w = car.vData.w;
        car.h = car.vData.h;
        car.currSpeed = car.baseSpeed;
      }
    }
  });
}

function updateTimer(dt) {
  game.timeLeft -= dt;
  if (game.timeLeft <= 0) {
    game.timeLeft = 0;
    endGame(false, 'timeout');
  }
  updateHUD();
}

function updatePlayer(dt) {
  const p = game.player;
  let vx = 0, vy = 0;
  if (game.keys.up) vy -= 1;
  if (game.keys.down) vy += 1;
  if (game.keys.left) vx -= 1;
  if (game.keys.right) vx += 1;

  p.raisingHand = Boolean(game.keys.hand);

  p.moving = vx !== 0 || vy !== 0;
  if (p.moving) {
    const len = Math.hypot(vx, vy) || 1;
    vx /= len; vy /= len;
    p.x += vx * PLAYER_SPEED * dt;
    p.y += vy * PLAYER_SPEED * dt;
    if (Math.abs(vx) > Math.abs(vy)) p.dir = vx > 0 ? 'right' : 'left';
    else p.dir = vy > 0 ? 'down' : 'up';
    p.animT += dt;
  }
  p.x = Math.max(20, Math.min(W - 20, p.x));
  p.y = Math.max(GOAL_Y - 15, Math.min(HOME_Y + 25, p.y));
}

function updateRoad(road, dt) {
  if (road.hasLight) {
    road.phaseTimer += dt * 1000;
    const d = road.durations;
    if (road.phase === 'green' && road.phaseTimer >= d.green) { road.phase = 'yellow'; road.phaseTimer = 0; }
    else if (road.phase === 'yellow' && road.phaseTimer >= d.yellow) { road.phase = 'red'; road.phaseTimer = 0; }
    else if (road.phase === 'red' && road.phaseTimer >= d.red) { road.phase = 'green'; road.phaseTimer = 0; }
  }

  const p = game.player;
  const isPlayerNearRoad = Math.abs(p.y - road.y) < road.height + 40;
  const isPlayerAtCrosswalk = p.x > road.crosswalkX[0] - 30 && p.x < road.crosswalkX[1] + 30;
  const isPlayerRaisingHand = p.raisingHand && isPlayerNearRoad && isPlayerAtCrosswalk;

  const stopMarginFront = 46;

  road.cars.forEach(car => {
    car.turnBlink += dt;
    let targetSpeed = car.baseSpeed;

    if (car.speed > 10 && Math.random() < 0.25) {
      spawnExhaust(car);
    }

    // 1. ตรวจสอบจังหวะหยุดรถ (ไฟจราจร / ชูมือขอทาง)
    if (road.hasLight) {
      const stopLine = car.dir === 1 ? road.crosswalkX[0] - stopMarginFront
                                     : road.crosswalkX[1] + stopMarginFront;
      const front = car.dir === 1 ? car.x + car.w / 2 : car.x - car.w / 2;
      const hasPassedLine = car.dir === 1 ? front > stopLine : front < stopLine;

      if (!hasPassedLine) {
        if (road.phase === 'yellow') {
          targetSpeed = car.baseSpeed * 0.45;
        } else if (road.phase === 'red') {
          const dist = car.dir === 1 ? (stopLine - front) : (front - stopLine);
          targetSpeed = dist <= 4 ? 0 : car.baseSpeed * Math.max(0, Math.min(1, dist / 150));
        }
      }
    } 
    
    if (isPlayerRaisingHand) {
      const stopLine = car.dir === 1 ? road.crosswalkX[0] - stopMarginFront - 15
                                     : road.crosswalkX[1] + stopMarginFront + 15;
      const front = car.dir === 1 ? car.x + car.w / 2 : car.x - car.w / 2;
      const distToCrosswalk = car.dir === 1 ? (stopLine - front) : (front - stopLine);

      if (distToCrosswalk > 0 && distToCrosswalk < 220) {
        const handStopSpeed = distToCrosswalk <= 8 ? 0 : car.baseSpeed * (distToCrosswalk / 220);
        targetSpeed = Math.min(targetSpeed, handStopSpeed);
      }
    }

    if (car.turning) {
      const distToMid = Math.abs(car.x - (road.crosswalkX[0] + road.crosswalkX[1]) / 2);
      if (distToMid < 90) targetSpeed *= 0.55;
    }

    // 2. ระบบรักษาระยะห่างป้องกันรถชนกันเอง (Anti-Rear-End System)
    let aheadDist = Infinity;
    let aheadCar = null;

    road.cars.forEach(other => {
      if (other === car || other.dir !== car.dir || other.laneIdx !== car.laneIdx) return;

      const d = car.dir === 1 ? (other.x - car.x) : (car.x - other.x);
      if (d > 0 && d < aheadDist) {
        aheadDist = d;
        aheadCar = other;
      }
    });

    if (aheadCar) {
      const safeGap = (car.w / 2 + aheadCar.w / 2) + 24; // เว้นระยะห่างปลอดภัย 24px
      const gap = aheadDist - safeGap;

      if (gap <= 0) {
        targetSpeed = 0;
        car.speed = 0; // จอดทันทีถ้าประชิดเกินไป
      } else if (gap < 100) {
        const followSpeed = Math.min(aheadCar.speed, car.baseSpeed * (gap / 100));
        targetSpeed = Math.min(targetSpeed, followSpeed);
      }
    }

    // ปรับความเร็วรถอย่างนุ่มนวล
    car.speed += (targetSpeed - car.speed) * Math.min(1, dt * 8);
    car.x += car.dir * car.speed * dt;

    // 3. ป้องกันรถวนกลับมาเกิดทับกัน (Respawn Protection)
    const minRespawnGap = 150;
    if (car.dir === 1 && car.x - car.w / 2 > W + 60) {
      const isBlocked = road.cars.some(o => o !== car && o.dir === 1 && o.laneIdx === car.laneIdx && o.x < minRespawnGap);
      if (!isBlocked) {
        car.x = -60;
        car.vData = getRandomVehicleType();
        car.w = car.vData.w;
        car.h = car.vData.h;
        car.speed = car.baseSpeed;
      }
    } else if (car.dir === -1 && car.x + car.w / 2 < -60) {
      const isBlocked = road.cars.some(o => o !== car && o.dir === -1 && o.laneIdx === car.laneIdx && o.x > W - minRespawnGap);
      if (!isBlocked) {
        car.x = W + 60;
        car.vData = getRandomVehicleType();
        car.w = car.vData.w;
        car.h = car.vData.h;
        car.speed = car.baseSpeed;
      }
    }
  });
}

function rectsOverlap(a, b) {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 4 &&
         Math.abs(a.y - b.y) < (a.h + b.h) / 2 - 4;
}

function checkCollisions() {
  const p = game.player;
  const pRect = { x: p.x, y: p.y, w: p.w, h: p.h };
  for (const road of game.level.roads) {
    for (const car of road.cars) {
      if (rectsOverlap(pRect, car)) {
        spawnParticles(p.x, p.y, 25, '#d32f2f', 1.8);
        endGame(false, 'crash');
        return;
      }
    }
  }
}

function pedestrianSafeToStart(road) {
  if (road.hasLight) return road.phase === 'red';
  if (game.player.raisingHand) return true;
  const dangerZone = 160;
  return !road.cars.some(c => Math.abs(c.x - (road.crosswalkX[0] + road.crosswalkX[1]) / 2) < dangerZone);
}

function checkCrossings() {
  const p = game.player;
  game.level.roads.forEach(road => {
    const top = road.y - road.height / 2;
    const bottom = road.y + road.height / 2;
    const inside = p.y > top && p.y < bottom;

    if (road.state === 'below' && inside) {
      road.state = 'crossing';
      road.crossingState = {
        usedCrosswalk: p.x > road.crosswalkX[0] - 14 && p.x < road.crosswalkX[1] + 14,
        safeStart: pedestrianSafeToStart(road),
        raisedHand: p.raisingHand
      };
    } else if (road.state === 'crossing') {
      if (inside) {
        const okX = p.x > road.crosswalkX[0] - 14 && p.x < road.crosswalkX[1] + 14;
        if (!okX) road.crossingState.usedCrosswalk = false;
        if (p.raisingHand) road.crossingState.raisedHand = true;
      } else if (p.y <= top) {
        finalizeCrossing(road);
      } else if (p.y >= bottom) {
        road.state = 'below'; road.crossingState = null;
      }
    } else if (road.state === 'above' && p.y >= bottom) {
      road.state = 'below';
      road.crossed = false;
    }
  });
}

function finalizeCrossing(road) {
  road.state = 'above';
  if (road.crossed) return;
  road.crossed = true;
  const cs = road.crossingState;
  let gain, msg, cls;

  if (cs.usedCrosswalk && cs.raisedHand && road.phase === 'red') {
    gain = 150; msg = 'สุดยอด! ข้ามทางม้าลายตอนไฟแดงพร้อมชูมือขอทาง'; cls = 'good'; SFX.good();
    spawnParticles(game.player.x, game.player.y, 20, '#ffd700', 1.2);
  } else if (cs.usedCrosswalk && cs.safeStart) {
    gain = 100; msg = 'ถูกต้อง! ข้ามทางม้าลายตามสัญญาณไฟปลอดภัย'; cls = 'good'; SFX.good();
    spawnParticles(game.player.x, game.player.y, 15, '#4caf50', 1);
  } else if (cs.usedCrosswalk && !cs.safeStart) {
    gain = 30; msg = 'ข้ามได้แต่เสี่ยง! ควรอัตโนมัติรอไฟแดงสำหรับคนข้ามก่อน'; cls = 'bad'; SFX.bad();
  } else {
    gain = 10; msg = 'ควรใช้ทางม้าลายและสังเกตสัญญาณไฟทุกครั้ง'; cls = 'bad'; SFX.bad();
  }
  game.score += gain;
  addFloatText(game.player.x, game.player.y - 30, `+${gain}`, gain >= 100 ? '#ffd700' : '#4caf50');
  showToast(`${msg} (+${gain})`, cls);
  updateHUD();
}

function checkGoal() {
  if (game.player.y - game.player.h / 2 <= GOAL_Y) {
    endLevel();
  }
}

/* ---------------------------------------------------------------------
   LEVEL / GAME FLOW
   --------------------------------------------------------------------- */
function endLevel() {
  if (state !== STATE.PLAYING) return;
  if (game.levelIndex >= TOTAL_LEVELS) {
    endGame(true, 'win');
    return;
  }
  state = STATE.LEVEL_COMPLETE;
  game.missionsCompleted++;
  SFX.levelUp();
  const gain = 50;
  game.score += gain;
  document.getElementById('levelScoreGain').textContent = '+' + gain;
  document.getElementById('levelTotalScore').textContent = game.score;
  document.getElementById('levelCompleteMsg').textContent = `ผ่าน ${game.level.name} สำเร็จ!`;
  document.getElementById('nextLevelBtn').textContent = 'ต่อไป';
  showScreen('levelCompleteScreen');
}

function endGame(won, reason) {
  if (state === STATE.GAME_OVER || state === STATE.WIN) return;
  if (won) {
    state = STATE.WIN;
    SFX.win();
    saveHighScore();
    document.getElementById('winScore').textContent = game.score;
    document.getElementById('winHighScore').textContent = game.highScore;
    showScreen('winScreen');
  } else {
    state = STATE.GAME_OVER;
    if (reason === 'crash') SFX.crash(); else SFX.bad();
    saveHighScore();
    document.getElementById('gameOverTitle').textContent = 'เกมจบแล้ว';
    document.getElementById('gameOverMsg').textContent = reason === 'crash' ? 'คุณถูกรถชน!' : 'หมดเวลา! คุณไปโรงเรียนไม่ทัน';
    document.getElementById('finalScore').textContent = game.score;
    document.getElementById('finalHighScore').textContent = game.highScore;
    showScreen('gameOverScreen');
  }
}

function saveHighScore() {
  if (game.score > game.highScore) {
    game.highScore = game.score;
    localStorage.setItem(STORAGE_KEY, String(game.highScore));
  }
  document.getElementById('menuHighScore').textContent = game.highScore;
}

/* ---------------------------------------------------------------------
   GRAPHICS RENDERING ENGINE
   --------------------------------------------------------------------- */
function draw() {
  ctx.clearRect(0, 0, W, H);

  if (state === STATE.MENU || state === STATE.HOWTO) {
    drawMenuScene();
    return;
  }

  if (!game.level) return;

  drawBackground();
  drawWalkways();
  drawGoalZone();
  drawHomeZone();
  
  game.level.roads.forEach(drawRoad);
  drawDynamicEnvironment();
  
  game.level.roads.forEach(road => road.cars.forEach(drawCar));
  
  drawPlayer();
  drawParticles();
  drawFloatingTexts();
  drawVignette();
}

function drawVignette() {
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.8);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(10,15,20,0.16)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

function drawBackground() {
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
  skyGrad.addColorStop(0, '#eef4f9');
  skyGrad.addColorStop(0.45, '#dbe4ea');
  skyGrad.addColorStop(1, '#c1ccd6');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);

  const sunGrad = ctx.createRadialGradient(W - 90, 55, 10, W - 90, 55, 280);
  sunGrad.addColorStop(0, 'rgba(255,240,196,0.55)');
  sunGrad.addColorStop(1, 'rgba(255,240,196,0)');
  ctx.fillStyle = sunGrad;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(150, 165, 180, 0.3)';
  ctx.lineWidth = 1;
  const tileSize = 30;
  for (let x = 0; x < W; x += tileSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += tileSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
}

function drawWalkways() {
  if (!game.level || !game.level.roads) return;

  const firstRoad = game.level.roads[0];
  const crosswalkMidX = (firstRoad.crosswalkX[0] + firstRoad.crosswalkX[1]) / 2;
  const topCurbY = firstRoad.y - firstRoad.height / 2 - 8;

  const startY = 85;
  const plazaW = 80;
  const plazaX = crosswalkMidX - plazaW / 2;
  const plazaH = topCurbY - startY;

  const plazaGrad = ctx.createLinearGradient(plazaX, startY, plazaX, startY + plazaH);
  plazaGrad.addColorStop(0, '#f1e7e3');
  plazaGrad.addColorStop(1, '#ddcfca');
  ctx.fillStyle = plazaGrad;
  ctx.fillRect(plazaX, startY, plazaW, plazaH);

  ctx.strokeStyle = '#8d6e63';
  ctx.lineWidth = 2;
  ctx.strokeRect(plazaX, startY, plazaW, plazaH);

  ctx.strokeStyle = 'rgba(121, 85, 72, 0.25)';
  ctx.lineWidth = 1;
  const step = 20;
  for (let y = startY; y <= startY + plazaH; y += step) {
    ctx.beginPath(); ctx.moveTo(plazaX, y); ctx.lineTo(plazaX + plazaW, y); ctx.stroke();
  }
  for (let x = plazaX; x <= plazaX + plazaW; x += step) {
    ctx.beginPath(); ctx.moveTo(x, startY); ctx.lineTo(x, startY + plazaH); ctx.stroke();
  }
}

function isOverlapRoad(yMin, yMax) {
  if (!game.level || !game.level.roads) return false;
  return game.level.roads.some(r => {
    const rTop = r.y - r.height / 2 - 15;
    const rBot = r.y + r.height / 2 + 15;
    return !(yMax < rTop || yMin > rBot);
  });
}

function drawDynamicEnvironment() {
  drawTree(40, 50);
  drawTree(W - 40, 50);
  drawTree(40, 550);
  drawTree(W - 40, 550);

  game.level.roads.forEach((r, idx) => {
    const topCurbY = r.y - r.height / 2 - 8;
    const botCurbY = r.y + r.height / 2 + 8;

    if (idx === 0) {
      drawBusStop(W - 220, topCurbY - 6);
    } else if (idx === 1) {
      drawBusStop(200, botCurbY + 6);
    }

    drawStreetLamp(100, topCurbY);
    drawStreetLamp(W - 100, topCurbY);
    drawStreetLamp(100, botCurbY);
    drawStreetLamp(W - 100, botCurbY);

    drawRoadSign(r.crosswalkX[0] - 40, topCurbY - 2);
    drawRoadSign(r.crosswalkX[1] + 40, botCurbY + 2);
  });

  if (game.levelIndex === 1 || game.levelIndex === 2) {
    drawVendorStall(660, 180, '#43a047', '#ffffff', '🍡 รถเข็นลูกชิ้น', 'meatball');
    drawVendorStall(790, 180, '#f57c00', '#212121', '🍳 ส้มตำ-ไก่ย่าง', 'somtum');

    drawVendorStall(180, 180, '#e53935', '#ffffff', '🍊 ร้านผลไม้สด', 'fruit');
    drawVendorStall(320, 180, '#0288d1', '#fbc02d', '🧋 ร้านน้ำปั่น', 'drink');
    drawVendorStall(180, 510, '#e53935', '#ffffff', '🍊 ร้านผลไม้สด', 'fruit');
    drawVendorStall(320, 510, '#0288d1', '#fbc02d', '🧋 ร้านน้ำปั่น', 'drink');
  } 
  else if (game.levelIndex === 3) {
    drawVendorStall(180, 510, '#43a047', '#ffffff', '🍡 รถเข็นลูกชิ้น', 'meatball');
    drawVendorStall(310, 510, '#f57c00', '#212121', '🍳 ส้มตำ-ไก่ย่าง', 'somtum');
  } 
  else {
    const vendorYList = [140, 280, 510];
    vendorYList.forEach((y, i) => {
      if (!isOverlapRoad(y - 25, y + 25)) {
        if (i % 2 === 0) {
          drawVendorStall(180, y, '#e53935', '#ffffff', '🍊 ร้านผลไม้สด', 'fruit');
          drawVendorStall(320, y, '#0288d1', '#fbc02d', '🧋 ร้านน้ำปั่น', 'drink');
        } else {
          drawVendorStall(200, y, '#43a047', '#ffffff', '🍡 รถเข็นลูกชิ้น', 'meatball');
          drawVendorStall(340, y, '#f57c00', '#212121', '🍳 ส้มตำ-ไก่ย่าง', 'somtum');
        }
      }
    });
  }
}

function drawVendorStall(x, y, c1, c2, label, type) {
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.ellipse(x, y + 10, 32, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#8d6e63';
  roundRect(x - 26, y - 6, 52, 16, 3); ctx.fill();
  ctx.fillStyle = '#d7ccc8';
  ctx.fillRect(x - 24, y - 6, 48, 5);

  if (type === 'fruit') {
    ctx.fillStyle = '#4caf50';
    ctx.beginPath(); ctx.arc(x - 14, y - 8, 5, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#e53935';
    ctx.beginPath(); ctx.arc(x - 14, y - 8, 4, 0, Math.PI); ctx.fill();
    
    ctx.fillStyle = '#fbc02d';
    ctx.beginPath(); ctx.ellipse(x, y - 8, 4, 2.5, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 5, y - 7, 4, 2.5, -0.2, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#ff9800';
    ctx.beginPath(); ctx.arc(x + 15, y - 7, 3, 0, Math.PI * 2); ctx.fill();
  } 
  else if (type === 'meatball') {
    ctx.fillStyle = '#b0bec5';
    roundRect(x - 18, y - 9, 36, 5, 1); ctx.fill();

    ctx.strokeStyle = '#d7ccc8';
    ctx.lineWidth = 1;
    [-10, -2, 6, 12].forEach(ox => {
      ctx.beginPath(); ctx.moveTo(x + ox, y - 13); ctx.lineTo(x + ox, y - 6); ctx.stroke();
      ctx.fillStyle = (ox % 4 === 0) ? '#ffb74d' : '#ffffff';
      ctx.beginPath(); ctx.arc(x + ox, y - 12, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + ox, y - 9, 1.8, 0, Math.PI * 2); ctx.fill();
    });
  } 
  else if (type === 'drink') {
    const colors = ['#e91e63', '#4caf50', '#ff9800'];
    [-12, 0, 12].forEach((ox, idx) => {
      ctx.fillStyle = colors[idx];
      roundRect(x + ox - 3, y - 11, 6, 7, 1); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      roundRect(x + ox - 3, y - 12, 6, 2, 1); ctx.fill();
      ctx.strokeStyle = '#212121';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + ox + 1, y - 12); ctx.lineTo(x + ox + 3, y - 15); ctx.stroke();
    });
  }
  else if (type === 'somtum') {
    ctx.fillStyle = '#795548';
    ctx.beginPath(); ctx.arc(x - 10, y - 8, 4, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#ffb74d';
    roundRect(x + 2, y - 9, 14, 4, 1); ctx.fill();
  }

  ctx.fillStyle = '#37474f';
  ctx.fillRect(x - 24, y - 22, 3, 18);
  ctx.fillRect(x + 21, y - 22, 3, 18);

  const awningW = 58;
  const awningH = 12;
  const ax = x - awningW / 2;
  const ay = y - 32;

  const numStripes = 6;
  const stripeW = awningW / numStripes;
  for (let s = 0; s < numStripes; s++) {
    const stripeColor = (s % 2 === 0) ? c1 : c2;
    const stripeGrad = ctx.createLinearGradient(0, ay, 0, ay + awningH);
    stripeGrad.addColorStop(0, shadeColor(stripeColor, 20));
    stripeGrad.addColorStop(1, shadeColor(stripeColor, -18));
    ctx.fillStyle = stripeGrad;
    ctx.fillRect(ax + s * stripeW, ay, stripeW, awningH);
  }
  ctx.strokeStyle = '#212121';
  ctx.lineWidth = 1;
  ctx.strokeRect(ax, ay, awningW, awningH);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(ax, ay + awningH - 2, awningW, 2);

  const signGrad = ctx.createLinearGradient(0, y - 44, 0, y - 34);
  signGrad.addColorStop(0, '#ffffff');
  signGrad.addColorStop(1, '#f0e9df');
  ctx.fillStyle = signGrad;
  roundRect(x - 30, y - 44, 60, 10, 2); ctx.fill();
  ctx.fillStyle = '#212121';
  ctx.font = 'bold 8px Kanit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, x, y - 36);
}

function drawTree(x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(x + 2, y + 6, 17, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  const potGrad = ctx.createLinearGradient(x - 10, y - 4, x + 10, y + 6);
  potGrad.addColorStop(0, '#cfd8dc');
  potGrad.addColorStop(1, '#90a4ae');
  ctx.fillStyle = potGrad;
  roundRect(x - 10, y - 4, 20, 10, 2); ctx.fill();

  const canopyGrad = ctx.createRadialGradient(x - 6, y - 24, 4, x, y - 14, 20);
  canopyGrad.addColorStop(0, '#66bb6a');
  canopyGrad.addColorStop(0.55, '#2e7d32');
  canopyGrad.addColorStop(1, '#1b5e20');
  ctx.fillStyle = canopyGrad;
  ctx.beginPath(); ctx.arc(x, y - 14, 16, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x - 8, y - 20, 11, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 9, y - 19, 10, 0, Math.PI * 2); ctx.fill();
}

function drawBusStop(x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(x - 24, y - 2, 48, 4);

  ctx.fillStyle = '#37474f';
  ctx.fillRect(x - 20, y - 16, 4, 16);
  ctx.fillRect(x + 16, y - 16, 4, 16);
  
  ctx.fillStyle = '#0288d1';
  roundRect(x - 26, y - 22, 52, 6, 2); ctx.fill();

  ctx.fillStyle = '#8d6e63';
  ctx.fillRect(x - 16, y - 6, 32, 4);

  const signX = x + 30;
  ctx.fillStyle = '#37474f';
  ctx.fillRect(signX - 1, y - 14, 2, 14);
  ctx.fillStyle = '#fbc02d';
  ctx.beginPath(); ctx.arc(signX, y - 18, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0288d1';
  ctx.font = 'bold 7px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('BUS', signX, y - 15);
}

function drawRoadSign(x, y) {
  ctx.fillStyle = '#37474f';
  ctx.fillRect(x - 1, y - 10, 2, 12);

  ctx.save();
  ctx.translate(x, y - 14);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#fbc02d';
  ctx.fillRect(-6, -6, 12, 12);
  ctx.strokeStyle = '#212121';
  ctx.lineWidth = 1;
  ctx.strokeRect(-5, -5, 10, 10);
  ctx.restore();

  ctx.fillStyle = '#212121';
  ctx.font = '8px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🚶', x, y - 11);
}

function drawStreetLamp(x, y) {
  ctx.fillStyle = '#455a64';
  ctx.fillRect(x - 2, y - 12, 4, 14);
  ctx.fillStyle = '#fff59d';
  ctx.beginPath(); ctx.arc(x, y - 14, 4, 0, Math.PI * 2); ctx.fill();
}

function drawRoad(road) {
  const top = road.y - road.height / 2;

  const asphaltGrad = ctx.createLinearGradient(0, top, 0, top + road.height);
  asphaltGrad.addColorStop(0, '#2a333a');
  asphaltGrad.addColorStop(0.15, '#3c4750');
  asphaltGrad.addColorStop(0.5, '#465158');
  asphaltGrad.addColorStop(0.85, '#3c4750');
  asphaltGrad.addColorStop(1, '#2a333a');
  ctx.fillStyle = asphaltGrad;
  ctx.fillRect(0, top, W, road.height);

  const sheen = ctx.createLinearGradient(0, top, 0, top + road.height);
  sheen.addColorStop(0.42, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  sheen.addColorStop(0.58, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, top, W, road.height);

  const curbH = 8;
  drawThaiBevelCurb(0, top - curbH, W, curbH);
  drawThaiBevelCurb(0, top + road.height, W, curbH);

  const numLanes = road.numLanes || 2;
  const laneH = road.height / numLanes;

  ctx.save();
  ctx.shadowColor = 'rgba(251, 192, 45, 0.45)';
  ctx.shadowBlur = 4;
  ctx.strokeStyle = '#fbc02d';
  ctx.setLineDash([18, 14]);
  ctx.lineWidth = 3;

  for (let i = 1; i < numLanes; i++) {
    const lineY = top + i * laneH;
    ctx.beginPath(); ctx.moveTo(0, lineY); ctx.lineTo(W, lineY); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();

  // --- ทางม้าลาย (แถบสีแดง-ขาว) ---
  const [cx0, cx1] = road.crosswalkX;
  const cwWidth = cx1 - cx0;
  const padY = 2;
  const crossH = road.height - (padY * 2);
  const crossY = top + padY;

  const stripeCount = 13;
  const stripeH = crossH / stripeCount;

  for (let i = 0; i < stripeCount; i++) {
    const targetY = crossY + (i * stripeH);
    const stripeGrad = ctx.createLinearGradient(cx0, targetY, cx0 + cwWidth, targetY);

    if (i % 2 === 0) {
      const shadedRed = shadeColor('#d32f2f', -12);
      stripeGrad.addColorStop(0, '#e53935');
      stripeGrad.addColorStop(1, shadedRed);
      ctx.fillStyle = stripeGrad;
    } else {
      stripeGrad.addColorStop(0, '#ffffff');
      stripeGrad.addColorStop(1, '#e0e0e0');
      ctx.fillStyle = stripeGrad;
    }

    ctx.fillRect(cx0, targetY, cwWidth, stripeH);
    
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(cx0, targetY + stripeH - 0.8, cwWidth, 0.8);
  }

  if (road.hasLight) drawTrafficLight(cx1 + 70, top - 8, road);
}

function drawThaiBevelCurb(x, y, w, h) {
  const segW = 26;
  let currentX = x;
  let isYellow = true;
  while (currentX < x + w) {
    const segWidth = Math.min(segW, x + w - currentX);
    const segGrad = ctx.createLinearGradient(currentX, y, currentX, y + h);
    if (isYellow) {
      segGrad.addColorStop(0, '#ffd95e');
      segGrad.addColorStop(1, '#f9a825');
    } else {
      segGrad.addColorStop(0, '#3a444c');
      segGrad.addColorStop(1, '#101316');
    }
    ctx.fillStyle = segGrad;
    ctx.fillRect(currentX, y, segWidth, h);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(currentX, y, segWidth, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(currentX, y + h - 2, segWidth, 2);
    currentX += segW;
    isYellow = !isYellow;
  }
}

function drawTrafficLight(x, groundY, road) {
  const poleH = 22, boxW = 20, boxH = 40;
  const boxBottom = groundY - poleH;
  const boxTop = boxBottom - boxH;

  const poleGrad = ctx.createLinearGradient(x - 3, 0, x + 3, 0);
  poleGrad.addColorStop(0, '#5c6b74');
  poleGrad.addColorStop(0.5, '#2a343b');
  poleGrad.addColorStop(1, '#5c6b74');
  ctx.fillStyle = poleGrad;
  ctx.fillRect(x - 3, boxBottom, 6, poleH);

  const boxGrad = ctx.createLinearGradient(x - boxW / 2, 0, x + boxW / 2, 0);
  boxGrad.addColorStop(0, '#0e1b21');
  boxGrad.addColorStop(0.5, '#28373f');
  boxGrad.addColorStop(1, '#0e1b21');
  ctx.fillStyle = boxGrad;
  roundRect(x - boxW / 2, boxTop, boxW, boxH, 5); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const lights = [
    { c: '#ff5252', shadow: '#ff1744', on: road.phase === 'red' },
    { c: '#ffd740', shadow: '#ffea00', on: road.phase === 'yellow' },
    { c: '#69f0ae', shadow: '#00e676', on: road.phase === 'green' },
  ];
  const step = boxH / 3;

  lights.forEach((l, i) => {
    const cy = boxTop + step * i + step / 2;
    if (l.on) {
      const glow = ctx.createRadialGradient(x, cy, 0, x, cy, 11);
      glow.addColorStop(0, l.shadow);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.globalAlpha = 0.65;
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(x, cy, 11, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    const bulbGrad = ctx.createRadialGradient(x - 1.5, cy - 1.5, 0.5, x, cy, 6);
    bulbGrad.addColorStop(0, '#ffffff');
    bulbGrad.addColorStop(0.35, l.c);
    bulbGrad.addColorStop(1, l.shadow);
    ctx.save();
    ctx.globalAlpha = l.on ? 1 : 0.25;
    ctx.fillStyle = bulbGrad;
    ctx.beginPath(); ctx.arc(x, cy, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });

  const pedGreen = road.phase === 'red';
  const badgeCX = x + boxW / 2 + 16;
  const badgeCY = boxTop + boxH / 2;

  const badgeGrad = ctx.createLinearGradient(0, badgeCY - 11, 0, badgeCY + 11);
  if (pedGreen) {
    badgeGrad.addColorStop(0, '#4caf50');
    badgeGrad.addColorStop(1, '#1b5e20');
  } else {
    badgeGrad.addColorStop(0, '#e53935');
    badgeGrad.addColorStop(1, '#8e0000');
  }
  ctx.fillStyle = badgeGrad;
  roundRect(badgeCX - 13, badgeCY - 11, 26, 22, 5); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '12px Kanit, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pedGreen ? '🚶' : '✋', badgeCX, badgeCY + 1);
  ctx.textBaseline = 'alphabetic';
}

/* ---------------------------------------------------------------------
   COLOR & GRADIENT HELPERS
   --------------------------------------------------------------------- */
function shadeColor(hex, percent) {
  const f = parseInt(hex.slice(1), 16);
  const t = percent < 0 ? 0 : 255;
  const p = Math.abs(percent) / 100;
  const R = f >> 16, G = (f >> 8) & 0x00ff, B = f & 0x0000ff;
  const newR = Math.round((t - R) * p) + R;
  const newG = Math.round((t - G) * p) + G;
  const newB = Math.round((t - B) * p) + B;
  return '#' + (0x1000000 + newR * 0x10000 + newG * 0x100 + newB).toString(16).slice(1);
}

function bodyGradient(h, color, lightPct = 30, darkPct = -28) {
  const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  g.addColorStop(0, shadeColor(color, lightPct));
  g.addColorStop(0.55, color);
  g.addColorStop(1, shadeColor(color, darkPct));
  return g;
}

/* ---------------------------------------------------------------------
   VEHICLE RENDERER WITH WHEELS ENGINE
   --------------------------------------------------------------------- */
function drawVehicleWheels(carW, carH, type) {
  const drawWheel = (wx, wy, ww, wh) => {
    const tireGrad = ctx.createLinearGradient(wx, wy, wx, wy + wh);
    tireGrad.addColorStop(0, '#2b2b2b');
    tireGrad.addColorStop(1, '#050505');
    ctx.fillStyle = tireGrad;
    roundRect(wx, wy, ww, wh, 1.5);
    ctx.fill();

    const hubGrad = ctx.createLinearGradient(wx, wy, wx, wy + wh);
    hubGrad.addColorStop(0, '#fafafa');
    hubGrad.addColorStop(1, '#9e9e9e');
    ctx.fillStyle = hubGrad;
    ctx.fillRect(wx + 2, wy + 1, Math.max(1, ww - 4), Math.max(1, wh - 2));
  };

  if (type === 'bike') {
    drawWheel(carW / 2 - 2, -2.5, 8, 5);
    drawWheel(-carW / 2 - 6, -2.5, 8, 5);
  } else if (type === 'tuktuk') {
    drawWheel(carW / 2 - 2, -2.5, 7, 5);
    drawWheel(-carW / 2 + 4, -carH / 2 - 3, 9, 5);
    drawWheel(-carW / 2 + 4, carH / 2 - 2, 9, 5);
  } else if (type === 'bus') {
    const topY = -carH / 2 - 3;
    const botY = carH / 2 - 2;
    drawWheel(carW / 2 - 14, topY, 11, 5);
    drawWheel(carW / 2 - 14, botY, 11, 5);
    drawWheel(-carW / 2 + 10, topY, 11, 5);
    drawWheel(-carW / 2 + 10, botY, 11, 5);
  } else {
    const topY = -carH / 2 - 3;
    const botY = carH / 2 - 2;
    drawWheel(carW / 2 - 12, topY, 10, 5);
    drawWheel(carW / 2 - 12, botY, 10, 5);
    drawWheel(-carW / 2 + 6, topY, 10, 5);
    drawWheel(-carW / 2 + 6, botY, 10, 5);
  }
}

function drawCar(car) {
  ctx.save();
  ctx.translate(car.x, car.y);
  if (car.dir === -1) ctx.scale(-1, 1);

  const v = car.vData;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.beginPath();
  ctx.ellipse(0, car.h / 2 + 2, car.w / 2, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  drawVehicleWheels(car.w, car.h, v.type);

  const glassGrad = ctx.createLinearGradient(0, -car.h / 2, 0, car.h / 2);
  glassGrad.addColorStop(0, '#2a5578');
  glassGrad.addColorStop(1, '#0a1b2c');

  if (v.type === 'bus') {
    ctx.fillStyle = bodyGradient(car.h, v.color, 22, -22);
    roundRect(-car.w / 2, -car.h / 2, car.w, car.h, 4); ctx.fill();

    ctx.fillStyle = v.secondary || '#ffffff';
    ctx.fillRect(-car.w / 2, -car.h / 2 + 6, car.w, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(-car.w / 2, -car.h / 2 + 12, car.w, 2);

    const winCount = 5, winW = 10;
    const winGap = (car.w - 20 - (winCount * winW)) / (winCount - 1);
    for (let i = 0; i < winCount; i++) {
      const wx = -car.w / 2 + 10 + i * (winW + winGap);
      ctx.fillStyle = glassGrad;
      roundRect(wx, -car.h / 2 + 3, winW, car.h - 6, 1); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(wx + 1, -car.h / 2 + 4, 2, car.h - 8);
    }
  } 
  else if (v.type === 'tuktuk') {
    ctx.fillStyle = bodyGradient(car.h, v.color, 25, -22);
    roundRect(-car.w / 2, -car.h / 2, car.w - 2, car.h, 4); ctx.fill();

    ctx.fillStyle = bodyGradient(car.h + 2, v.roof, 30, -15);
    roundRect(-car.w / 2 + 2, -car.h / 2 - 1, car.w - 8, car.h + 2, 4); ctx.fill();

    ctx.fillStyle = glassGrad;
    roundRect(car.w / 2 - 8, -car.h / 2 + 3, 5, car.h - 6, 1.5); ctx.fill();
  } 
  else if (v.type === 'taxi_green_yellow') {
    ctx.fillStyle = bodyGradient(car.h / 2, v.secondary, 25, -18);
    roundRect(-car.w / 2, -car.h / 2, car.w, car.h / 2, [4, 4, 0, 0]); ctx.fill();
    ctx.fillStyle = bodyGradient(car.h / 2, v.color, 25, -18);
    roundRect(-car.w / 2, 0, car.w, car.h / 2, [0, 0, 4, 4]); ctx.fill();

    ctx.fillStyle = glassGrad;
    roundRect(car.w / 4 - 2, -car.h / 2 + 3, 6, car.h - 6, 1.5); ctx.fill();
    roundRect(-car.w / 3, -car.h / 2 + 3, 5, car.h - 6, 1.5); ctx.fill();

    ctx.fillStyle = '#0d47a1';
    roundRect(-5, -car.h / 2 - 3, 10, 4, 1); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(-5, -car.h / 2 - 3, 10, 1.2);
  } 
  else if (v.type === 'bike') {
    ctx.fillStyle = bodyGradient(car.h - 6, v.color, 30, -20);
    roundRect(-car.w / 2 + 2, -car.h / 2 + 3, car.w - 4, car.h - 6, 2); ctx.fill();

    const helmGrad = ctx.createRadialGradient(-3, -2, 1, -2, 0, 7);
    helmGrad.addColorStop(0, '#3e4d56');
    helmGrad.addColorStop(1, '#151d21');
    ctx.fillStyle = helmGrad;
    ctx.beginPath(); ctx.arc(-2, 0, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(200,225,255,0.85)';
    ctx.beginPath(); ctx.arc(1, 0, 4, -Math.PI / 2, Math.PI / 2); ctx.fill();
  } 
  else {
    ctx.fillStyle = bodyGradient(car.h, v.color, 28, -24);
    roundRect(-car.w / 2, -car.h / 2, car.w, car.h, 5); ctx.fill();

    if (v.type === 'pickup') {
      ctx.fillStyle = bodyGradient(car.h - 6, '#2a343b', 20, -30);
      roundRect(-car.w / 2 + 3, -car.h / 2 + 3, car.w / 2 - 4, car.h - 6, 2); ctx.fill();
      ctx.fillStyle = glassGrad;
      roundRect(car.w / 4 - 2, -car.h / 2 + 3, 6, car.h - 6, 1.5); ctx.fill();
    } else {
      ctx.fillStyle = glassGrad;
      roundRect(car.w / 4 - 2, -car.h / 2 + 3, 6, car.h - 6, 1.5); ctx.fill();
      roundRect(-car.w / 3, -car.h / 2 + 3, 5, car.h - 6, 1.5); ctx.fill();

      if (v.type === 'taxi_pink') {
        ctx.fillStyle = '#0d47a1';
        roundRect(-5, -car.h / 2 - 3, 10, 4, 1); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(-5, -car.h / 2 - 3, 10, 1.2);
      }
    }
  }

  if (v.type !== 'bike') {
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(-car.w * 0.05, -car.h / 2 + 3, car.w / 2 - 6, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (v.type !== 'bus') {
    ctx.fillStyle = '#fffde7';
    ctx.shadowColor = 'rgba(255,253,231,0.8)';
    ctx.shadowBlur = 3;
    ctx.fillRect(car.w / 2 - 2, -car.h / 2 + 2, 2, 3);
    ctx.fillRect(car.w / 2 - 2, car.h / 2 - 5, 2, 3);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#d50000';
    ctx.fillRect(-car.w / 2, -car.h / 2 + 2, 2, 3);
    ctx.fillRect(-car.w / 2, car.h / 2 - 5, 2, 3);
  }

  ctx.restore();
}

function roundRect(x, y, w, h, r = 0) {
  let radii = { tl: 0, tr: 0, br: 0, bl: 0 };
  if (typeof r === 'number') {
    radii = { tl: r, tr: r, br: r, bl: r };
  } else if (Array.isArray(r)) {
    radii = { tl: r[0] || 0, tr: r[1] || 0, br: r[2] || 0, bl: r[3] || 0 };
  }

  ctx.beginPath();
  ctx.moveTo(x + radii.tl, y);
  ctx.lineTo(x + w - radii.tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radii.tr);
  ctx.lineTo(x + w, y + h - radii.br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radii.br, y + h);
  ctx.lineTo(x + radii.bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radii.bl);
  ctx.lineTo(x, y + radii.tl);
  ctx.quadraticCurveTo(x, y, x + radii.tl, y);
  ctx.closePath();
}

/* ---------------------------------------------------------------------
   GOAL ZONE & SCHOOL BUILDINGS
   --------------------------------------------------------------------- */
function drawGoalZone() {
  const cx = W / 2;
  const baseY = 125;

  const skyPatch = ctx.createLinearGradient(0, 0, 0, baseY);
  skyPatch.addColorStop(0, '#fff3d6');
  skyPatch.addColorStop(1, '#d8e2ea');
  ctx.fillStyle = skyPatch;
  ctx.fillRect(0, 0, W, baseY);

  const bW = 460;
  const bH = 75;
  const bX = cx - bW / 2;
  const bY = baseY - bH - 10;

  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(bX + 6, bY + bH - 4, bW, 6);

  const facadeGrad = ctx.createLinearGradient(0, bY, 0, bY + bH);
  facadeGrad.addColorStop(0, '#fffef4');
  facadeGrad.addColorStop(1, '#f3ecd2');
  ctx.fillStyle = facadeGrad;
  roundRect(bX, bY, bW, bH, 4); ctx.fill();
  ctx.strokeStyle = '#cfd8dc';
  ctx.lineWidth = 2;
  ctx.strokeRect(bX, bY, bW, bH);

  const winRows = 2, winCols = 10;
  const winW = 18, winH = 18;
  for (let r = 0; r < winRows; r++) {
    for (let c = 0; c < winCols; c++) {
      if (c >= 4 && c <= 5) continue;
      const wx = bX + 22 + c * 42;
      const wy = bY + 12 + r * 28;
      
      const glassGrad = ctx.createLinearGradient(wx, wy, wx + winW, wy + winH);
      glassGrad.addColorStop(0, '#80deea');
      glassGrad.addColorStop(1, '#00838f');
      ctx.fillStyle = glassGrad;
      roundRect(wx, wy, winW, winH, 2); ctx.fill();
      
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(wx, wy, winW, winH);
    }
  }

  ctx.fillStyle = '#c62828';
  ctx.beginPath();
  ctx.moveTo(bX - 15, bY + 4);
  ctx.lineTo(cx, bY - 20);
  ctx.lineTo(bX + bW + 15, bY + 4);
  ctx.lineTo(bX + bW + 10, bY + 12);
  ctx.lineTo(cx, bY - 12);
  ctx.lineTo(bX - 10, bY + 12);
  ctx.closePath();
  ctx.fill();

  const eaveGrad = ctx.createLinearGradient(0, bY - 6, 0, bY + 6);
  eaveGrad.addColorStop(0, '#ffd95e');
  eaveGrad.addColorStop(1, '#f9a825');
  ctx.fillStyle = eaveGrad;
  ctx.beginPath();
  ctx.moveTo(cx - 108, bY + 4);
  ctx.lineTo(cx, bY - 26);
  ctx.lineTo(cx + 108, bY + 4);
  ctx.lineTo(cx + 100, bY + 10);
  ctx.lineTo(cx, bY - 18);
  ctx.lineTo(cx - 100, bY + 10);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#c62828';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const gRoofGrad = ctx.createLinearGradient(0, bY - 50, 0, bY - 10);
  gRoofGrad.addColorStop(0, '#ff6f5e');
  gRoofGrad.addColorStop(0.55, '#e53935');
  gRoofGrad.addColorStop(1, '#a71c1c');
  ctx.fillStyle = gRoofGrad;
  ctx.beginPath();
  ctx.moveTo(cx - 95, bY - 8);
  ctx.lineTo(cx, bY - 48);
  ctx.lineTo(cx + 95, bY - 8);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#fbc02d';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.strokeStyle = '#ffe082';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - 88, bY - 10.5);
  ctx.lineTo(cx, bY - 46);
  ctx.lineTo(cx + 88, bY - 10.5);
  ctx.stroke();

  const chofaGrad = ctx.createLinearGradient(cx - 6, bY - 78, cx + 6, bY - 46);
  chofaGrad.addColorStop(0, '#ffe082');
  chofaGrad.addColorStop(1, '#f9a825');
  ctx.fillStyle = chofaGrad;
  ctx.beginPath();
  ctx.moveTo(cx, bY - 78);
  ctx.quadraticCurveTo(cx + 9, bY - 62, cx + 3, bY - 46);
  ctx.lineTo(cx - 3, bY - 46);
  ctx.quadraticCurveTo(cx - 9, bY - 62, cx, bY - 78);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#c62828';
  ctx.lineWidth = 1;
  ctx.stroke();

  const signW = 170, signH = 26;
  const signX = cx - signW / 2;
  const signY = bY + 8;
  const signGrad = ctx.createLinearGradient(0, signY, 0, signY + signH);
  signGrad.addColorStop(0, '#1a5fc4');
  signGrad.addColorStop(1, '#0a2e6b');
  ctx.fillStyle = signGrad;
  roundRect(signX, signY, signW, signH, 4); ctx.fill();
  ctx.strokeStyle = '#fbc02d';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 12px "Sarabun", "Kanit", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('โรงเรียน', cx, signY + signH / 2);

  const doorW = 44, doorH = 32;
  const doorX = cx - doorW / 2;
  const doorY = baseY - 10 - doorH;
  const doorGrad = ctx.createLinearGradient(doorX, doorY, doorX + doorW, doorY);
  doorGrad.addColorStop(0, '#4a5b66');
  doorGrad.addColorStop(0.5, '#2c3940');
  doorGrad.addColorStop(1, '#4a5b66');
  ctx.fillStyle = doorGrad;
  roundRect(doorX, doorY, doorW, doorH, [4, 4, 0, 0]); ctx.fill();
  const doorGlass = ctx.createLinearGradient(0, doorY, 0, doorY + doorH);
  doorGlass.addColorStop(0, '#b3ecf5');
  doorGlass.addColorStop(1, '#4fa8bd');
  ctx.fillStyle = doorGlass;
  roundRect(doorX + 3, doorY + 3, doorW / 2 - 4, doorH - 3, 2); ctx.fill();
  roundRect(doorX + doorW / 2 + 1, doorY + 3, doorW / 2 - 4, doorH - 3, 2); ctx.fill();

  const gateY = baseY - 10;
  const drawPillar = (px) => {
    const pillarGrad = ctx.createLinearGradient(px - 10, 0, px + 10, 0);
    pillarGrad.addColorStop(0, '#a1887f');
    pillarGrad.addColorStop(0.5, '#8d6e63');
    pillarGrad.addColorStop(1, '#6d4c41');
    ctx.fillStyle = pillarGrad;
    roundRect(px - 10, gateY - 24, 20, 30, 2); ctx.fill();
    ctx.fillStyle = '#efebe6';
    roundRect(px - 12, gateY - 28, 24, 6, 2); ctx.fill();
    const finialGrad = ctx.createRadialGradient(px - 2, gateY - 34, 1, px, gateY - 32, 6);
    finialGrad.addColorStop(0, '#ffe082');
    finialGrad.addColorStop(1, '#f9a825');
    ctx.fillStyle = finialGrad;
    ctx.beginPath(); ctx.arc(px, gateY - 32, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(px - 3, gateY - 37); ctx.lineTo(px, gateY - 44); ctx.lineTo(px + 3, gateY - 37); ctx.closePath(); ctx.fill();

    ctx.fillStyle = '#a1887f';
    roundRect(px - 7, gateY + 2, 14, 8, 2); ctx.fill();
    const leafGrad = ctx.createRadialGradient(px, gateY - 4, 1, px, gateY, 10);
    leafGrad.addColorStop(0, '#81c784');
    leafGrad.addColorStop(1, '#2e7d32');
    ctx.fillStyle = leafGrad;
    ctx.beginPath(); ctx.arc(px - 4, gateY - 2, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(px + 4, gateY - 3, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(px, gateY - 6, 5, 0, Math.PI * 2); ctx.fill();
  };

  drawPillar(70);
  drawPillar(cx - 120);
  drawPillar(cx + 120);
  drawPillar(W - 70);

  ctx.strokeStyle = '#37474f';
  ctx.lineWidth = 2;
  const drawFenceSection = (x1, x2) => {
    ctx.beginPath();
    ctx.moveTo(x1, gateY - 18); ctx.lineTo(x2, gateY - 18);
    ctx.moveTo(x1, gateY - 4);  ctx.lineTo(x2, gateY - 4);
    ctx.stroke();

    for (let fx = x1 + 10; fx < x2; fx += 12) {
      ctx.beginPath();
      ctx.moveTo(fx, gateY); ctx.lineTo(fx, gateY - 22);
      ctx.stroke();
      const spikeGrad = ctx.createLinearGradient(fx - 2, gateY - 26, fx + 2, gateY - 22);
      spikeGrad.addColorStop(0, '#ffe082');
      spikeGrad.addColorStop(1, '#f9a825');
      ctx.fillStyle = spikeGrad;
      ctx.beginPath();
      ctx.moveTo(fx - 2, gateY - 22);
      ctx.lineTo(fx, gateY - 26);
      ctx.lineTo(fx + 2, gateY - 22);
      ctx.closePath();
      ctx.fill();
    }
  };

  drawFenceSection(80, cx - 130);
  drawFenceSection(cx + 130, W - 80);

  const flagX = cx - 150;
  const flagY = bY + 18; 

  const flagW = 32, flagH = 20;
  const poleTopY = flagY - 6;

  ctx.strokeStyle = '#b0bec5';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(flagX, baseY); ctx.lineTo(flagX, poleTopY); ctx.stroke();
  ctx.fillStyle = '#fbc02d';
  ctx.beginPath(); ctx.arc(flagX, poleTopY, 4, 0, Math.PI * 2); ctx.fill();

  const stripeH = flagH / 5;
  const flagColors = ['#d32f2f', '#ffffff', '#1976d2', '#ffffff', '#d32f2f'];
  const wave = Math.sin(globalTime * 5) * 3;

  flagColors.forEach((color, idx) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(flagX + 2, flagY + (idx * stripeH));
    ctx.quadraticCurveTo(flagX + flagW / 2, flagY + (idx * stripeH) + wave, flagX + flagW, flagY + (idx * stripeH));
    ctx.lineTo(flagX + flagW, flagY + ((idx + 1) * stripeH));
    ctx.quadraticCurveTo(flagX + flagW / 2, flagY + ((idx + 1) * stripeH) + wave, flagX + 2, flagY + ((idx + 1) * stripeH));
    ctx.closePath();
    ctx.fill();
  });

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawHomeZone() {
  const groundGrad = ctx.createLinearGradient(0, HOME_Y + 30, 0, H);
  groundGrad.addColorStop(0, '#dbe2e6');
  groundGrad.addColorStop(1, '#b7c2c9');
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, HOME_Y + 30, W, H - HOME_Y - 30);

  const signGrad = ctx.createLinearGradient(0, HOME_Y + 34, 0, HOME_Y + 60);
  signGrad.addColorStop(0, '#2f7bd4');
  signGrad.addColorStop(1, '#124e93');
  ctx.fillStyle = signGrad;
  roundRect(W / 2 - 70, HOME_Y + 34, 140, 26, 6); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(W / 2 - 68, HOME_Y + 36, 136, 22);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px Kanit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🏠 บ้าน (Home)', W / 2, HOME_Y + 51);
}

/* ---------------------------------------------------------------------
   PLAYER CHARACTER
   --------------------------------------------------------------------- */
function drawPlayer() {
  const p = game.player;
  ctx.save();
  ctx.translate(p.x, p.y);
  
  const walkPhase = p.moving ? Math.sin(p.animT * 14) : 0;
  const bob = Math.abs(walkPhase) * 2;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.beginPath();
  ctx.ellipse(0, p.h / 2 + 2, 12, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(0, -bob);

  const shirtGrad = ctx.createLinearGradient(-10, -10, 10, 6);
  shirtGrad.addColorStop(0, '#42a5f5');
  shirtGrad.addColorStop(1, '#1565c0');
  ctx.fillStyle = shirtGrad;
  roundRect(-10, -10, 20, 16, 4); ctx.fill();
  ctx.fillStyle = '#0d47a1';
  roundRect(-8, -8, 16, 6, 2); ctx.fill();

  const legOffset = walkPhase * 4;
  ctx.fillStyle = '#ffcc80';
  ctx.fillRect(-6, 8, 4, 8 - legOffset);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-6, 14 - legOffset, 4, 3);
  ctx.fillStyle = '#212121';
  roundRect(-7, 16 - legOffset, 6, 4, 2); ctx.fill();

  ctx.fillStyle = '#ffcc80';
  ctx.fillRect(2, 8, 4, 8 + legOffset);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(2, 14 + legOffset, 4, 3);
  ctx.fillStyle = '#212121';
  roundRect(1, 16 + legOffset, 6, 4, 2); ctx.fill();

  ctx.fillStyle = '#0d47a1';
  roundRect(-8, 3, 16, 8, 2); ctx.fill();

  ctx.fillStyle = '#f5f5f5';
  roundRect(-8, -8, 16, 12, 3); ctx.fill();
  
  ctx.fillStyle = '#3e2723';
  ctx.fillRect(-8, 3, 16, 2);
  ctx.fillStyle = '#fbc02d';
  ctx.fillRect(-2, 3, 4, 2);
  
  ctx.strokeStyle = '#bdbdbd';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-5, -8); ctx.lineTo(0, -4); ctx.lineTo(5, -8);
  ctx.stroke();

  if (p.raisingHand) {
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(-11, -7, 4, 6);
    ctx.fillStyle = '#ffcc80';
    ctx.fillRect(-11, -1, 4, 6);

    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(7, -12, 4, 6);
    ctx.fillStyle = '#ffcc80';
    ctx.fillRect(7, -22, 4, 11);
    ctx.beginPath(); ctx.arc(9, -23, 4, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.shadowColor = '#ffd54f';
    ctx.shadowBlur = 12;
    ctx.strokeStyle = '#ffb300';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(9, -23, 10 + Math.sin(globalTime * 10) * 2, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✋', 9, -34 + Math.sin(globalTime * 8) * 2);
  } else {
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(-11, -7, 4, 6);
    ctx.fillRect(7, -7, 4, 6);
    ctx.fillStyle = '#ffcc80';
    ctx.fillRect(-11, -1 + legOffset * 0.5, 4, 6);
    ctx.fillRect(7, -1 - legOffset * 0.5, 4, 6);
  }

  ctx.fillStyle = '#ffcc80';
  ctx.beginPath(); ctx.arc(0, -15, 9, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = 'rgba(255, 138, 128, 0.5)';
  ctx.beginPath(); ctx.arc(-4, -13, 2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(4, -13, 2, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = '#212121';
  ctx.beginPath(); ctx.arc(-3, -16, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(3, -16, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(-3.5, -16.5, 0.6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(2.5, -16.5, 0.6, 0, Math.PI * 2); ctx.fill();

  ctx.strokeStyle = '#d84315';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, -13, 2.5, 0.1, Math.PI - 0.1); ctx.stroke();

  ctx.fillStyle = '#263238';
  ctx.beginPath();
  ctx.arc(0, -17, 9.5, Math.PI * 0.8, Math.PI * 2.2);
  ctx.fill();
  
  ctx.beginPath();
  ctx.moveTo(-9, -18); ctx.quadraticCurveTo(-3, -13, 0, -17);
  ctx.quadraticCurveTo(4, -13, 9, -18);
  ctx.lineTo(9, -21); ctx.lineTo(-9, -21);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.beginPath(); ctx.ellipse(0, -22, 5, 2, 0, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

function drawParticles() {
  particles.forEach(p => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.alpha);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function drawFloatingTexts() {
  floatTexts.forEach(ft => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, ft.alpha);
    ctx.fillStyle = ft.color;
    ctx.font = `bold ${Math.floor(18 * ft.scale)}px Kanit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.restore();
  });
}

/* ---------------------------------------------------------------------
   MENU & HOW-TO SCENE RENDERER
   --------------------------------------------------------------------- */
const menuClouds = Array.from({ length: 6 }, (_, i) => ({
  x: (W / 6) * i + Math.random() * 80,
  y: 40 + Math.random() * 110,
  scale: 0.6 + Math.random() * 0.8,
  speed: 6 + Math.random() * 10,
}));

const menuBirds = Array.from({ length: 4 }, (_, i) => ({
  x: Math.random() * W,
  y: 60 + Math.random() * 90,
  speed: 26 + Math.random() * 14,
  phase: Math.random() * 10,
}));

function drawMenuCloud(x, y, scale) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 26, 14, 0, 0, Math.PI * 2);
  ctx.ellipse(20, -6, 18, 12, 0, 0, Math.PI * 2);
  ctx.ellipse(-20, -4, 16, 11, 0, 0, Math.PI * 2);
  ctx.ellipse(6, -14, 15, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMenuBird(x, y, t) {
  const flap = Math.sin(t * 10) * 6;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = 'rgba(50,40,40,0.55)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-8, 0); ctx.quadraticCurveTo(-3, -flap, 0, 0);
  ctx.quadraticCurveTo(3, -flap, 8, 0);
  ctx.stroke();
  ctx.restore();
}

function drawMenuSkyline() {
  const baseY = 295;
  const buildings = [
    { x: 0,   w: 70,  h: 90,  c: '#7a92ab' },
    { x: 55,  w: 50,  h: 120, c: '#647b95' },
    { x: 100, w: 65,  h: 75,  c: '#8aa1b8' },
    { x: 780, w: 60,  h: 100, c: '#7a92ab' },
    { x: 830, w: 55,  h: 130, c: '#647b95' },
    { x: 880, w: 80,  h: 80,  c: '#8aa1b8' },
  ];
  buildings.forEach(b => {
    ctx.fillStyle = b.c;
    ctx.fillRect(b.x, baseY - b.h, b.w, b.h);
    ctx.fillStyle = 'rgba(255, 236, 179, 0.55)';
    for (let wy = baseY - b.h + 10; wy < baseY - 8; wy += 14) {
      for (let wx = b.x + 6; wx < b.x + b.w - 6; wx += 12) {
        if (Math.random() > 0.4) ctx.fillRect(wx, wy, 5, 7);
      }
    }
  });
}

function drawMenuSchoolBackground() {
  const cx = W / 2;
  const baseY = 295;

  const bW = 540;
  const bH = 95;
  const bX = cx - bW / 2;
  const bY = baseY - bH;

  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(bX - 10, baseY - 4, bW + 20, 4);

  const facadeGrad = ctx.createLinearGradient(0, bY, 0, baseY);
  facadeGrad.addColorStop(0, '#fffef4');
  facadeGrad.addColorStop(1, '#f3ecd2');
  ctx.fillStyle = facadeGrad;
  roundRect(bX, bY, bW, bH, 4);
  ctx.fill();
  ctx.strokeStyle = '#d7ccc8';
  ctx.lineWidth = 2;
  ctx.strokeRect(bX, bY, bW, bH);

  const winRows = 2, winCols = 12;
  const winW = 20, winH = 22;
  for (let r = 0; r < winRows; r++) {
    for (let c = 0; c < winCols; c++) {
      if (c >= 5 && c <= 6) continue;
      const wx = bX + 22 + c * 42;
      const wy = bY + 12 + r * 38;

      const glassGrad = ctx.createLinearGradient(wx, wy, wx + winW, wy + winH);
      glassGrad.addColorStop(0, '#80deea');
      glassGrad.addColorStop(1, '#00838f');
      ctx.fillStyle = glassGrad;
      roundRect(wx, wy, winW, winH, 2);
      ctx.fill();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(wx, wy, winW, winH);
    }
  }

  ctx.fillStyle = '#c62828';
  ctx.beginPath();
  ctx.moveTo(bX - 20, bY + 6);
  ctx.lineTo(cx, bY - 24);
  ctx.lineTo(bX + bW + 20, bY + 6);
  ctx.lineTo(bX + bW + 14, bY + 15);
  ctx.lineTo(cx, bY - 14);
  ctx.lineTo(bX - 14, bY + 15);
  ctx.closePath();
  ctx.fill();

  const gRoofGrad = ctx.createLinearGradient(0, bY - 65, 0, bY - 10);
  gRoofGrad.addColorStop(0, '#ff6f5e');
  gRoofGrad.addColorStop(0.5, '#e53935');
  gRoofGrad.addColorStop(1, '#a71c1c');
  ctx.fillStyle = gRoofGrad;
  ctx.beginPath();
  ctx.moveTo(cx - 120, bY - 8);
  ctx.lineTo(cx, bY - 62);
  ctx.lineTo(cx + 120, bY - 8);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#fbc02d';
  ctx.lineWidth = 3.5;
  ctx.stroke();

  const chofaGrad = ctx.createLinearGradient(cx - 6, bY - 95, cx + 6, bY - 62);
  chofaGrad.addColorStop(0, '#ffe082');
  chofaGrad.addColorStop(1, '#f9a825');
  ctx.fillStyle = chofaGrad;
  ctx.beginPath();
  ctx.moveTo(cx, bY - 95);
  ctx.quadraticCurveTo(cx + 10, bY - 78, cx + 4, bY - 62);
  ctx.lineTo(cx - 4, bY - 62);
  ctx.quadraticCurveTo(cx - 10, bY - 78, cx, bY - 95);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#c62828';
  ctx.lineWidth = 1;
  ctx.stroke();

  const signW = 180, signH = 30;
  const signX = cx - signW / 2;
  const signY = bY + 10;
  const signGrad = ctx.createLinearGradient(0, signY, 0, signY + signH);
  signGrad.addColorStop(0, '#1a5fc4');
  signGrad.addColorStop(1, '#0a2e6b');
  ctx.fillStyle = signGrad;
  roundRect(signX, signY, signW, signH, 5);
  ctx.fill();
  ctx.strokeStyle = '#fbc02d';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 15px "Sarabun", "Kanit", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🏫 โรงเรียน (School)', cx, signY + signH / 2);

  const doorW = 50, doorH = 38;
  const doorX = cx - doorW / 2;
  const doorY = baseY - doorH;
  const doorGrad = ctx.createLinearGradient(doorX, doorY, doorX + doorW, doorY);
  doorGrad.addColorStop(0, '#4a5b66');
  doorGrad.addColorStop(0.5, '#2c3940');
  doorGrad.addColorStop(1, '#4a5b66');
  ctx.fillStyle = doorGrad;
  roundRect(doorX, doorY, doorW, doorH, [4, 4, 0, 0]);
  ctx.fill();

  const doorGlass = ctx.createLinearGradient(0, doorY, 0, doorY + doorH);
  doorGlass.addColorStop(0, '#b3ecf5');
  doorGlass.addColorStop(1, '#4fa8bd');
  ctx.fillStyle = doorGlass;
  roundRect(doorX + 3, doorY + 4, doorW / 2 - 5, doorH - 4, 2);
  ctx.fill();
  roundRect(doorX + doorW / 2 + 2, doorY + 4, doorW / 2 - 5, doorH - 4, 2);
  ctx.fill();

  const flagX = cx - 210;
  const flagY = bY + 12;
  const flagW = 34, flagH = 22;
  const poleTopY = flagY - 8;

  ctx.strokeStyle = '#b0bec5';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(flagX, baseY);
  ctx.lineTo(flagX, poleTopY);
  ctx.stroke();

  ctx.fillStyle = '#fbc02d';
  ctx.beginPath();
  ctx.arc(flagX, poleTopY, 4.5, 0, Math.PI * 2);
  ctx.fill();

  const stripeH = flagH / 5;
  const flagColors = ['#d32f2f', '#ffffff', '#1976d2', '#ffffff', '#d32f2f'];
  const wave = Math.sin(globalTime * 5) * 3;

  flagColors.forEach((color, idx) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(flagX + 2, flagY + (idx * stripeH));
    ctx.quadraticCurveTo(flagX + flagW / 2, flagY + (idx * stripeH) + wave, flagX + flagW, flagY + (idx * stripeH));
    ctx.lineTo(flagX + flagW, flagY + ((idx + 1) * stripeH));
    ctx.quadraticCurveTo(flagX + flagW / 2, flagY + ((idx + 1) * stripeH) + wave, flagX + 2, flagY + ((idx + 1) * stripeH));
    ctx.closePath();
    ctx.fill();
  });

  drawTree(bX - 25, baseY - 12);
  drawTree(bX + bW + 25, baseY - 12);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawMenuRoad() {
  const roadY = 300, roadH = 130;
  const asphaltGrad = ctx.createLinearGradient(0, roadY, 0, roadY + roadH);
  asphaltGrad.addColorStop(0, '#3c4750');
  asphaltGrad.addColorStop(1, '#20272d');
  ctx.fillStyle = asphaltGrad;
  ctx.fillRect(0, roadY, W, roadH);

  ctx.save();
  ctx.strokeStyle = 'rgba(251,192,45,0.55)';
  ctx.setLineDash([22, 16]);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, roadY + roadH / 2);
  ctx.lineTo(W, roadY + roadH / 2);
  ctx.stroke();
  ctx.restore();

  drawThaiBevelCurb(0, roadY - 8, W, 8);
  drawThaiBevelCurb(0, roadY + roadH, W, 8);

  // --- วาดทางม้าลายแถบแดง-ขาวเต็มรูปแบบ ---
  const cx0 = W / 2 - 90, cx1 = W / 2 + 90;
  const cwWidth = cx1 - cx0;
  const padY = 2;
  const crossH = roadH - (padY * 2);
  const crossY = roadY + padY;

  const stripeCount = 13;
  const stripeH = crossH / stripeCount;

  for (let i = 0; i < stripeCount; i++) {
    const targetY = crossY + (i * stripeH);
    const stripeGrad = ctx.createLinearGradient(cx0, targetY, cx0 + cwWidth, targetY);

    if (i % 2 === 0) {
      const shadedRed = shadeColor('#d32f2f', -12);
      stripeGrad.addColorStop(0, '#e53935');
      stripeGrad.addColorStop(1, shadedRed);
      ctx.fillStyle = stripeGrad;
    } else {
      stripeGrad.addColorStop(0, '#ffffff');
      stripeGrad.addColorStop(1, '#e0e0e0');
      ctx.fillStyle = stripeGrad;
    }

    ctx.fillRect(cx0, targetY, cwWidth, stripeH);
    
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(cx0, targetY + stripeH - 0.8, cwWidth, 0.8);
  }

  // --- สัญญาณไฟจราจรจำลองหน้าเมนู (เปลี่ยนไฟตามเวลา) ---
  const menuPhaseCycle = (globalTime * 1000) % 9000;
  let menuPhase = 'green';
  if (menuPhaseCycle > 4000 && menuPhaseCycle <= 5200) menuPhase = 'yellow';
  else if (menuPhaseCycle > 5200) menuPhase = 'red';

  drawTrafficLight(cx1 + 70, roadY - 8, { phase: menuPhase });
}

function isTouchDevice() {
  return ('ontouchstart' in window) || 
         (navigator.maxTouchPoints > 0) || 
         (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}

function showScreen(screenId) {
  const screens = ['menuScreen', 'howtoScreen', 'pauseScreen', 'levelCompleteScreen', 'gameOverScreen', 'winScreen'];
  screens.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (id === screenId) el.classList.remove('hidden');
      else el.classList.add('hidden');
    }
  });

  const hud = document.getElementById('hud');
  const touch = document.getElementById('touchControls');
  if (state === STATE.PLAYING || state === STATE.PAUSED) {
    hud.classList.remove('hidden');
    
    // แสดง Touch Controls เฉพาะบนอุปกรณ์ Touch Screen เท่านั้น
    if (isTouchDevice()) {
      touch.classList.remove('hidden');
    } else {
      touch.classList.add('hidden');
    }
  } else {
    hud.classList.add('hidden');
    touch.classList.add('hidden');
  }
}

function drawMenuTraffic() {
  menuStreetCars.forEach(car => {
    drawCar(car);
  });
}

function drawMenuMascot() {
  const bounce = Math.abs(Math.sin(globalTime * 2.4)) * 10;
  const x = W / 2, y = 470 - bounce;
  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(0, 44, 26, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.scale(1.9, 1.9);

  const shirtGrad = ctx.createLinearGradient(-10, -10, 10, 6);
  shirtGrad.addColorStop(0, '#42a5f5');
  shirtGrad.addColorStop(1, '#1565c0');
  ctx.fillStyle = shirtGrad;
  roundRect(-10, -10, 20, 16, 4); ctx.fill();
  ctx.fillStyle = '#0d47a1';
  roundRect(-8, -8, 16, 6, 2); ctx.fill();

  ctx.fillStyle = '#ffcc80';
  ctx.fillRect(-6, 8, 4, 8);
  ctx.fillStyle = '#212121';
  roundRect(-7, 14, 6, 4, 2); ctx.fill();
  ctx.fillStyle = '#ffcc80';
  ctx.fillRect(2, 8, 4, 8);
  ctx.fillStyle = '#212121';
  roundRect(1, 14, 6, 4, 2); ctx.fill();

  ctx.fillStyle = '#0d47a1';
  roundRect(-8, 3, 16, 8, 2); ctx.fill();
  ctx.fillStyle = '#f5f5f5';
  roundRect(-8, -8, 16, 12, 3); ctx.fill();

  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(-11, -7, 4, 6);
  ctx.fillStyle = '#ffcc80';
  ctx.fillRect(-11, -1, 4, 6);

  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(7, -12, 4, 6);
  ctx.fillStyle = '#ffcc80';
  ctx.fillRect(7, -22, 4, 11);
  ctx.beginPath(); ctx.arc(9, -23, 4, 0, Math.PI * 2); ctx.fill();

  ctx.save();
  ctx.shadowColor = '#ffd54f';
  ctx.shadowBlur = 14;
  ctx.strokeStyle = '#ffb300';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(9, -23, 10 + Math.sin(globalTime * 10) * 2, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('✋', 9, -34 + Math.sin(globalTime * 8) * 2);

  ctx.fillStyle = '#ffcc80';
  ctx.beginPath(); ctx.arc(0, -15, 9, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = '#212121';
  ctx.beginPath(); ctx.arc(-3, -16, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(3, -16, 1.5, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = '#263238';
  ctx.beginPath();
  ctx.arc(0, -17, 9.5, Math.PI * 0.8, Math.PI * 2.2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-9, -18); ctx.quadraticCurveTo(-3, -13, 0, -17);
  ctx.quadraticCurveTo(4, -13, 9, -18);
  ctx.lineTo(9, -21); ctx.lineTo(-9, -21);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawMenuScene() {
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
  skyGrad.addColorStop(0, '#2f6fb0');
  skyGrad.addColorStop(0.35, '#5c9bd6');
  skyGrad.addColorStop(0.62, '#ffcf8a');
  skyGrad.addColorStop(0.78, '#ffe6b0');
  skyGrad.addColorStop(1, '#fff3d6');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);

  const sunY = 190;
  const sunGlow = ctx.createRadialGradient(W / 2, sunY, 10, W / 2, sunY, 220);
  sunGlow.addColorStop(0, 'rgba(255,236,179,0.85)');
  sunGlow.addColorStop(1, 'rgba(255,236,179,0)');
  ctx.fillStyle = sunGlow;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff3c4';
  ctx.beginPath();
  ctx.arc(W / 2, sunY, 46 + Math.sin(globalTime * 1.5) * 2, 0, Math.PI * 2);
  ctx.fill();

  menuClouds.forEach(c => {
    drawMenuCloud(c.x, c.y, c.scale);
  });

  menuBirds.forEach(b => {
    drawMenuBird(b.x, b.y + Math.sin(globalTime + b.phase) * 6, globalTime + b.phase);
  });

  drawMenuSkyline();
  drawMenuSchoolBackground();
  drawMenuRoad();
  drawMenuTraffic();

  const groundGrad = ctx.createLinearGradient(0, 430, 0, H);
  groundGrad.addColorStop(0, '#e8dfd2');
  groundGrad.addColorStop(1, '#cbbfa9');
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, 430, W, H - 430);

  drawMenuMascot();

  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(20,15,10,0.15)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

/* ---------------------------------------------------------------------
   MAIN GAME LOOP & BUTTON EVENTS
   --------------------------------------------------------------------- */
function gameLoop(time) {
  const dt = Math.min((time - game.lastTime) / 1000, 0.1) || 0.016;
  game.lastTime = time;

  update(dt);
  draw();

  requestAnimationFrame(gameLoop);
}

// ปุ่มควบคุม UI และการเริ่มต้นเกม
// หมายเหตุ: ครอบทั้งหมดด้วย DOMContentLoaded + เช็ค null ทุกปุ่ม กัน error
// ทำให้ script หยุดทำงานกลางคันถ้ามี id ไหนหาไม่เจอ และแก้ id ปุ่มให้ตรงกับ index.html จริง ๆ
// (ตัวการหลักของปัญหาคือ id ใน JS ไม่ตรงกับ HTML: 'backMenuBtn' -> ต้องเป็น 'backFromHowto',
//  'retryBtn' -> ไม่มีปุ่มนี้ใน HTML เลย ต้องเป็น 'mainMenuBtn', และปุ่ม 'exitBtn',
//  'restartFromPauseBtn', 'menuFromPauseBtn', 'winMenuBtn' ไม่เคยถูกผูก event เลย)
document.addEventListener('DOMContentLoaded', () => {

  // helper: ผูก event แบบปลอดภัย ถ้าไม่เจอ element จะไม่ error แค่ไม่ทำอะไร
  function bindClick(id, handler) {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', handler);
    } else {
      console.warn(`[UI] ไม่พบปุ่ม id="${id}" ในหน้า HTML`);
    }
  }

  // ----- เมนูหลัก -----
  bindClick('startBtn', () => {
    ensureAudio();
    SFX.click();
    state = STATE.PLAYING;
    startNewGame();
    showScreen('');
  });

  bindClick('howtoBtn', () => {
    ensureAudio();
    SFX.click();
    state = STATE.HOWTO;
    showScreen('howtoScreen');
  });

  bindClick('exitBtn', () => {
    ensureAudio();
    SFX.click();
    // เบราว์เซอร์ส่วนใหญ่ไม่อนุญาตให้ปิดแท็บด้วยสคริปต์ถ้าไม่ใช่แท็บที่สคริปต์เปิดเอง
    // จึงลอง window.close() ก่อน แล้ว fallback เป็นข้อความแจ้งผู้เล่น
    window.close();
    setTimeout(() => {
      alert('ปิดหน้าต่างเบราว์เซอร์นี้เพื่อออกจากเกมได้เลยครับ');
    }, 100);
  });

  // ----- วิธีการเล่น: ปุ่มกลับเมนู (id จริงคือ backFromHowto ไม่ใช่ backMenuBtn) -----
  bindClick('backFromHowto', () => {
    ensureAudio();
    SFX.click();
    state = STATE.MENU;
    showScreen('menuScreen');
  });

  // ----- หน้าพักเกม (Pause) -----
  bindClick('pauseBtn', () => {
    ensureAudio();
    SFX.click();
    togglePause();
  });

  bindClick('resumeBtn', () => {
    ensureAudio();
    SFX.click();
    togglePause();
  });

  // เดิมปุ่มนี้ไม่เคยถูกผูก event เลย
  bindClick('restartFromPauseBtn', () => {
    ensureAudio();
    SFX.click();
    state = STATE.PLAYING;
    startNewGame();
    showScreen('');
  });

  // เดิมปุ่มนี้ไม่เคยถูกผูก event เลย
  bindClick('menuFromPauseBtn', () => {
    ensureAudio();
    SFX.click();
    state = STATE.MENU;
    showScreen('menuScreen');
  });

  // ----- ด่านถัดไป -----
  bindClick('nextLevelBtn', () => {
    ensureAudio();
    SFX.click();
    state = STATE.PLAYING;
    loadLevel(game.levelIndex + 1);
    showScreen('');
  });

  // ----- หน้าเกมจบ (Game Over) -----
  bindClick('restartBtn', () => {
    ensureAudio();
    SFX.click();
    state = STATE.PLAYING;
    startNewGame();
    showScreen('');
  });

  // เดิมโค้ดผูก id 'retryBtn' ซึ่งไม่มีอยู่จริงใน HTML เลย ที่ถูกต้องคือ 'mainMenuBtn'
  bindClick('mainMenuBtn', () => {
    ensureAudio();
    SFX.click();
    state = STATE.MENU;
    showScreen('menuScreen');
  });

  // ----- หน้าชนะเกม (Win) -----
  bindClick('playAgainBtn', () => {
    ensureAudio();
    SFX.click();
    state = STATE.PLAYING;
    startNewGame();
    showScreen('');
  });

  // เดิมปุ่มนี้ไม่เคยถูกผูก event เลย
  bindClick('winMenuBtn', () => {
    ensureAudio();
    SFX.click();
    state = STATE.MENU;
    showScreen('menuScreen');
  });

  // โหลดคะแนนสูงสุดเริ่มต้น
  const menuHighScoreEl = document.getElementById('menuHighScore');
  if (menuHighScoreEl) menuHighScoreEl.textContent = game.highScore;

  // เริ่มวนลูปเกม (ย้ายมาไว้ใน DOMContentLoaded เพื่อความชัวร์ว่า canvas พร้อมแล้ว)
  requestAnimationFrame(gameLoop);
});