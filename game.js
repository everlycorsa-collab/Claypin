// ===== Claypin — "Первый день" (лобби -> серверная -> провода -> выход) =====

const canvas = document.getElementById('game');
const VIEW_W = 812, VIEW_H = 375; // ландшафтный вьюпорт — iPhone 11 повёрнутый
const ASPECT = VIEW_W / VIEW_H;

const roomLabelEl = document.getElementById('roomLabel');
const hintEl = document.getElementById('hintText');
const dialogueEl = document.getElementById('dialogue');
const dialogueTextEl = document.getElementById('dialogueText');
const dialogueChoicesEl = document.getElementById('dialogueChoices');
const fadeEl = document.getElementById('fade');

const puzzlePanelEl = document.getElementById('panelPuzzle');
const puzzleHintRowEl = document.getElementById('puzzleHintRow');
const puzzleSocketsEl = document.getElementById('puzzleSockets');
const puzzleMsgEl = document.getElementById('puzzleMsg');
const puzzleCloseBtn = document.getElementById('puzzleCloseBtn');

const windowViewEl = document.getElementById('windowView');
const windowBackBtn = document.getElementById('windowBackBtn');

const networkPanelEl = document.getElementById('panelNetwork');
const networkHintRowEl = document.getElementById('networkHintRow');
const networkCloseBtn = document.getElementById('networkCloseBtn');

const terminalPanelEl = document.getElementById('panelTerminal');
const terminalScreenEl = document.getElementById('terminalScreen');
const terminalCloseBtn = document.getElementById('terminalCloseBtn');

const debugToggleBtn = document.getElementById('debugToggleBtn');
const debugReadoutEl = document.getElementById('debugReadout');

// ---------- Процедурные текстуры (bump-карты для настоящего 3D-света) ----------
function makeNoiseTile(size, baseGray, speckDensity, speckSize, elongation) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const nctx = c.getContext('2d');
  nctx.fillStyle = `rgb(${baseGray},${baseGray},${baseGray})`;
  nctx.fillRect(0, 0, size, size);
  const count = Math.round(size * size * speckDensity);
  for (let i = 0; i < count; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = speckSize * (0.5 + Math.random());
    const dark = Math.random() < 0.55;
    const shade = Math.max(0, Math.min(255, baseGray + (dark ? -1 : 1) * (10 + Math.random() * 35)));
    nctx.globalAlpha = 0.08 + Math.random() * 0.16;
    nctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    nctx.beginPath();
    nctx.ellipse(x, y, r, r * elongation, Math.random() * Math.PI, 0, Math.PI * 2);
    nctx.fill();
  }
  nctx.globalAlpha = 1;
  return c;
}

function toTexture(canvasEl, repeatX, repeatY) {
  const tex = new THREE.CanvasTexture(canvasEl);
  if (repeatX !== undefined) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
  }
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function clayMaterial(color) {
  return new THREE.MeshLambertMaterial({ color });
}

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ---------- Цвета проводов и головоломка щитка ----------
const COLOR_KEYS = ['green', 'gray', 'blue', 'orange'];
const COLOR_HEX = { green: '#3fae5c', gray: '#9aa0a6', blue: '#3f7ae0', orange: '#e08a3f' };

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function rotateArray(arr, n) { return arr.map((_, i) => arr[(i + n) % arr.length]); }

const targetOrder = shuffleArray(COLOR_KEYS);
let currentOrder = rotateArray(targetOrder, 1 + Math.floor(Math.random() * 3)); // никогда не совпадает изначально

// ---------- Лобби (реальный фон-арт) ----------
// Разрывы и прямоугольники ниже — оценка на глаз по картинке 3576x1184.
// Включи debug-кнопку (🐞) в игре, чтобы увидеть контуры хотспотов/линии ходьбы и подогнать координаты по месту.
const LOBBY_W = 3576, LOBBY_H = 1184;

// Как в NeverHood: персонаж всегда стоит на одной фиксированной линии пола и ходит только влево/вправо.
// Тап в ЛЮБОМ месте экрана берёт только X — игрок разворачивается и идёт туда по этой линии.
const WALK_LINE_Y = 1080;
const WALK_X_MIN = 90, WALK_X_MAX = 3500;

const LOBBY_HOTSPOTS = {
  networkBoard: { kind: 'networkBoard', rect: [60, 270, 650, 790], standX: 360, standY: WALK_LINE_Y, label: 'Экран статуса сети' },
  door: { kind: 'door', rect: [1450, 300, 1850, 1030], standX: 1650, standY: WALK_LINE_Y, label: 'Дверь' },
  archway: { kind: 'archway', rect: [2200, 300, 2620, 1030], standX: 2410, standY: WALK_LINE_Y, label: 'Сервисный тоннель' },
  terminal: { kind: 'terminal', rect: [2990, 630, 3280, 1045], standX: 3135, standY: WALK_LINE_Y, label: 'Терминал' },
};

// ---------- Комнаты ----------
const ROOM_BOUNDS = {
  server: { w: 260, d: 260 },
};

const serverProps = {
  hatchBack: { x: 40, z: 30, w: 42, d: 24, h: 48 },
  fusebox: { x: 140, z: 30, w: 52, d: 18, h: 88 },
  window: { x: 230, z: 25, w: 95, d: 6, h: 115 },
};

