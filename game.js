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
const wireBoardEl = document.getElementById('wireBoard');
const wireSourcesEl = document.getElementById('wireSources');
const wireSvgEl = document.getElementById('wireSvg');
const puzzleSocketsEl = document.getElementById('puzzleSockets');
const wirePlugsEl = document.getElementById('wirePlugs');
const puzzleMsgEl = document.getElementById('puzzleMsg');
const puzzleCloseBtn = document.getElementById('puzzleCloseBtn');

const networkPanelEl = document.getElementById('panelNetwork');
const networkHintRowEl = document.getElementById('networkHintRow');
const networkCloseBtn = document.getElementById('networkCloseBtn');

const terminalPanelEl = document.getElementById('panelTerminal');
const terminalScreenEl = document.getElementById('terminalScreen');
const terminalTextEl = document.getElementById('terminalText');
const terminalInputEl = document.getElementById('terminalInput');
const terminalCloseBtn = document.getElementById('terminalCloseBtn');
const alarmOverlayEl = document.getElementById('alarmOverlay');

const debugToggleBtn = document.getElementById('debugToggleBtn');
const debugReadoutEl = document.getElementById('debugReadout');

const inventoryEl = document.getElementById('inventory');
const clayItemBtn = document.getElementById('clayItemBtn');

function toTexture(canvasEl, repeatX, repeatY) {
  const tex = new THREE.CanvasTexture(canvasEl);
  if (repeatX !== undefined) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
  }
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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
const targetOrder = shuffleArray(COLOR_KEYS);

// ---------- Лобби (реальный фон-арт) ----------
// Разрывы и прямоугольники ниже — оценка на глаз по картинке 3576x1184.
// Включи debug-кнопку (🐞) в игре, чтобы увидеть контуры хотспотов/линии ходьбы и подогнать координаты по месту.
const LOBBY_W = 3576, LOBBY_H = 1184;

// Как в NeverHood: персонаж всегда стоит на одной фиксированной линии пола и ходит только влево/вправо.
// Тап в ЛЮБОМ месте экрана берёт только X — игрок разворачивается и идёт туда по этой линии.
const WALK_LINE_Y = 1080;
const WALK_X_MIN = 90, WALK_X_MAX = 3500;

const LOBBY_HOTSPOTS = {
  networkBoard: { kind: 'networkBoard', rect: [60, 270, 650, 790], standX: 360, standY: WALK_LINE_Y, label: 'Network Status Screen' },
  door: { kind: 'door', rect: [1450, 300, 1850, 1030], standX: 1650, standY: WALK_LINE_Y, label: 'Door' },
  cactus: { kind: 'cactus', rect: [2010, 700, 2200, 1030], standX: 2105, standY: WALK_LINE_Y, label: 'Cactus' },
  archway: { kind: 'archway', rect: [2200, 300, 2620, 1030], standX: 2410, standY: WALK_LINE_Y, label: 'Service Tunnel' },
  terminal: { kind: 'terminal', rect: [2990, 630, 3280, 1045], standX: 3135, standY: WALK_LINE_Y, label: 'Terminal' },
};

// ---------- Серверная (тот же формат фона 3576x1184, что и в лобби) ----------
// Тот же принцип: фикс. линия пола, тап где угодно — идём по X, камера едет за игроком.
const SERVER_HOTSPOTS = {
  networkBoard: { kind: 'networkBoard', rect: [70, 285, 645, 780], standX: 358, standY: WALK_LINE_Y, label: 'Network Status Screen' },
  fusebox: { kind: 'fusebox', rect: [1450, 155, 1915, 1040], standX: 1683, standY: WALK_LINE_Y, label: 'Fusebox' },
  hatchBack: { kind: 'hatchBack', rect: [2325, 605, 2595, 1040], standX: 2460, standY: WALK_LINE_Y, label: 'Back to Lobby' },
  terminal: { kind: 'terminal', rect: [3040, 650, 3450, 935], standX: 3245, standY: WALK_LINE_Y, label: 'Terminal' },
};

let currentRoom = 'lobby';
let powered = false;

// ---------- Игрок ----------
// в лобби player.z хранит "глубину" в пиксельных координатах фона (по нему же считаем масштаб)
const player = { x: 900, z: 1080, facing: 1 };
let walkTarget = null;
let pendingAction = null;
let walkLabel = '';

let dialogueOpen = false;
let puzzleOpen = false;
let networkOpen = false;
let terminalOpen = false;
let debugMode = false;
const transitionState = { active: false, phase: null, t: 0, targetRoom: null };
const FADE_T = 0.25;

// ---------- Комок глины: подобрать за кактусом -> прицелиться -> кинуть в стену ----------
let clayTaken = false;  // уже нашли (кактус больше не даёт второй кусок)
let hasClay = false;    // сейчас при себе — можно прицелиться и бросить
let aimMode = false;    // режим прицеливания активен (переключается иконкой в HUD)
let aimDragging = false;   // сейчас реально тянем прицел по экрану
let aimTarget = null;      // {x,y} в мировых координатах — текущая точка прицеливания
let clayThrow = null;      // {fromX,fromY,toX,toY,t,duration} — летящий комок

function uiBlocked() {
  return dialogueOpen || puzzleOpen || networkOpen || terminalOpen || transitionState.active || aimMode;
}

