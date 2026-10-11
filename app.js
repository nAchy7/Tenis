import { TennisGame, DIFFICULTIES } from './game.js';
import { TennisRenderer } from './renderer3d.js';

const $ = (id) => document.getElementById(id);
const canvas = $('court');
const wrapper = $('canvas-wrap');
const keys = new Set();
const pointer = { active: false, x: 0, y: 0 };
let width = 900, height = 650, pixelRatio = 1;
let difficulty = 'club';
let hitEdge = false, hitRelease = false, touchHeld = false, touchLob = false;
let noticeTimer = 0, soundEnabled = false, audioContext;
let lastTime = 0, accumulator = 0, frameCount = 0, fpsTime = 0;
let previousPhase = 'menu';
let helpPaused = false;
let fullscreenFallback = false;
let fullscreenPending = false;
let renderer, graphicsReady = false;
const game = new TennisGame({ difficulty, onEvent: onGameEvent });
// A read-only-accessible game instance also makes reproducible browser diagnostics possible.
window.__tennis = game;
try {
  renderer = new TennisRenderer(canvas);
  graphicsReady = true;
  window.__tennisRenderer = renderer;
  canvas.dataset.renderer = 'webgl';
} catch {
  $('webgl-error').classList.remove('hidden');
  $('start-button').disabled = true;
}

function onGameEvent(event) {
  renderer?.handleEvent(event, game.state);
  if (event.type === 'hit' && !event.serve || event.type === 'serve') {
    playSound(event.type === 'serve' ? 420 : 530, .055, 'sine', .1);
  }
  if (event.type === 'bounce') {
    playSound(170, .045, 'triangle', .06);
  }
  if (event.type === 'net') playSound(90, .1, 'triangle', .065);
  if (event.type === 'point') {
    showNotice(event.message || game.state.lastMessage, 2);
    playSound(event.winner === 'human' ? 660 : 280, .17, 'sine', .08);
  }
  if (event.type === 'finish') playSound(event.winner === 'human' ? 880 : 400, .3, 'sine', .07);
}

function playSound(frequency, duration, type, volume) {
  if (!soundEnabled || !audioContext) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(50, frequency * .55), audioContext.currentTime + duration);
  gain.gain.setValueAtTime(volume, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + duration);
  oscillator.connect(gain); gain.connect(audioContext.destination);
  oscillator.start(); oscillator.stop(audioContext.currentTime + duration);
}

function clearInput() { keys.clear(); pointer.active = false; hitEdge = false; hitRelease = false; touchHeld = false; touchLob = false; }
function isPlaying() { return ['serve', 'rally', 'point'].includes(game.state.phase); }
function togglePause() {
  if (!graphicsReady) return;
  if (game.state.phase === 'paused') game.resume();
  else if (isPlaying()) { game.pause(); clearInput(); }
  syncUI();
}
function startMatch() {
  if (!graphicsReady) return;
  clearInput(); noticeTimer = 0;
  game.setDifficulty(difficulty); game.start();
  accumulator = 0; lastTime = 0;
  canvas.focus({ preventScroll: true });
  syncUI();
  showNotice('Jste na podání. Mezerník nebo ÚDER.', 3);
}
function backToMenu() { clearInput(); game.reset(); syncUI(); }
function showNotice(message, seconds = 2) { $('game-notice').textContent = message; noticeTimer = seconds; $('game-notice').classList.add('visible'); }