let currentRoom = 'lobby';
let powered = false;
let powerProgress = 0;

// ---------- Игрок ----------
// в лобби player.z хранит "глубину" в пиксельных координатах фона (по нему же считаем масштаб)
const player = { x: 900, z: 1080, facing: 1 };
let walkTarget = null;
let pendingAction = null;
let walkLabel = '';

let dialogueOpen = false;
let puzzleOpen = false;
let windowViewOpen = false;
let networkOpen = false;
let terminalOpen = false;
let debugMode = false;
const transitionState = { active: false, phase: null, t: 0, targetRoom: null };
const FADE_T = 0.25;

function uiBlocked() {
  return dialogueOpen || puzzleOpen || windowViewOpen || networkOpen || terminalOpen || transitionState.active;
}

// ---------- Диалог у двери ----------
function openDoorHint() {
  dialogueOpen = true;
  dialogueEl.classList.remove('hidden');
  dialogueTextEl.textContent = 'Access Denied. Power system is offline!';
  dialogueChoicesEl.innerHTML = '';
  const btn = document.createElement('button');
  btn.className = 'choiceBtn';
  btn.textContent = 'Понятно';
  btn.onclick = closeDialogue;
  dialogueChoicesEl.appendChild(btn);
}

function closeDialogue() {
  dialogueEl.classList.add('hidden');
  dialogueOpen = false;
}

function finishLevel() {
  dialogueOpen = true;
  dialogueEl.classList.remove('hidden');
  dialogueTextEl.textContent = 'Уровень пройден!\nПитание восстановлено, дверь открыта.';
  dialogueChoicesEl.innerHTML = '';
  const btn = document.createElement('button');
  btn.className = 'choiceBtn';
  btn.textContent = 'Заново';
  btn.onclick = () => window.location.reload();
  dialogueChoicesEl.appendChild(btn);
}

// ---------- Экран "NETWORK STATUS" — зум-модалка с подсказкой к головоломке ----------
function openNetworkPanel() {
  networkOpen = true;
  networkHintRowEl.innerHTML = targetOrder.map((k) => `<span class="dot" style="background:${COLOR_HEX[k]}"></span>`).join('');
  networkPanelEl.classList.remove('hidden');
}
function closeNetworkPanel() {
  networkOpen = false;
  networkPanelEl.classList.add('hidden');
}
networkCloseBtn.onclick = closeNetworkPanel;

// ---------- Терминал ----------
const TERMINAL_LINES = [
  '&gt; BOOT SEQUENCE...',
  '&gt; MAIN GRID: OFFLINE',
  '&gt; BACKUP GRID: OFFLINE',
  '&gt; LAST EVENT: PHASE SYNC FAILURE',
  '&gt; ACTION REQUIRED: restore fusebox',
  '&nbsp;&nbsp;&nbsp;phase order — see SERVICE PANEL, server room',
  '&gt; STATUS: awaiting technician...',
];
function openTerminalPanel() {
  terminalOpen = true;
  terminalScreenEl.innerHTML = TERMINAL_LINES.join('<br>') + '<br><span class="cursor"></span>';
  terminalPanelEl.classList.remove('hidden');
}
function closeTerminalPanel() {
  terminalOpen = false;
  terminalPanelEl.classList.add('hidden');
}
terminalCloseBtn.onclick = closeTerminalPanel;

// ---------- Головоломка щитка ----------
function renderHintRow() {
  puzzleHintRowEl.innerHTML = targetOrder.map((k) => `<span class="dot" style="background:${COLOR_HEX[k]}"></span>`).join('');
}

function attachPlugDrag(plugEl) {
  plugEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const idx = Number(plugEl.dataset.index);
    const rect = plugEl.getBoundingClientRect();
    const offsetX = e.clientX - rect.left, offsetY = e.clientY - rect.top;
    plugEl.classList.add('dragging');
    plugEl.style.width = rect.width + 'px';
    plugEl.style.height = rect.height + 'px';
    plugEl.style.left = rect.left + 'px';
    plugEl.style.top = rect.top + 'px';
    plugEl.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      plugEl.style.left = (ev.clientX - offsetX) + 'px';
      plugEl.style.top = (ev.clientY - offsetY) + 'px';
    };
    const onUp = (ev) => {
      plugEl.removeEventListener('pointermove', onMove);
      plugEl.classList.remove('dragging');
      plugEl.style.width = ''; plugEl.style.height = ''; plugEl.style.left = ''; plugEl.style.top = '';
      const socketEls = [...puzzleSocketsEl.querySelectorAll('.socket')];
      let dropIdx = idx;
      for (let i = 0; i < socketEls.length; i++) {
        const r = socketEls[i].getBoundingClientRect();
        if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) { dropIdx = i; break; }
      }
      if (dropIdx !== idx) {
        const tmp = currentOrder[dropIdx];
        currentOrder[dropIdx] = currentOrder[idx];
        currentOrder[idx] = tmp;
        renderSockets();
        checkPuzzleSolved();
      }
    };
    plugEl.addEventListener('pointermove', onMove);
    plugEl.addEventListener('pointerup', onUp, { once: true });
  });
}