// ---------- Диалог у двери ----------
function openDoorHint() {
  dialogueOpen = true;
  dialogueEl.classList.remove('hidden');
  dialogueTextEl.textContent = 'Access Denied. Power system is offline!';
  dialogueChoicesEl.innerHTML = '';
  const btn = document.createElement('button');
  btn.className = 'choiceBtn';
  btn.textContent = 'Got it';
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
  dialogueTextEl.textContent = 'Level complete!\nPower restored, the door is open.';
  dialogueChoicesEl.innerHTML = '';
  const btn = document.createElement('button');
  btn.className = 'choiceBtn';
  btn.textContent = 'Restart';
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

// ---------- Терминал: настоящая командная строка с парой классических приколов ----------
const TERMINAL_LINES = [
  '> BOOT SEQUENCE...',
  '> MAIN GRID: OFFLINE',
  '> BACKUP GRID: OFFLINE',
  '> LAST EVENT: PHASE SYNC FAILURE',
  '> ACTION REQUIRED: restore fusebox',
  '   phase order — see SERVICE PANEL, server room',
  '> STATUS: awaiting technician...',
];

let terminalLog = []; // уже полностью "напечатанные" строки — постоянная история
let terminalTyping = false;
let typingQueue = [];       // строки, которые ещё предстоит допечатать
let typingCurrentLine = ''; // то, что уже видно из текущей печатающейся строки
let typingTimer = null;

// Печатаем по символу, как настоящий CMD/терминал — вместо мгновенного появления текста целиком.
const TYPE_MS_PER_CHAR = 9;
const TYPE_MS_JITTER = 10;
const TYPE_LINE_PAUSE_MS = 70;

function renderTerminalScreen() {
  const shown = terminalTyping ? terminalLog.concat(typingCurrentLine) : terminalLog;
  terminalTextEl.textContent = shown.join('\n');
  terminalScreenEl.scrollTop = terminalScreenEl.scrollHeight;
}

// Печатает переданные строки по одному символу; уже отображённые строки (terminalLog) не трогает.
function startTyping(lines, onDone) {
  clearTimeout(typingTimer);
  typingQueue = lines.slice();
  typingCurrentLine = '';
  terminalTyping = true;

  const step = () => {
    if (!typingQueue.length) {
      terminalTyping = false;
      renderTerminalScreen();
      if (onDone) onDone();
      return;
    }
    const line = typingQueue[0];
    if (typingCurrentLine.length < line.length) {
      typingCurrentLine = line.slice(0, typingCurrentLine.length + 1);
      renderTerminalScreen();
      typingTimer = setTimeout(step, TYPE_MS_PER_CHAR + Math.random() * TYPE_MS_JITTER);
    } else {
      terminalLog.push(line);
      typingQueue.shift();
      typingCurrentLine = '';
      renderTerminalScreen();
      typingTimer = setTimeout(step, TYPE_LINE_PAUSE_MS);
    }
  };
  step();
}

// Enter во время печати не отправляет новую команду, а мгновенно "доливает" оставшийся текст —
// как в диалогах многих игр, чтобы не заставлять нетерпеливого игрока ждать анимацию.
function skipTyping() {
  clearTimeout(typingTimer);
  terminalLog.push(...typingQueue);
  typingQueue = [];
  typingCurrentLine = '';
  terminalTyping = false;
  renderTerminalScreen();
}

// Кратковременное затемнение света в текущей комнате — "случайный" побочный эффект reboot'а.
function triggerBlackout() {
  if (transitionState.active) return; // не мешаем переходу между комнатами
  fadeEl.classList.add('on');
  ambientLight.intensity = 0;
  keyLight.intensity = 0;
  // Держим экран чёрным подольше (5с) — специально дольше обычного перехода между комнатами,
  // чтобы на мгновение реально казалось, будто устройство пользователя само перезагрузилось.
  setTimeout(() => {
    ambientLight.intensity = 0.65;
    keyLight.intensity = 1.0;
    fadeEl.classList.remove('on');
  }, 5000);
}

// Синтезируем вой сирены на лету (Web Audio) — звуковых файлов в проекте нет и не нужно.
let alarmAudioCtx = null;
function playSirenBeep() {
  try {
    alarmAudioCtx = alarmAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = alarmAudioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    const dur = 2.6;
    gain.gain.setValueAtTime(0.05, now);
    for (let t = 0; t < dur; t += 0.6) {
      osc.frequency.setValueAtTime(520, now + t);
      osc.frequency.linearRampToValueAtTime(920, now + t + 0.3);
      osc.frequency.linearRampToValueAtTime(520, now + t + 0.6);
    }
    gain.gain.setValueAtTime(0.05, now + dur - 0.15);
    gain.gain.linearRampToValueAtTime(0, now + dur);
    osc.start(now);
    osc.stop(now + dur);
  } catch (err) { /* автоплей заблокирован браузером или Web Audio недоступен — не критично */ }
}

let alarmTimeout = null;
function triggerFireAlarm() {
  alarmOverlayEl.classList.remove('hidden');
  playSirenBeep();
  clearTimeout(alarmTimeout);
  alarmTimeout = setTimeout(() => alarmOverlayEl.classList.add('hidden'), 4000);
}

// Каждая команда возвращает массив строк для вывода (обычный текст, без HTML — печатается посимвольно).
const TERMINAL_COMMANDS = {
  help: () => [
    'available commands:',
    '  help — this list',
    '  ls — list files',
    '  whoami — who am I',
    '  status — repeat network diagnostics',
    '  ping <host> — check if anyone is out there',
    '  sudo <anything> — try it if you dare',
    '  reboot — restart the network',
  ],
  ls: () => ['fusebox.log', 'network_map.png', 'passwords.txt.locked', 'do_not_open.exe'],
  whoami: () => ['penguin_intern (uid=1000, root=false)'],
  status: () => TERMINAL_LINES.slice(),
  sudo: () => ['Permission denied: penguins are not in the sudoers file.', 'This incident will be reported.'],
  ping: (args) => {
    const target = args[0] || 'the-mothership';
    return [
      `PING ${target} (127.0.0.1): 56 data bytes`,
      `64 bytes from ${target}: icmp_seq=0 ttl=64 time=0.02 ms`,
      `64 bytes from ${target}: icmp_seq=1 ttl=64 time=4200.00 ms`,
      `64 bytes from ${target}: icmp_seq=2 ttl=1 time=∞ ms (please consult your local cosmos administrator)`,
      `64 bytes from ${target}: icmp_seq=3 ttl=0 time=NaN ms`,
      '',
      `--- ${target} ping statistics ---`,
      '4 packets transmitted, 1 packets received, 75% packet loss',
      'round-trip min/avg/max = 0.02/existential dread/∞ ms',
    ];
  },
  reboot: () => {
    setTimeout(triggerBlackout, 400);
    return ['Rebooting main grid...', '...', '[WARN] brownout detected on line 3'];
  },
};
const FIRE_ALARM_ALIASES = ['alarm', 'fire', 'firealarm'];

function runTerminalCommand(raw) {
  const cmd = raw.trim();
  // Собственный ввод игрока показываем сразу (он его и так уже "напечатал" в поле) —
  // печатаем по символам только ОТВЕТ, как будто это "компьютер" набирает его в реальном времени.
  terminalLog.push('> ' + cmd);
  renderTerminalScreen();
  if (!cmd) return;

  const parts = cmd.split(/\s+/);
  const key = parts[0].toLowerCase();
  const args = parts.slice(1);

  let output;
  if (FIRE_ALARM_ALIASES.includes(key)) {
    triggerFireAlarm();
    output = ['!!! FIRE ALARM ACTIVATED !!!', '(just a prank. probably.)'];
  } else if (TERMINAL_COMMANDS[key]) {
    output = TERMINAL_COMMANDS[key](args);
  } else {
    output = [`bash: ${key}: command not found`];
  }
  startTyping(output);
}

terminalInputEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (terminalTyping) { skipTyping(); return; }
  if (!terminalInputEl.value.trim()) return;
  runTerminalCommand(terminalInputEl.value);
  terminalInputEl.value = '';
});