document.querySelectorAll('[data-difficulty]').forEach((button) => {
  button.addEventListener('click', () => {
    difficulty = button.dataset.difficulty;
    document.querySelectorAll('[data-difficulty]').forEach((b) => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); });
    $('difficulty-label').textContent = DIFFICULTIES[difficulty].label.toLocaleUpperCase('cs');
  });
});
$('start-button').addEventListener('click', startMatch);
$('again-button').addEventListener('click', startMatch);
$('restart-button').addEventListener('click', backToMenu);
$('pause-restart').addEventListener('click', backToMenu);
$('finish-menu').addEventListener('click', backToMenu);
$('pause-button').addEventListener('click', togglePause);
$('resume-button').addEventListener('click', togglePause);
$('assist-toggle').addEventListener('change', () => { if (isPlaying()) canvas.focus({ preventScroll: true }); });
function toggleCamera() {
  if (!renderer || !graphicsReady) return;
  renderer.setCamera(renderer.mode === 'court' ? 'player' : 'court');
  $('camera-label').textContent = renderer.mode === 'court' ? 'Celý kurt' : 'Za hráčem';
  $('camera-button').setAttribute('aria-label', `Kamera: ${renderer.mode === 'court' ? 'celý kurt' : 'za hráčem'}. Přepnout kameru.`);
  pointer.active = false; canvas.focus({ preventScroll: true });
}
$('camera-button').addEventListener('click', toggleCamera);
$('webgl-retry').addEventListener('click', () => location.reload());
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  graphicsReady = false; helpPaused = false; game.pause(); clearInput();
  $('webgl-error').classList.remove('hidden'); syncUI();
});
canvas.addEventListener('webglcontextrestored', () => {
  graphicsReady = true; $('webgl-error').classList.add('hidden');
  resize(); syncUI();
});
function nativeFullscreen() { return document.fullscreenElement || document.webkitFullscreenElement; }
function syncFullscreen() {
  const active = Boolean(nativeFullscreen() || fullscreenFallback);
  document.documentElement.classList.toggle('game-fullscreen', active);
  $('fullscreen-button').setAttribute('aria-pressed', String(active));
  $('fullscreen-button').setAttribute('aria-label', active ? 'Opustit celou obrazovku' : 'Celá obrazovka');
  $('fullscreen-button').title = `${active ? 'Opustit celou obrazovku' : 'Celá obrazovka'} (F)`;
  $('fullscreen-label').textContent = active ? 'Zmenšit' : 'Celá obrazovka';
  $('fullscreen-icon').setAttribute('d', active ? 'M3 9h6V3m6 0v6h6M9 21v-6H3m18 0h-6v6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6');
  // Fullscreen events can arrive after the next keydown. Keep held keys alive.
  pointer.active = false;
  canvas.focus({ preventScroll: true });
}
async function toggleFullscreen() {
  if (fullscreenPending) return;
  fullscreenPending = true;
  try {
    if (nativeFullscreen()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      await exit.call(document);
    } else if (fullscreenFallback) {
      fullscreenFallback = false;
    } else {
      const request = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
      if (request) await request.call(document.documentElement);
      else fullscreenFallback = true; // On mobile browsers without the API, use all available window space.
    }
    syncFullscreen();
  } catch {
    showNotice('Celou obrazovku prohlížeč nepovolil.', 3);
  } finally { fullscreenPending = false; }
}
$('fullscreen-button').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', syncFullscreen);
document.addEventListener('webkitfullscreenchange', syncFullscreen);
$('sound-button').addEventListener('click', async () => {
  soundEnabled = !soundEnabled;
  if (soundEnabled) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) { soundEnabled = false; return; }
    audioContext ||= new AudioContext();
    try { await audioContext.resume(); } catch { soundEnabled = false; }
  }
  $('sound-label').textContent = soundEnabled ? 'Zvuk zapnutý' : 'Zvuk vypnutý';
  $('sound-button').setAttribute('aria-label', soundEnabled ? 'Vypnout zvuk' : 'Zapnout zvuk');
  $('sound-button').setAttribute('aria-pressed', String(soundEnabled));
  if (soundEnabled) playSound(600, .1, 'sine', .06);
  try { localStorage.setItem('matchpoint-sound', String(soundEnabled)); } catch { /* Storage can be unavailable in private browsing. */ }
});
function openHelp() {
  helpPaused = isPlaying();
  if (helpPaused) { game.pause(); clearInput(); syncUI(); }
  $('help-dialog').showModal();
}
function closeHelp() { $('help-dialog').close(); }
$('help-button').addEventListener('click', openHelp);
$('close-help').addEventListener('click', closeHelp);
$('help-done').addEventListener('click', closeHelp);
$('help-dialog').addEventListener('close', () => { if (graphicsReady && helpPaused && game.state.phase === 'paused') game.resume(); helpPaused = false; syncUI(); });
$('help-dialog').addEventListener('click', (e) => { if (e.target === $('help-dialog')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeHelp(); } });

const gameKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyQ', 'KeyE', 'KeyL']);
window.addEventListener('keydown', (event) => {
  if ($('help-dialog').open || event.target instanceof HTMLInputElement) return;
  if (event.code === 'KeyC' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); if (!event.repeat) toggleCamera(); return; }
  if (event.code === 'KeyF' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); if (!event.repeat) toggleFullscreen(); return; }
  if (event.code === 'Escape' && (nativeFullscreen() || fullscreenFallback)) {
    if (fullscreenFallback && !event.repeat) { event.preventDefault(); toggleFullscreen(); }
    return;
  }
  if (event.code === 'Escape' || event.code === 'KeyP') { if (!event.repeat) togglePause(); return; }
  if (event.target instanceof HTMLButtonElement && !isPlaying()) return;
  if (gameKeys.has(event.code) && isPlaying()) {
    event.preventDefault();
    if ((event.code === 'Space' || event.code === 'KeyL') && !keys.has(event.code)) hitEdge = true;
    keys.add(event.code);
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) pointer.active = false;
  }
});
window.addEventListener('keyup', (event) => { if (event.code === 'Space' && keys.has('Space')) hitRelease = true; keys.delete(event.code); });
window.addEventListener('blur', () => { if (isPlaying()) { game.pause(); syncUI(); } clearInput(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && isPlaying()) { game.pause(); clearInput(); syncUI(); } });

function pointerPosition(event) {
  const r = canvas.getBoundingClientRect();
  const p = renderer?.unproject(event.clientX - r.left, event.clientY - r.top);
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
  pointer.x = Math.max(-5.9, Math.min(5.9, p.x));
  pointer.y = Math.max(.9, Math.min(13.4, p.y));
}
canvas.addEventListener('pointerdown', (event) => {
  if (!isPlaying() || event.button > 0) return;
  event.preventDefault(); canvas.focus({ preventScroll: true });
  canvas.setPointerCapture(event.pointerId); pointer.active = true; pointerPosition(event);
  if (game.state.phase === 'serve' && game.state.server === 'human') hitEdge = true;
});
canvas.addEventListener('pointermove', (event) => { if (pointer.active) pointerPosition(event); });
canvas.addEventListener('pointerup', () => { pointer.active = false; });
canvas.addEventListener('pointercancel', () => { pointer.active = false; });
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
function wireTouchButton(id, lob = false) {
  const button = $(id);
  button.addEventListener('pointerdown', (event) => { event.preventDefault(); button.setPointerCapture(event.pointerId); hitEdge = true; if (lob) touchLob = true; else touchHeld = true; });
  const release = () => { if (lob) touchLob = false; else { touchHeld = false; hitRelease = true; } };
  button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
}
wireTouchButton('touch-hit'); wireTouchButton('touch-lob', true);

function readInput() {
  const moveX = Number(keys.has('ArrowRight') || keys.has('KeyD')) - Number(keys.has('ArrowLeft') || keys.has('KeyA'));
  const moveY = Number(keys.has('ArrowDown') || keys.has('KeyS')) - Number(keys.has('ArrowUp') || keys.has('KeyW'));
  const aimKey = Number(keys.has('KeyE')) - Number(keys.has('KeyQ'));
  return { moveX, moveY, targetX: pointer.x, targetY: pointer.y, pointerMove: pointer.active, hit: hitEdge, hitHeld: keys.has('Space') || touchHeld, hitReleased: hitRelease, aim: aimKey || (pointer.active ? Math.max(-1, Math.min(1, pointer.x / 4.1)) : moveX * .75), lob: keys.has('KeyL') || touchLob, assist: $('assist-toggle').checked };
}