function renderSockets() {
  puzzleSocketsEl.innerHTML = '';
  currentOrder.forEach((colorKey, i) => {
    const socket = document.createElement('div');
    socket.className = 'socket';
    const plug = document.createElement('div');
    plug.className = 'plug';
    plug.dataset.index = String(i);
    plug.style.background = COLOR_HEX[colorKey];
    attachPlugDrag(plug);
    socket.appendChild(plug);
    puzzleSocketsEl.appendChild(socket);
  });
}

function checkPuzzleSolved() {
  const solved = currentOrder.every((c, i) => c === targetOrder[i]);
  if (solved) {
    puzzleMsgEl.textContent = 'Есть контакт!';
    setTimeout(() => { closePuzzle(); onPowerRestored(); }, 700);
  } else {
    puzzleMsgEl.textContent = '';
  }
}

function openPuzzle() {
  puzzleOpen = true;
  puzzleMsgEl.textContent = '';
  renderHintRow();
  renderSockets();
  puzzlePanelEl.classList.remove('hidden');
}

function closePuzzle() {
  puzzleOpen = false;
  puzzlePanelEl.classList.add('hidden');
}

puzzleCloseBtn.onclick = closePuzzle;

let statusMessage = '';
let statusMessageTimer = 0;
function showStatusMessage(text, seconds) {
  statusMessage = text;
  statusMessageTimer = seconds;
}

function onPowerRestored() {
  powered = true;
  showStatusMessage('Свет включился!', 2.5);
}

// ---------- Окно-тизер (серверная) ----------
function openWindowView() {
  windowViewOpen = true;
  windowViewEl.classList.remove('hidden');
}
function closeWindowView() {
  windowViewOpen = false;
  windowViewEl.classList.add('hidden');
}
windowBackBtn.onclick = closeWindowView;

// ---------- Переход между комнатами (затемнение) ----------
function startTransition(targetRoom) {
  transitionState.active = true;
  transitionState.phase = 'fadeOut';
  transitionState.t = 0;
  transitionState.targetRoom = targetRoom;
  fadeEl.classList.add('on');
}

function doRoomSwitch(targetRoom) {
  if (targetRoom === 'server') {
    player.x = 70; player.z = 90; player.facing = 1;
  } else {
    player.x = LOBBY_HOTSPOTS.archway.standX; player.z = LOBBY_HOTSPOTS.archway.standY; player.facing = -1;
  }
  applyRoomState(targetRoom);
}

// ---------- Обновление ----------
const MOVE_SPEED_LOBBY = 850;
const MOVE_SPEED_SERVER = 150;

function update(dt) {
  if (transitionState.active) {
    transitionState.t += dt;
    if (transitionState.phase === 'fadeOut' && transitionState.t >= FADE_T) {
      doRoomSwitch(transitionState.targetRoom);
      transitionState.t = 0;
      transitionState.phase = 'fadeIn';
      fadeEl.classList.remove('on');
    } else if (transitionState.phase === 'fadeIn' && transitionState.t >= FADE_T) {
      transitionState.active = false;
      transitionState.phase = null;
    }
    return;
  }

  if (uiBlocked()) return;

  if (walkTarget) {
    const dx = walkTarget.x - player.x, dz = walkTarget.z - player.z;
    const d = Math.hypot(dx, dz);
    if (d < 8) {
      player.x = walkTarget.x; player.z = walkTarget.z;
      walkTarget = null;
      walkLabel = '';
      const action = pendingAction;
      pendingAction = null;
      if (action) action();
    } else {
      const speed = currentRoom === 'lobby' ? MOVE_SPEED_LOBBY : MOVE_SPEED_SERVER;
      const step = Math.min(d, speed * dt);
      player.x += (dx / d) * step;
      player.z += (dz / d) * step;
      if (Math.abs(dx) > 1) player.facing = dx > 0 ? 1 : -1;
    }
  }

  if (statusMessageTimer > 0) {
    statusMessageTimer -= dt;
    hintEl.textContent = statusMessage;
  } else {
    hintEl.textContent = walkLabel;
  }
}

// ================= 3D-сцена (Three.js) =================
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;

// Канвас в CSS растянут на весь экран (см. style.css) — держим внутреннее разрешение
// рендерера в ногу с реальным отображаемым размером, иначе картинка будет мыльной.
function resizeRendererToDisplaySize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  renderer.setSize(w, h, false);
}
resizeRendererToDisplaySize();
window.addEventListener('resize', resizeRendererToDisplaySize);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#171018');
scene.fog = new THREE.Fog('#171018', 500, 1100);

// Ортографическая камера — без перспективных искажений.
// В лобби смотрит прямо на фон-картинку и едет по X; в серверной — статично сверху-под-углом.
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);

// Кадр = вся высота фона (ceiling-to-floor, без обрезки и без "cover"-зума).
// Ширина кадра — производная от соотношения сторон экрана; так как фон широкоформатный (3:1),
// ширина кадра выходит меньше LOBBY_W, и камера едет по X вслед за игроком (см. syncScene).
let lobbyCamHalfW = 0;
let lobbyCamCenterY = LOBBY_H / 2;
let lobbyCamX = LOBBY_W / 2;
function setLobbyCameraFrustum() {
  const FRUSTUM_H = LOBBY_H;
  const FRUSTUM_W = FRUSTUM_H * ASPECT;
  camera.left = -FRUSTUM_W / 2; camera.right = FRUSTUM_W / 2;
  camera.top = FRUSTUM_H / 2; camera.bottom = -FRUSTUM_H / 2;
  camera.updateProjectionMatrix();
  lobbyCamHalfW = FRUSTUM_W / 2;
  lobbyCamCenterY = LOBBY_H / 2;
}