function openTerminalPanel() {
  terminalOpen = true;
  terminalLog = [];
  terminalInputEl.value = '';
  terminalPanelEl.classList.remove('hidden');
  startTyping(TERMINAL_LINES.slice());
  requestAnimationFrame(() => terminalInputEl.focus());
}
function closeTerminalPanel() {
  terminalOpen = false;
  terminalPanelEl.classList.add('hidden');
}
terminalCloseBtn.onclick = closeTerminalPanel;

// ---------- Головоломка щитка: свободно подключаемые кабели ----------
// plugSlot[цвет] = индекс гнезда (0..3), куда воткнут кабель этого цвета, или null, если висит свободно.
// Втыкать можно в любое гнездо в любом порядке — ничего не блокируется и не подсвечивается
// как "неверно"; решённость проверяется только когда воткнуты все 4 и порядок совпал с targetOrder.
const plugSlot = { green: null, gray: null, blue: null, orange: null };
let draggingWireColor = null;

function renderHintRow() {
  puzzleHintRowEl.innerHTML = targetOrder.map((k) => `<span class="dot" style="background:${COLOR_HEX[k]}"></span>`).join('');
}

function studEl(colorKey) { return wireSourcesEl.children[COLOR_KEYS.indexOf(colorKey)]; }
function socketElAt(i) { return puzzleSocketsEl.children[i]; }
function wirePlugEl(colorKey) { return wirePlugsEl.querySelector(`[data-color="${colorKey}"]`); }

// Точка на "доске" (относительно wireBoardEl) — либо низ источника (откуда растёт кабель),
// либо центр элемента (гнездо/плаг).
function boardPoint(el, anchorBottom) {
  const r = el.getBoundingClientRect();
  const br = wireBoardEl.getBoundingClientRect();
  const x = r.left + r.width / 2 - br.left;
  const y = anchorBottom ? r.bottom - br.top : r.top + r.height / 2 - br.top;
  return { x, y };
}

// Где должен "лежать" плаг, когда его не тащат: в гнезде, если воткнут, иначе — свободно
// свисает чуть ниже своего источника.
function dockPoint(colorKey) {
  const slot = plugSlot[colorKey];
  if (slot !== null) return boardPoint(socketElAt(slot), false);
  const anchor = boardPoint(studEl(colorKey), true);
  return { x: anchor.x, y: anchor.y + 20 };
}

function layoutWirePlugs() {
  COLOR_KEYS.forEach((colorKey) => {
    if (colorKey === draggingWireColor) return; // позицию ведёт указатель
    const p = dockPoint(colorKey);
    const plug = wirePlugEl(colorKey);
    plug.style.left = p.x + 'px';
    plug.style.top = p.y + 'px';
  });
}