function pointLabel(side) {
  const s = game.state, p = s.score.points[side], other = s.score.points[1 - side];
  if (s.tiebreak) return String(p);
  if (p >= 3 && other >= 3) return p > other ? 'AD' : '40';
  return ['0', '15', '30', '40'][Math.min(3, p)];
}
function syncUI() {
  const s = game.state;
  $('menu-overlay').classList.toggle('hidden', s.phase !== 'menu' || !graphicsReady);
  $('pause-overlay').classList.toggle('hidden', s.phase !== 'paused');
  $('finish-overlay').classList.toggle('hidden', s.phase !== 'finished');
  document.body.classList.toggle('playing', isPlaying());
  $('pause-button').disabled = !isPlaying();
  $('resume-button').disabled = !graphicsReady;
  $('camera-button').disabled = !graphicsReady;
  $('start-button').disabled = !graphicsReady;
  $('restart-button').disabled = s.phase === 'menu';
  $('human-games').textContent = s.score.games[0];
  $('ai-games').textContent = s.score.games[1];
  $('human-points').textContent = pointLabel(0);
  $('ai-points').textContent = pointLabel(1);
  $('human-server').hidden = s.server !== 'human';
  $('ai-server').hidden = s.server !== 'ai';
  $('rally-stat').innerHTML = `${s.rally || 0} <small>úderů</small>`;
  $('best-stat').innerHTML = `${s.bestRally || 0} <small>úderů</small>`;
  $('won-stat').textContent = s.stats?.humanPoints ?? '0';
  let status = 'Připraveno na první podání';
  if (s.phase === 'serve') status = s.server === 'human' ? 'Vaše podání · stiskněte mezerník' : 'Podává počítač · připravte se';
  if (s.phase === 'rally') status = s.tiebreak ? 'Tie-break · každý míček se počítá' : 'Míček je ve hře';
  if (s.phase === 'point') status = s.lastMessage || 'Konec výměny';
  if (s.phase === 'paused') status = 'Zápas je pozastavený';
  if (s.phase === 'finished') status = 'Zápas dokončen';
  $('status-line').textContent = status;
  if (s.phase === 'finished' && previousPhase !== 'finished') {
    const won = s.winner === 'human';
    $('finish-eyebrow').textContent = won ? 'KURT PATŘÍ VÁM' : 'DALŠÍ ZÁPAS JE VÁŠ';
    $('finish-title').textContent = won ? 'Vítězný míč.' : 'Dobrá hra.';
    $('finish-description').textContent = `${won ? 'Vyhráváte' : 'Počítač vyhrává'} ${s.score.games[0]} : ${s.score.games[1]}. Nejdelší výměna: ${s.bestRally} úderů. Dáte si ještě jeden set?`;
    try { const old = Number(localStorage.getItem('matchpoint-best') || 0); localStorage.setItem('matchpoint-best', String(Math.max(old, s.bestRally))); } catch { /* Optional storage. */ }
  }
  previousPhase = s.phase;
}

function resize() {
  width = wrapper.clientWidth; height = wrapper.clientHeight;
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  if (graphicsReady) renderer.resize(width, height, pixelRatio);
}
new ResizeObserver(resize).observe(wrapper);

function render(dt) {
  if (!graphicsReady) return;
  renderer.render(game.state, dt, {
    assist: $('assist-toggle').checked,
    pointer,
    aim: readInput().aim,
  });
  const charge = game.state.players.human.charge || 0;
  $('power-meter').style.setProperty('--charge', `${Math.round(charge * 100)}%`);
  $('power-meter').classList.toggle('charging', charge > .08 && isPlaying());
}

function frame(time) {
  const dt=lastTime?Math.min((time-lastTime)/1000,.1):0; lastTime=time;
  accumulator=graphicsReady?accumulator+dt:0;
  let iterations=0;
  while(accumulator>=1/120&&iterations<12){game.update(1/120,readInput());hitEdge=false;hitRelease=false;accumulator-=1/120;iterations++;}
  if(iterations===12)accumulator=0;
  if(noticeTimer>0){noticeTimer-=dt;if(noticeTimer<=0)$('game-notice').classList.remove('visible');}
  render(dt);
  frameCount++;fpsTime+=dt;
  if(fpsTime>.7){$('fps-label').textContent=`3D · ${Math.min(240,Math.round(frameCount/fpsTime))} FPS`;frameCount=0;fpsTime=0;syncUI();}
  if(game.state.phase!==previousPhase)syncUI();
  requestAnimationFrame(frame);
}
resize();syncUI();requestAnimationFrame(frame);