// Высота кадра серверной подбиралась под портретный экран (375/812) и не должна зависеть
// от текущей (теперь ландшафтной) ASPECT — иначе комната обваливается по вертикали почти в 5 раз.
const SERVER_ROOM_REF_ASPECT = 375 / 812;
function setServerCameraFrustum(w, d) {
  const FRUSTUM_H = (w + 40) / SERVER_ROOM_REF_ASPECT;
  const FRUSTUM_W = FRUSTUM_H * ASPECT;
  camera.left = -FRUSTUM_W / 2; camera.right = FRUSTUM_W / 2;
  camera.top = FRUSTUM_H / 2; camera.bottom = -FRUSTUM_H / 2;
  camera.position.set(w / 2, 650, d + 250);
  camera.lookAt(w / 2, 0, d * 0.4);
  camera.updateProjectionMatrix();
}

const ambientLight = new THREE.AmbientLight(0xfff2e0, 0.65);
scene.add(ambientLight);
const keyLight = new THREE.DirectionalLight(0xfff2da, 1.0);
keyLight.position.set(-150, 400, 250);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xc9d6ff, 0.25);
fillLight.position.set(250, 150, -100);
scene.add(fillLight);

// ---------- Лобби: реальный фон + хотспоты ----------
const lobbyGroup = new THREE.Group();
scene.add(lobbyGroup);

const lobbyTexLoader = new THREE.TextureLoader();
const lobbyBgTex = lobbyTexLoader.load('assets/source/office_lobby_bg_level_1_mvp.png');
lobbyBgTex.colorSpace = THREE.SRGBColorSpace;
const lobbyBgMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(LOBBY_W, LOBBY_H),
  new THREE.MeshBasicMaterial({ map: lobbyBgTex, fog: false }) // это плоский арт, туман сцены его не должен затемнять
);
lobbyBgMesh.position.set(LOBBY_W / 2, LOBBY_H / 2, 0);
lobbyGroup.add(lobbyBgMesh);

function toWorldY(imgY) { return LOBBY_H - imgY; }

function makeRectOutline(x0, y0, x1, y1, z, color) {
  const pts = [
    new THREE.Vector3(x0, toWorldY(y0), z), new THREE.Vector3(x1, toWorldY(y0), z),
    new THREE.Vector3(x1, toWorldY(y1), z), new THREE.Vector3(x0, toWorldY(y1), z),
  ];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color, fog: false }));
  line.visible = false;
  return line;
}

const hotspotProxies = [];
const hotspotDebugMeshes = [];
Object.values(LOBBY_HOTSPOTS).forEach((h) => {
  const [x0, y0, x1, y1] = h.rect;
  const w = x1 - x0, ht = y1 - y0;
  const cx = (x0 + x1) / 2, cyImg = (y0 + y1) / 2;

  const proxy = new THREE.Mesh(new THREE.PlaneGeometry(w, ht), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }));
  proxy.position.set(cx, toWorldY(cyImg), 2);
  proxy.userData.kind = h.kind;
  lobbyGroup.add(proxy);
  hotspotProxies.push(proxy);

  const outline = makeRectOutline(x0, y0, x1, y1, 3, '#36e0ff');
  lobbyGroup.add(outline);
  hotspotDebugMeshes.push(outline);
});

const floorDebugLine = (() => {
  const y = toWorldY(WALK_LINE_Y);
  const pts = [new THREE.Vector3(WALK_X_MIN, y, 3), new THREE.Vector3(WALK_X_MAX, y, 3)];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#ff36c9', fog: false }));
  line.visible = false;
  lobbyGroup.add(line);
  return line;
})();

// индикатор питания у двери (красный/зелёный, поверх фона)
const doorLampMesh = new THREE.Mesh(new THREE.CircleGeometry(16, 16), new THREE.MeshBasicMaterial({ color: '#e0483f', fog: false }));
{
  const d = LOBBY_HOTSPOTS.door.rect;
  doorLampMesh.position.set(d[2] + 25, toWorldY(d[1] + 30), 2);
}
lobbyGroup.add(doorLampMesh);

function setDebugMode(on) {
  debugMode = on;
  debugToggleBtn.classList.toggle('active', on);
  debugReadoutEl.classList.toggle('hidden', !on);
  floorDebugLine.visible = on && currentRoom === 'lobby';
  hotspotDebugMeshes.forEach((m) => { m.visible = on && currentRoom === 'lobby'; });
  if (!on) debugReadoutEl.textContent = '';
}
debugToggleBtn.onclick = () => setDebugMode(!debugMode);
setDebugMode(true); // включено по умолчанию, чтобы сразу видеть границы пола/хотспотов