function drawWires() {
  const br = wireBoardEl.getBoundingClientRect();
  COLOR_KEYS.forEach((colorKey) => {
    const start = boardPoint(studEl(colorKey), true);
    const plug = wirePlugEl(colorKey);
    const pr = plug.getBoundingClientRect();
    const end = { x: pr.left + pr.width / 2 - br.left, y: pr.top + pr.height / 2 - br.top };
    const sag = Math.max(10, Math.hypot(end.x - start.x, end.y - start.y) * 0.22);
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 + sag };
    wireSvgEl.querySelector(`path[data-color="${colorKey}"]`)
      .setAttribute('d', `M ${start.x} ${start.y} Q ${mid.x} ${mid.y} ${end.x} ${end.y}`);
  });
}

function attachWirePlugDrag(plugEl, colorKey) {
  plugEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    // Координаты считаем ДО добавления .dragging: этот класс переключает position
    // absolute -> fixed, то есть меняет систему отсчёта у left/top (было "относительно
    // #wireBoard", стало "относительно вьюпорта"). Если сначала переключить класс,
    // а потом читать getBoundingClientRect(), элемент успевает визуально "прыгнуть"
    // в угол экрана — те же пиксельные left/top вдруг означают другую точку.
    const r = plugEl.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const offsetX = e.clientX - cx, offsetY = e.clientY - cy;

    draggingWireColor = colorKey;
    plugEl.classList.add('dragging');
    plugEl.style.left = cx + 'px';
    plugEl.style.top = cy + 'px';
    plugEl.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      plugEl.style.left = (ev.clientX - offsetX) + 'px';
      plugEl.style.top = (ev.clientY - offsetY) + 'px';
      drawWires();
    };
    // pointerup — нормальное завершение драга; pointercancel — браузер прервал жест
    // (например, потерял палец/курсор). Без обработки cancel штекер навсегда застревал
    // в режиме "dragging" и перехватывал клики поверх остальных — из-за этого следующие
    // кабели переставали ловиться.
    const finish = (ev) => {
      plugEl.removeEventListener('pointermove', onMove);
      plugEl.removeEventListener('pointerup', onUp);
      plugEl.removeEventListener('pointercancel', onCancel);
      try { plugEl.releasePointerCapture(e.pointerId); } catch (err) { /* уже отпущен браузером — не страшно */ }
      plugEl.classList.remove('dragging');
      draggingWireColor = null;

      let dropIdx = null;
      if (ev) {
        for (let i = 0; i < 4; i++) {
          const sr = socketElAt(i).getBoundingClientRect();
          if (ev.clientX >= sr.left && ev.clientX <= sr.right && ev.clientY >= sr.top && ev.clientY <= sr.bottom) { dropIdx = i; break; }
        }
      }
      if (dropIdx !== null) {
        // если в этом гнезде уже что-то есть — выталкиваем прежний кабель обратно на свободный конец
        const occupant = COLOR_KEYS.find((c) => plugSlot[c] === dropIdx);
        if (occupant && occupant !== colorKey) plugSlot[occupant] = null;
        plugSlot[colorKey] = dropIdx;
      } else {
        plugSlot[colorKey] = null; // бросили мимо (или жест отменился) — кабель просто отцепился
      }
      layoutWirePlugs();
      drawWires();
      checkPuzzleSolved();
    };
    const onUp = (ev) => finish(ev);
    const onCancel = () => finish(null);
    plugEl.addEventListener('pointermove', onMove);
    plugEl.addEventListener('pointerup', onUp);
    plugEl.addEventListener('pointercancel', onCancel);
  });
}

function buildWireBoard() {
  wireSourcesEl.innerHTML = COLOR_KEYS.map((c) => `<div class="wireStud" style="background:${COLOR_HEX[c]}"></div>`).join('');
  puzzleSocketsEl.innerHTML = '<div class="socket"></div>'.repeat(4);
  wireSvgEl.innerHTML = COLOR_KEYS.map((c) =>
    `<path data-color="${c}" fill="none" stroke="${COLOR_HEX[c]}" stroke-width="6" stroke-linecap="round"></path>`
  ).join('');
  wirePlugsEl.innerHTML = '';
  COLOR_KEYS.forEach((colorKey) => {
    const plug = document.createElement('div');
    plug.className = 'wirePlug';
    plug.dataset.color = colorKey;
    plug.style.background = COLOR_HEX[colorKey];
    attachWirePlugDrag(plug, colorKey);
    wirePlugsEl.appendChild(plug);
  });
}

window.addEventListener('resize', () => { if (puzzleOpen) { layoutWirePlugs(); drawWires(); } });

function checkPuzzleSolved() {
  const allPlugged = COLOR_KEYS.every((c) => plugSlot[c] !== null);
  const solved = allPlugged && targetOrder.every((c, i) => plugSlot[c] === i);
  if (solved) {
    puzzleMsgEl.textContent = 'Contact!';
    setTimeout(() => { closePuzzle(); onPowerRestored(); }, 700);
  } else {
    puzzleMsgEl.textContent = '';
  }
}

function openPuzzle() {
  puzzleOpen = true;
  puzzleMsgEl.textContent = '';
  renderHintRow();
  buildWireBoard();
  puzzlePanelEl.classList.remove('hidden');
  requestAnimationFrame(() => { layoutWirePlugs(); drawWires(); });
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
  showStatusMessage('Power is on!', 2.5);
}

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
    player.x = SERVER_HOTSPOTS.hatchBack.standX; player.z = SERVER_HOTSPOTS.hatchBack.standY; player.facing = -1;
  } else {
    player.x = LOBBY_HOTSPOTS.archway.standX; player.z = LOBBY_HOTSPOTS.archway.standY; player.facing = -1;
  }
  applyRoomState(targetRoom);
}