// ---------- Комната: серверная (процедурная 3D-геометрия) ----------
const plasterTexServer = toTexture(makeNoiseTile(96, 60, 0.3, 2.2, 0.6), 7.5, 6.5);
const concreteTex = toTexture(makeNoiseTile(64, 55, 0.4, 1.6, 0.7), 7.5, 7.5);

function buildRoomShell(w, d, wallColor, wallBump, floorColor, floorBump) {
  const group = new THREE.Group();
  const wallMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 40, 260),
    new THREE.MeshLambertMaterial({ color: wallColor, bumpMap: wallBump, bumpScale: 1.0 })
  );
  wallMesh.position.set(w / 2, 130, 0);
  group.add(wallMesh);

  const sideWallGeo = new THREE.PlaneGeometry(d + 40, 260);
  const sideWallMat = new THREE.MeshLambertMaterial({ color: wallColor, bumpMap: wallBump, bumpScale: 1.0 });
  const leftWall = new THREE.Mesh(sideWallGeo, sideWallMat);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(0, 130, d / 2);
  group.add(leftWall);
  const rightWall = new THREE.Mesh(sideWallGeo, sideWallMat.clone());
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(w, 130, d / 2);
  group.add(rightWall);

  const floorMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 40, d + 60),
    new THREE.MeshLambertMaterial({ color: floorColor, map: floorBump, bumpMap: floorBump, bumpScale: 0.6 })
  );
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.set(w / 2, 0, d / 2);
  group.add(floorMesh);

  return { group, floorMesh };
}

const serverShell = buildRoomShell(ROOM_BOUNDS.server.w, ROOM_BOUNDS.server.d, '#2c2a36', plasterTexServer, '#33312c', concreteTex);
const serverGroup = serverShell.group;
const serverFloor = serverShell.floorMesh;
serverGroup.visible = false;
scene.add(serverGroup);

function makeSkylineTile() {
  const c = document.createElement('canvas');
  c.width = 160; c.height = 120;
  const sctx = c.getContext('2d');
  const grad = sctx.createLinearGradient(0, 0, 0, 120);
  grad.addColorStop(0, '#2b3a66');
  grad.addColorStop(0.55, '#6a7cb0');
  grad.addColorStop(1, '#cfa96a');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 160, 120);
  sctx.fillStyle = '#232538';
  const buildings = [[8, 55, 20], [34, 78, 28], [70, 40, 18], [94, 62, 24], [124, 34, 22]];
  buildings.forEach(([x, h, w]) => sctx.fillRect(x, 120 - h, w, h));
  return c;
}
const skylineTex = toTexture(makeSkylineTile());

// лаз обратно в лобби
const hatchBackGroup = new THREE.Group();
{
  const p = serverProps.hatchBack;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, 8), clayMaterial('#4a4438'));
  frame.position.set(0, p.h / 2, -p.d / 2 + 4);
  hatchBackGroup.add(frame);
  for (let i = 0; i < 4; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(p.w - 8, 2.5, 2), clayMaterial('#26221c'));
    bar.position.set(0, 8 + i * (p.h - 16) / 3, -p.d / 2 + 8);
    hatchBackGroup.add(bar);
  }
}
hatchBackGroup.position.set(serverProps.hatchBack.x, 0, serverProps.hatchBack.z);
hatchBackGroup.userData.kind = 'hatchBack';
serverGroup.add(hatchBackGroup);

// щиток питания
const fuseboxGroup = new THREE.Group();
let fuseboxIndicator;
{
  const p = serverProps.fusebox;
  const body = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), clayMaterial('#a83f38'));
  body.position.set(0, p.h / 2, 0);
  fuseboxGroup.add(body);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(p.w - 10, p.h - 16, 3), clayMaterial('#8a332e'));
  plate.position.set(0, p.h / 2, p.d / 2 + 2);
  fuseboxGroup.add(plate);
  const warnTri = new THREE.Mesh(new THREE.ConeGeometry(9, 9, 3), new THREE.MeshBasicMaterial({ color: '#e8c93a' }));
  warnTri.position.set(-p.w / 2 + 14, p.h - 16, p.d / 2 + 4);
  fuseboxGroup.add(warnTri);
  fuseboxIndicator = new THREE.Mesh(new THREE.SphereGeometry(4, 10, 8), new THREE.MeshStandardMaterial({ color: '#3a1414', emissive: '#3a0f0f' }));
  fuseboxIndicator.position.set(p.w / 2 - 12, p.h - 16, p.d / 2 + 5);
  fuseboxGroup.add(fuseboxIndicator);
}
fuseboxGroup.position.set(serverProps.fusebox.x, 0, serverProps.fusebox.z);
fuseboxGroup.userData.kind = 'fusebox';
serverGroup.add(fuseboxGroup);

// окно-тизер на дальнюю локацию
const windowGroup = new THREE.Group();
{
  const p = serverProps.window;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(p.w + 8, p.h + 8, 5), clayMaterial('#5a5448'));
  frame.position.set(0, p.h / 2, -1);
  windowGroup.add(frame);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), new THREE.MeshBasicMaterial({ map: skylineTex }));
  glass.position.set(0, p.h / 2, 1.5);
  windowGroup.add(glass);
}
windowGroup.position.set(serverProps.window.x, 0, serverProps.window.z);
windowGroup.userData.kind = 'window';
serverGroup.add(windowGroup);

// светящиеся жилы на стенах серверной (загораются при подаче питания)
const glowStripMeshes = [];
[
  { x: 100, z: 4, len: 140 },
  { x: 180, z: 4, len: 90 },
].forEach((cfg) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(cfg.len, 4, 2), new THREE.MeshBasicMaterial({ color: '#141820' }));
  mesh.position.set(cfg.x, 60 + Math.random() * 60, cfg.z);
  serverGroup.add(mesh);
  glowStripMeshes.push(mesh);
});

// ---------- Игрок: спрайт из настоящих пластилиновых стикеров ----------
const POSES = ['whatdahell', 'hi', 'allgood', 'waaat', 'whatdaheck'];
const poseTextures = {};
const texLoader = new THREE.TextureLoader();
POSES.forEach((name) => {
  const tex = texLoader.load(`assets/source/${name}.webp`);
  tex.colorSpace = THREE.SRGBColorSpace;
  poseTextures[name] = tex;
});

// покадровый цикл ходьбы (8 кадров, зелёный экран вырезан chroma-key) — заменяет статичную позу "waaat"
const WALK_FRAME_COUNT = 8;
const WALK_FPS = 12;
const walkTextures = [];
for (let i = 1; i <= WALK_FRAME_COUNT; i++) {
  const tex = texLoader.load(`assets/source/walk_${i}.png`);
  tex.colorSpace = THREE.SRGBColorSpace;
  walkTextures.push(tex);
}
const WALK_FRAME_ASPECT = 485 / 478; // исходное соотношение сторон кадров ходьбы (почти квадрат)

const PLAYER_VISUAL_W = 78, PLAYER_VISUAL_H = 92; // серверная (маленький масштаб комнаты)
const PLAYER_LOBBY_W = 240, PLAYER_LOBBY_H = 282; // лобби, x1.2 для пропорции с дверьми/мебелью (фиксированный — глубины по Z больше нет)
// кадры ходьбы шире в плечах (расставленные ноги/руки) — держим ту же высоту, что и у стоячей позы, ширину считаем по их родной пропорции
const PLAYER_WALK_H = PLAYER_LOBBY_H;
const PLAYER_WALK_W = PLAYER_WALK_H * WALK_FRAME_ASPECT;
const PLAYER_VISUAL_WALK_H = PLAYER_VISUAL_H;
const PLAYER_VISUAL_WALK_W = PLAYER_VISUAL_WALK_H * WALK_FRAME_ASPECT;
const playerMaterial = new THREE.SpriteMaterial({ map: poseTextures.whatdahell, transparent: true, fog: false });
const playerSprite = new THREE.Sprite(playerMaterial);
// якорь (0.5, 0) в системе Three.js (Y растёт вверх) = "низ по центру" — то же самое, что (0.5, 1.0)
// в экранных координатах (Y растёт вниз). Ноги/тень стоят ровно на этой точке.
playerSprite.center.set(0.5, 0);
scene.add(playerSprite);

// мягкая тень-эллипс под ногами — держит персонажа "прижатым" к ковру визуально
function makeShadowTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const sctx = c.getContext('2d');
  const g = sctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.45)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = g;
  sctx.fillRect(0, 0, 128, 128);
  return c;
}
const shadowTex = toTexture(makeShadowTexture());
const shadowMaterial = new THREE.SpriteMaterial({ map: shadowTex, transparent: true, depthWrite: false, fog: false });
const shadowSprite = new THREE.Sprite(shadowMaterial);
scene.add(shadowSprite);

// во время ходьбы используется покадровый walk-cycle (walkTextures), а не статичный стикер;
// анфас (whatdahell) — только когда стоит на месте и "смотрит на игрока". Больше никакого чередования эмоций.
function currentPoseName() {
  if (uiBlocked()) return 'allgood';
  if (walkTarget) return 'walking';
  return 'whatdahell';
}

// маленькая пластилиновая "печать" в месте тапа — быстрый squish-ripple, чисто декоративно
function makePokeTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const pctx = c.getContext('2d');
  const g = pctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,250,235,0.85)');
  g.addColorStop(0.55, 'rgba(255,250,235,0.35)');
  g.addColorStop(1, 'rgba(255,250,235,0)');
  pctx.fillStyle = g;
  pctx.fillRect(0, 0, 64, 64);
  return c;
}
const pokeTex = toTexture(makePokeTexture());
const activePokes = [];
const POKE_DURATION = 0.35;
function spawnPoke(worldX, worldY) {
  const mat = new THREE.SpriteMaterial({ map: pokeTex, transparent: true, depthWrite: false, fog: false });
  const spr = new THREE.Sprite(mat);
  spr.position.set(worldX, worldY, 2.4);
  spr.scale.set(14, 14, 1);
  scene.add(spr);
  activePokes.push({ sprite: spr, t: 0 });
}
function updatePokes(dt) {
  for (let i = activePokes.length - 1; i >= 0; i--) {
    const poke = activePokes[i];
    poke.t += dt;
    const t = Math.min(1, poke.t / POKE_DURATION);
    const scale = lerp(14, 70, t);
    poke.sprite.scale.set(scale, scale, 1);
    poke.sprite.material.opacity = 1 - t;
    if (t >= 1) {
      scene.remove(poke.sprite);
      poke.sprite.material.dispose();
      activePokes.splice(i, 1);
    }
  }
}