// ---------- Обновление ----------
const MOVE_SPEED = 850;

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

  updateClayThrow(dt);

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
      const step = Math.min(d, MOVE_SPEED * dt);
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

// Ортографическая камера — без перспективных искажений. Обе комнаты — плоский фон-арт
// одного формата (3576x1184), камера смотрит прямо на него и едет по X вслед за игроком.
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);

// Кадр = вся высота фона (ceiling-to-floor, без обрезки и без "cover"-зума).
// Ширина кадра — производная от соотношения сторон экрана; так как фон широкоформатный (3:1),
// ширина кадра выходит меньше LOBBY_W, и камера едет по X вслед за игроком (см. syncScene).
// Общая для обеих комнат — их фон одного размера, поэтому и рамка одна и та же.
let roomCamHalfW = 0;
let roomCamCenterY = LOBBY_H / 2;
let roomCamX = LOBBY_W / 2;
function setFlatRoomCameraFrustum() {
  const FRUSTUM_H = LOBBY_H;
  const FRUSTUM_W = FRUSTUM_H * ASPECT;
  camera.left = -FRUSTUM_W / 2; camera.right = FRUSTUM_W / 2;
  camera.top = FRUSTUM_H / 2; camera.bottom = -FRUSTUM_H / 2;
  camera.updateProjectionMatrix();
  roomCamHalfW = FRUSTUM_W / 2;
  roomCamCenterY = LOBBY_H / 2;
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

// Фон лобби держим не как статичную картинку, а как canvas с этой картинкой внутри —
// так в него можно потом реально "рисовать" (клякса от комка глины навсегда впечатывается
// в стену вместо того, чтобы лежать отдельным спрайтом поверх).
const lobbyBgCanvas = document.createElement('canvas');
lobbyBgCanvas.width = LOBBY_W;
lobbyBgCanvas.height = LOBBY_H;
const lobbyBgCtx = lobbyBgCanvas.getContext('2d');
const lobbyBgTex = new THREE.CanvasTexture(lobbyBgCanvas);
lobbyBgTex.colorSpace = THREE.SRGBColorSpace;
const lobbyBgImg = new Image();
lobbyBgImg.onload = () => {
  lobbyBgCtx.drawImage(lobbyBgImg, 0, 0, LOBBY_W, LOBBY_H);
  lobbyBgTex.needsUpdate = true;
};
lobbyBgImg.src = 'assets/source/office_lobby_bg_level_1_mvp.png';

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

// Хотспоты: невидимый прямоугольник для рейкаста клика + цветной контур для debug-режима.
// Общая функция — используется и для лобби, и для серверной (обе устроены одинаково).
function buildHotspots(group, hotspots) {
  const proxies = [];
  const debugMeshes = [];
  Object.values(hotspots).forEach((h) => {
    const [x0, y0, x1, y1] = h.rect;
    const w = x1 - x0, ht = y1 - y0;
    const cx = (x0 + x1) / 2, cyImg = (y0 + y1) / 2;

    const proxy = new THREE.Mesh(new THREE.PlaneGeometry(w, ht), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }));
    proxy.position.set(cx, toWorldY(cyImg), 2);
    proxy.userData.kind = h.kind;
    group.add(proxy);
    proxies.push(proxy);

    const outline = makeRectOutline(x0, y0, x1, y1, 3, '#36e0ff');
    group.add(outline);
    debugMeshes.push(outline);
  });
  return { proxies, debugMeshes };
}

function buildFloorDebugLine(group) {
  const y = toWorldY(WALK_LINE_Y);
  const pts = [new THREE.Vector3(WALK_X_MIN, y, 3), new THREE.Vector3(WALK_X_MAX, y, 3)];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#ff36c9', fog: false }));
  line.visible = false;
  group.add(line);
  return line;
}

const { proxies: hotspotProxies, debugMeshes: hotspotDebugMeshes } = buildHotspots(lobbyGroup, LOBBY_HOTSPOTS);
const floorDebugLine = buildFloorDebugLine(lobbyGroup);

// индикатор питания у двери (красный/зелёный, поверх фона)
const doorLampMesh = new THREE.Mesh(new THREE.CircleGeometry(16, 16), new THREE.MeshBasicMaterial({ color: '#e0483f', fog: false }));
{
  const d = LOBBY_HOTSPOTS.door.rect;
  doorLampMesh.position.set(d[2] + 25, toWorldY(d[1] + 30), 2);
}
lobbyGroup.add(doorLampMesh);

// ---------- Серверная: реальный фон-арт + хотспоты (устроена так же, как лобби) ----------
const serverGroup = new THREE.Group();
serverGroup.visible = false;
scene.add(serverGroup);

const serverBgTex = lobbyTexLoader.load('assets/source/level_1_server_room_v1_25082026.png');
serverBgTex.colorSpace = THREE.SRGBColorSpace;
const serverBgMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(LOBBY_W, LOBBY_H),
  new THREE.MeshBasicMaterial({ map: serverBgTex, fog: false })
);
serverBgMesh.position.set(LOBBY_W / 2, LOBBY_H / 2, 0);
serverGroup.add(serverBgMesh);

const { proxies: serverHotspotProxies, debugMeshes: serverHotspotDebugMeshes } = buildHotspots(serverGroup, SERVER_HOTSPOTS);
const serverFloorDebugLine = buildFloorDebugLine(serverGroup);