// ---------- Комнатное состояние ----------
let interactiveMeshes = [];

function applyRoomState(roomKey) {
  currentRoom = roomKey;
  lobbyGroup.visible = roomKey === 'lobby';
  serverGroup.visible = roomKey === 'server';
  roomLabelEl.textContent = roomKey === 'lobby' ? 'Лобби' : 'Серверная';

  if (roomKey === 'lobby') {
    interactiveMeshes = hotspotProxies;
    scene.background.set('#171018');
    scene.fog.color.set('#171018');
    ambientLight.color.set('#fff2e0');
    ambientLight.intensity = 0.65;
    keyLight.color.set('#fff2da');
    keyLight.intensity = 1.0;

    setLobbyCameraFrustum();
    lobbyCamX = clamp(player.x, lobbyCamHalfW, LOBBY_W - lobbyCamHalfW);
    camera.position.set(lobbyCamX, lobbyCamCenterY, 900);
    camera.lookAt(lobbyCamX, lobbyCamCenterY, 0);

    floorDebugLine.visible = debugMode;
    hotspotDebugMeshes.forEach((m) => { m.visible = debugMode; });
  } else {
    interactiveMeshes = [fuseboxGroup, windowGroup, hatchBackGroup];
    const b = ROOM_BOUNDS.server;
    setServerCameraFrustum(b.w, b.d);
    scene.background.set('#05060a');
    scene.fog.color.set('#05060a');
    ambientLight.color.set('#1a2030');
    ambientLight.intensity = lerp(0.12, 0.5, powerProgress);
    keyLight.color.set('#4060a0');
    keyLight.intensity = lerp(0.15, 0.6, powerProgress);
  }
}

// ---------- Тап/клик: раскастинг по сцене ----------
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();

// Клик по дальнему хотспоту — только идём туда, взаимодействие НЕ срабатывает автоматически по приходу.
// Нужен ещё один клик по тому же предмету, когда персонаж уже рядом — так предмет превращается
// в осознанное действие, а не в случайное "дошёл и сработало".
const HOTSPOT_CLOSE_RADIUS_LOBBY = 90;
const HOTSPOT_CLOSE_RADIUS_SERVER = 36;
function approachOrInteract(standX, standZ, label, action, radius) {
  const dist = Math.hypot(player.x - standX, player.z - standZ);
  if (dist <= radius) {
    walkTarget = null;
    walkLabel = '';
    action();
  } else {
    walkTarget = { x: standX, z: standZ };
    walkLabel = label;
    pendingAction = null;
  }
}

function onPointerDown(evt) {
  if (uiBlocked()) return;
  evt.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const p = evt.touches ? evt.touches[0] : evt;
  pointerNDC.x = ((p.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((p.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);

  // Тап где угодно на экране — сначала пластилиновая "печать" в точке клика (чисто декоративно),
  // сама точка ещё пригодится ниже как X для ходьбы, если клик не попал в хотспот.
  const bgHit = currentRoom === 'lobby' ? raycaster.intersectObject(lobbyBgMesh)[0] : null;
  if (bgHit) spawnPoke(bgHit.point.x, bgHit.point.y);

  const hits = raycaster.intersectObjects(interactiveMeshes, true);
  if (hits.length) {
    let obj = hits[0].object;
    while (obj && !obj.userData.kind) obj = obj.parent;
    if (obj) {
      const kind = obj.userData.kind;
      if (kind === 'door') {
        const h = LOBBY_HOTSPOTS.door;
        approachOrInteract(h.standX, h.standY, h.label,
          () => { if (powered) finishLevel(); else openDoorHint(); }, HOTSPOT_CLOSE_RADIUS_LOBBY);
        return;
      }
      if (kind === 'archway') {
        const h = LOBBY_HOTSPOTS.archway;
        approachOrInteract(h.standX, h.standY, h.label,
          () => startTransition('server'), HOTSPOT_CLOSE_RADIUS_LOBBY);
        return;
      }
      if (kind === 'networkBoard') {
        const h = LOBBY_HOTSPOTS.networkBoard;
        approachOrInteract(h.standX, h.standY, h.label,
          () => openNetworkPanel(), HOTSPOT_CLOSE_RADIUS_LOBBY);
        return;
      }
      if (kind === 'terminal') {
        const h = LOBBY_HOTSPOTS.terminal;
        approachOrInteract(h.standX, h.standY, h.label,
          () => openTerminalPanel(), HOTSPOT_CLOSE_RADIUS_LOBBY);
        return;
      }
      if (kind === 'fusebox') {
        const sp = serverProps.fusebox;
        approachOrInteract(sp.x, sp.z + sp.d / 2 + 24, 'Щиток питания',
          () => openPuzzle(), HOTSPOT_CLOSE_RADIUS_SERVER);
        return;
      }
      if (kind === 'window') {
        const sp = serverProps.window;
        approachOrInteract(sp.x, sp.z + 26, 'Окно',
          () => openWindowView(), HOTSPOT_CLOSE_RADIUS_SERVER);
        return;
      }
      if (kind === 'hatchBack') {
        const sp = serverProps.hatchBack;
        approachOrInteract(sp.x, sp.z + sp.d / 2 + 20, 'Назад в лобби',
          () => startTransition('lobby'), HOTSPOT_CLOSE_RADIUS_SERVER);
        return;
      }
    }
  }

  if (currentRoom === 'lobby') {
    // Как в NeverHood: клик где угодно на экране (хоть в потолок) — берём только X
    // и идём туда по фиксированной линии пола. Никакого отказа/кламп-логики по Y.
    if (bgHit) {
      const imgX = clamp(bgHit.point.x, WALK_X_MIN, WALK_X_MAX);
      walkTarget = { x: imgX, z: WALK_LINE_Y };
      walkLabel = '';
      pendingAction = null;
      if (debugMode) {
        debugReadoutEl.textContent = `тап: x=${Math.round(bgHit.point.x)} → идём к (${Math.round(imgX)}, ${WALK_LINE_Y})`;
      }
    }
    return;
  }

  const floorHit = raycaster.intersectObject(serverFloor)[0];
  if (floorHit) {
    const b = ROOM_BOUNDS.server;
    walkTarget = { x: clamp(floorHit.point.x, 12, b.w - 12), z: clamp(floorHit.point.z, 12, b.d - 12) };
    walkLabel = '';
    pendingAction = null;
  }
}
canvas.addEventListener('pointerdown', onPointerDown);

// ---------- Синхронизация сцены с игровым состоянием ----------
const _cMix = new THREE.Color();
function mixColorInto(target, hexA, hexB, t) {
  target.set(hexA);
  _cMix.set(hexB);
  target.lerp(_cMix, t);
}

let walkBobPhase = 0;
let walkFrameTimer = 0;

function syncScene(dt) {
  updatePokes(dt);

  const isWalking = !!walkTarget;

  if (currentRoom === 'lobby') {
    const feetY = toWorldY(player.z);

    // лёгкий подпрыг поверх покадровых ног — усиливает ощущение шага, не конфликтует с ним
    if (isWalking) walkBobPhase += dt * 11; else walkBobPhase = 0;
    const bob = isWalking ? Math.abs(Math.sin(walkBobPhase)) * 4 : 0;

    playerSprite.position.set(player.x, feetY + bob, 2);
    const pw = isWalking ? PLAYER_WALK_W : PLAYER_LOBBY_W;
    const ph = isWalking ? PLAYER_WALK_H : PLAYER_LOBBY_H;
    playerSprite.scale.set(player.facing * pw, ph, 1);

    shadowSprite.visible = true;
    shadowSprite.position.set(player.x, feetY, 1.5); // чуть впереди фона, но позади персонажа
    const shadowSquash = 1 - bob / 45; // тень слегка сжимается, когда нога "в воздухе"
    shadowSprite.scale.set(95 * shadowSquash, 32 * shadowSquash, 1);

    const targetCamX = clamp(player.x, lobbyCamHalfW, LOBBY_W - lobbyCamHalfW);
    lobbyCamX = lerp(lobbyCamX, targetCamX, Math.min(1, dt * 5));
    camera.position.x = lobbyCamX;
    camera.lookAt(lobbyCamX, lobbyCamCenterY, 0);

    doorLampMesh.material.color.set(powered ? '#4fdc6a' : '#e0483f');
  } else {
    shadowSprite.visible = false;
    playerSprite.position.set(player.x, 0, player.z);
    const pw = isWalking ? PLAYER_VISUAL_WALK_W : PLAYER_VISUAL_W;
    const ph = isWalking ? PLAYER_VISUAL_WALK_H : PLAYER_VISUAL_H;
    playerSprite.scale.set(player.facing * pw, ph, 1);
  }

  const pose = currentPoseName();
  if (pose === 'walking') {
    walkFrameTimer += dt;
    const frameIdx = Math.floor(walkFrameTimer * WALK_FPS) % WALK_FRAME_COUNT;
    const tex = walkTextures[frameIdx];
    if (playerMaterial.map !== tex) playerMaterial.map = tex;
  } else {
    walkFrameTimer = 0;
    if (playerMaterial.map !== poseTextures[pose]) playerMaterial.map = poseTextures[pose];
  }

  if (currentRoom === 'server') {
    if (powered && powerProgress < 1) powerProgress = Math.min(1, powerProgress + dt / 0.8);
    const pulse = powerProgress > 0.99 ? 0.88 + 0.12 * Math.sin(performance.now() / 260) : 1;
    ambientLight.intensity = lerp(0.12, 0.5, powerProgress) * pulse;
    keyLight.intensity = lerp(0.15, 0.6, powerProgress) * pulse;
    glowStripMeshes.forEach((m) => mixColorInto(m.material.color, '#141820', '#5be9ff', powerProgress * pulse));
    if (fuseboxIndicator) {
      mixColorInto(fuseboxIndicator.material.color, '#3a1414', '#3fe06a', powerProgress);
      mixColorInto(fuseboxIndicator.material.emissive, '#3a0f0f', '#1f8a3f', powerProgress);
    }
  }
}

// ---------- Игровой цикл ----------
applyRoomState('lobby');
let lastTime = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  update(dt);
  syncScene(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