// debug-контуры лежат внутри lobbyGroup/serverGroup — видимость родительской группы
// (переключается в applyRoomState) сама скрывает контуры неактивной комнаты.
function setDebugMode(on) {
  debugMode = on;
  debugToggleBtn.classList.toggle('active', on);
  debugReadoutEl.classList.toggle('hidden', !on);
  floorDebugLine.visible = on;
  hotspotDebugMeshes.forEach((m) => { m.visible = on; });
  serverFloorDebugLine.visible = on;
  serverHotspotDebugMeshes.forEach((m) => { m.visible = on; });
  if (!on) debugReadoutEl.textContent = '';
}
debugToggleBtn.onclick = () => setDebugMode(!debugMode);
setDebugMode(true); // включено по умолчанию, чтобы сразу видеть границы пола/хотспотов

// ---------- Игрок: спрайт из настоящих пластилиновых стикеров ----------
const POSES = ['whatdahell', 'hi', 'allgood', 'waaat', 'whatdaheck', 'ClayPin_Main_View'];
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

// Обе комнаты — один и тот же формат фона (3576x1184), поэтому персонаж везде одного масштаба.
const PLAYER_LOBBY_W = 384, PLAYER_LOBBY_H = 451; // x1.6 — крупнее относительно текстур окружения
// кадры ходьбы шире в плечах (расставленные ноги/руки) — держим ту же высоту, что и у стоячей позы, ширину считаем по их родной пропорции
const PLAYER_WALK_H = PLAYER_LOBBY_H;
const PLAYER_WALK_W = PLAYER_WALK_H * WALK_FRAME_ASPECT;
const playerMaterial = new THREE.SpriteMaterial({ map: poseTextures.ClayPin_Main_View, transparent: true, fog: false });
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
  return 'ClayPin_Main_View';
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

// ---------- Комок глины: спрайт-снаряд, прицел-пунктир, клякса, которая впечатывается в стену ----------
function makeClayTexture() {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 96;
  const cctx = c.getContext('2d');
  const g = cctx.createRadialGradient(36, 33, 6, 48, 48, 48);
  g.addColorStop(0, '#b48a63');
  g.addColorStop(0.65, '#8a6a4a');
  g.addColorStop(1, '#4a3626');
  cctx.fillStyle = g;
  cctx.beginPath();
  cctx.arc(48, 48, 42, 0, Math.PI * 2);
  cctx.fill();
  return c;
}
const clayTex = toTexture(makeClayTexture());
const clayProjectileMaterial = new THREE.SpriteMaterial({ map: clayTex, transparent: true, fog: false });
const claySprite = new THREE.Sprite(clayProjectileMaterial);
claySprite.scale.set(90, 90, 1); // x3 — исходный размер было не разглядеть
claySprite.visible = false;
lobbyGroup.add(claySprite);

function makeAimDotTexture() {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const dctx = c.getContext('2d');
  const g = dctx.createRadialGradient(8, 8, 0, 8, 8, 8);
  g.addColorStop(0, 'rgba(255,240,200,0.95)');
  g.addColorStop(1, 'rgba(255,240,200,0)');
  dctx.fillStyle = g;
  dctx.fillRect(0, 0, 16, 16);
  return c;
}
const aimDotTex = toTexture(makeAimDotTexture());
const AIM_DOT_COUNT = 16;
const aimDots = [];
for (let i = 0; i < AIM_DOT_COUNT; i++) {
  const mat = new THREE.SpriteMaterial({ map: aimDotTex, transparent: true, fog: false, depthWrite: false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(9, 9, 1);
  spr.visible = false;
  lobbyGroup.add(spr);
  aimDots.push(spr);
}

// Рука, из которой "вылетает" бросок — примерно на уровне груди персонажа.
function clayHandPosition() {
  return { x: player.x, y: toWorldY(player.z) + PLAYER_LOBBY_H * 0.55 };
}

// Простая, всегда предсказуемая дуга броска: обычная линейная интерполяция от старта к цели
// плюс "горб" по синусоиде — не настоящая баллистика, но выглядит один в один как параболический
// бросок, и, в отличие от настоящей физики, гарантированно всегда долетает точно до цели.
function clayArcHeight(fromX, fromY, toX, toY) {
  return 70 + Math.abs(toX - fromX) * 0.22 + Math.abs(toY - fromY) * 0.15;
}
function clayArcPoint(fromX, fromY, toX, toY, t) {
  const h = clayArcHeight(fromX, fromY, toX, toY);
  return { x: lerp(fromX, toX, t), y: lerp(fromY, toY, t) + h * 4 * t * (1 - t) };
}

function updateAimPreview() {
  if (!aimTarget) { aimDots.forEach((d) => { d.visible = false; }); return; }
  const from = clayHandPosition();
  for (let i = 0; i < AIM_DOT_COUNT; i++) {
    const t = (i + 1) / (AIM_DOT_COUNT + 1);
    const p = clayArcPoint(from.x, from.y, aimTarget.x, aimTarget.y, t);
    const dot = aimDots[i];
    dot.position.set(p.x, p.y, 2.6);
    dot.material.opacity = 0.9 - t * 0.35;
    dot.visible = true;
  }
}
function hideAimPreview() {
  aimTarget = null;
  aimDots.forEach((d) => { d.visible = false; });
}

// Клякса впечатывается прямо в canvas-текстуру стены — не отдельный спрайт поверх, а настоящая
// "деформация" фона: переживает скролл камеры, смену комнат и т.д.
function paintClaySplat(worldX, worldY) {
  const imgX = worldX;
  const imgY = LOBBY_H - worldY; // обратное преобразование к toWorldY
  const ctx = lobbyBgCtx;
  ctx.save();
  ctx.translate(imgX, imgY);
  ctx.fillStyle = '#7a5a3c';
  ctx.beginPath();
  const blobs = 5 + Math.floor(Math.random() * 3);
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + Math.random() * 0.6;
    const r = 39 + Math.random() * 27; // x3 — под увеличенный комок
    const dx = Math.cos(a) * 21, dy = Math.sin(a) * 21;
    ctx.moveTo(dx + r, dy);
    ctx.arc(dx, dy, r, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath();
  ctx.arc(-18, -18, 27, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  lobbyBgTex.needsUpdate = true;
  startClayDrip(imgX, imgY);
}

// Через несколько секунд после удара клякса медленно "стекает" вниз по стене — тонкая
// потёкшая полоска, которая постепенно удлиняется. Тоже рисуется прямо в текстуру.
function startClayDrip(imgX, imgY) {
  const dripX = imgX + (Math.random() * 48 - 24);
  const maxDrip = 108 + Math.random() * 132; // x3 — под увеличенный комок
  const totalTicks = 16;
  const stepLen = maxDrip / totalTicks;
  let tick = 0;
  let dripLen = 54; // стартуем чуть ниже самой кляксы
  const iv = setInterval(() => {
    tick++;
    const w = Math.max(4.5, 15 - tick * 0.75);
    lobbyBgCtx.save();
    lobbyBgCtx.fillStyle = 'rgba(90,66,44,0.5)';
    lobbyBgCtx.fillRect(dripX - w / 2, imgY + dripLen, w, stepLen + 2);
    lobbyBgCtx.restore();
    dripLen += stepLen;
    lobbyBgTex.needsUpdate = true;
    if (tick >= totalTicks) clearInterval(iv);
  }, 240);
}

function throwClay(targetX, targetY) {
  const from = clayHandPosition();
  const dist = Math.hypot(targetX - from.x, targetY - from.y);
  clayThrow = {
    fromX: from.x, fromY: from.y, toX: targetX, toY: targetY,
    t: 0, duration: clamp(dist / 1400, 0.35, 1.0),
  };
  claySprite.visible = true;
}

function updateClayThrow(dt) {
  if (!clayThrow) return;
  clayThrow.t += dt / clayThrow.duration;
  const t = Math.min(1, clayThrow.t);
  const p = clayArcPoint(clayThrow.fromX, clayThrow.fromY, clayThrow.toX, clayThrow.toY, t);
  claySprite.position.set(p.x, p.y, 2.6);
  claySprite.rotation.z += dt * 9; // кувыркается в полёте
  if (t >= 1) {
    claySprite.visible = false;
    paintClaySplat(clayThrow.toX, clayThrow.toY);
    hasClay = false;
    clayThrow = null;
    updateInventoryUI();
  }
}

function updateInventoryUI() {
  inventoryEl.classList.toggle('hidden', !hasClay);
  clayItemBtn.classList.toggle('active', aimMode);
}

function setAimMode(on) {
  aimMode = on;
  updateInventoryUI();
  if (on) {
    hintEl.textContent = 'Drag to aim, release to throw — tap the clay icon again to cancel.';
  } else {
    hideAimPreview();
    hintEl.textContent = walkLabel;
  }
}

clayItemBtn.onclick = () => {
  if (!hasClay) return;
  if (currentRoom !== 'lobby') {
    showStatusMessage("Nothing to throw it at here.", 1.5);
    return;
  }
  setAimMode(!aimMode);
};

function interactCactus() {
  if (clayTaken) {
    showStatusMessage("Just a cactus. Ouch.", 1.5);
    return;
  }
  clayTaken = true;
  hasClay = true;
  showStatusMessage("Found a lump of clay behind the cactus!", 2.5);
  updateInventoryUI();
}

// Отдельная ветка обработки тапа/драга, пока активен режим прицеливания — вместо обычной
// ходьбы/хотспотов тянем прицел и по отпусканию бросаем комок туда, куда указали.
function updateAimTargetFromEvent(evt) {
  const rect = canvas.getBoundingClientRect();
  const p = evt.touches ? evt.touches[0] : evt;
  pointerNDC.x = ((p.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((p.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  const hit = raycaster.intersectObject(lobbyBgMesh)[0];
  if (!hit) return;
  aimTarget = {
    x: clamp(hit.point.x, WALK_X_MIN, WALK_X_MAX),
    y: clamp(hit.point.y, 150, 1000),
  };
  updateAimPreview();
}

function handleAimPointerDown(evt) {
  evt.preventDefault();
  aimDragging = true;
  updateAimTargetFromEvent(evt);
  try { canvas.setPointerCapture(evt.pointerId); } catch (err) { /* тач без поддержки capture — не критично */ }

  const onMove = (ev) => { if (aimDragging) updateAimTargetFromEvent(ev); };
  const finish = (ev) => {
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onCancel);
    try { canvas.releasePointerCapture(evt.pointerId); } catch (err) { /* уже отпущен браузером */ }
    if (!aimDragging) return;
    aimDragging = false;
    if (ev) updateAimTargetFromEvent(ev);
    if (aimTarget) throwClay(aimTarget.x, aimTarget.y);
    setAimMode(false);
  };
  const onUp = (ev) => finish(ev);
  const onCancel = () => finish(null);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
}

// ---------- Комнатное состояние ----------
let interactiveMeshes = [];

function applyRoomState(roomKey) {
  currentRoom = roomKey;
  lobbyGroup.visible = roomKey === 'lobby';
  serverGroup.visible = roomKey === 'server';
  roomLabelEl.textContent = roomKey === 'lobby' ? 'Lobby' : 'Server Room';
  interactiveMeshes = roomKey === 'lobby' ? hotspotProxies : serverHotspotProxies;

  scene.background.set('#171018');
  scene.fog.color.set('#171018');
  ambientLight.color.set('#fff2e0');
  ambientLight.intensity = 0.65;
  keyLight.color.set('#fff2da');
  keyLight.intensity = 1.0;

  setFlatRoomCameraFrustum();
  roomCamX = clamp(player.x, roomCamHalfW, LOBBY_W - roomCamHalfW);
  camera.position.set(roomCamX, roomCamCenterY, 900);
  camera.lookAt(roomCamX, roomCamCenterY, 0);
}

// ---------- Тап/клик: раскастинг по сцене ----------
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();

// Клик по дальнему хотспоту — только идём туда, взаимодействие НЕ срабатывает автоматически по приходу.
// Нужен ещё один клик по тому же предмету, когда персонаж уже рядом — так предмет превращается
// в осознанное действие, а не в случайное "дошёл и сработало".
const HOTSPOT_CLOSE_RADIUS = 90;
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
  if (aimMode) { handleAimPointerDown(evt); return; }
  if (uiBlocked()) return;
  evt.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const p = evt.touches ? evt.touches[0] : evt;
  pointerNDC.x = ((p.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((p.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);

  // Тап где угодно на экране — сначала пластилиновая "печать" в точке клика (чисто декоративно),
  // сама точка ещё пригодится ниже как X для ходьбы, если клик не попал в хотспот.
  const bgMesh = currentRoom === 'lobby' ? lobbyBgMesh : serverBgMesh;
  const bgHit = raycaster.intersectObject(bgMesh)[0];
  if (bgHit) spawnPoke(bgHit.point.x, bgHit.point.y);

  const hits = raycaster.intersectObjects(interactiveMeshes, true);
  if (hits.length) {
    let obj = hits[0].object;
    while (obj && !obj.userData.kind) obj = obj.parent;
    if (obj) {
      const kind = obj.userData.kind;
      const roomHotspots = currentRoom === 'lobby' ? LOBBY_HOTSPOTS : SERVER_HOTSPOTS;
      if (kind === 'door') {
        const h = LOBBY_HOTSPOTS.door;
        approachOrInteract(h.standX, h.standY, h.label,
          () => { if (powered) finishLevel(); else openDoorHint(); }, HOTSPOT_CLOSE_RADIUS);
        return;
      }
      if (kind === 'archway') {
        const h = LOBBY_HOTSPOTS.archway;
        approachOrInteract(h.standX, h.standY, h.label,
          () => startTransition('server'), HOTSPOT_CLOSE_RADIUS);
        return;
      }
      if (kind === 'cactus') {
        const h = LOBBY_HOTSPOTS.cactus;
        approachOrInteract(h.standX, h.standY, h.label, () => interactCactus(), HOTSPOT_CLOSE_RADIUS);
        return;
      }
      if (kind === 'networkBoard') {
        const h = roomHotspots.networkBoard;
        approachOrInteract(h.standX, h.standY, h.label,
          () => openNetworkPanel(), HOTSPOT_CLOSE_RADIUS);
        return;
      }
      if (kind === 'terminal') {
        const h = roomHotspots.terminal;
        approachOrInteract(h.standX, h.standY, h.label,
          () => openTerminalPanel(), HOTSPOT_CLOSE_RADIUS);
        return;
      }
      if (kind === 'fusebox') {
        const h = SERVER_HOTSPOTS.fusebox;
        approachOrInteract(h.standX, h.standY, h.label,
          () => openPuzzle(), HOTSPOT_CLOSE_RADIUS);
        return;
      }
      if (kind === 'hatchBack') {
        const h = SERVER_HOTSPOTS.hatchBack;
        approachOrInteract(h.standX, h.standY, h.label,
          () => startTransition('lobby'), HOTSPOT_CLOSE_RADIUS);
        return;
      }
    }
  }

  // Как в NeverHood: клик где угодно на экране (хоть в потолок) — берём только X
  // и идём туда по фиксированной линии пола. Никакого отказа/кламп-логики по Y.
  // Одинаково для обеих комнат — у них общий формат фона и общая линия пола.
  if (bgHit) {
    const imgX = clamp(bgHit.point.x, WALK_X_MIN, WALK_X_MAX);
    walkTarget = { x: imgX, z: WALK_LINE_Y };
    walkLabel = '';
    pendingAction = null;
    if (debugMode) {
      debugReadoutEl.textContent = `tap: x=${Math.round(bgHit.point.x)} -> walking to (${Math.round(imgX)}, ${WALK_LINE_Y})`;
    }
  }
}
canvas.addEventListener('pointerdown', onPointerDown);

// ---------- Синхронизация сцены с игровым состоянием ----------
let walkBobPhase = 0;
let walkFrameTimer = 0;

function syncScene(dt) {
  updatePokes(dt);

  const isWalking = !!walkTarget;
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

  const targetCamX = clamp(player.x, roomCamHalfW, LOBBY_W - roomCamHalfW);
  roomCamX = lerp(roomCamX, targetCamX, Math.min(1, dt * 5));
  camera.position.x = roomCamX;
  camera.lookAt(roomCamX, roomCamCenterY, 0);

  doorLampMesh.material.color.set(powered ? '#4fdc6a' : '#e0483f');

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
