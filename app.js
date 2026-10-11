import { TennisGame, DIFFICULTIES } from './game.js';

const $ = (id) => document.getElementById(id);
const canvas = $('court');
const ctx = canvas.getContext('2d', { alpha: false });
const wrapper = $('canvas-wrap');
const keys = new Set();
const pointer = { active: false, x: 0, y: 0 };
let width = 900, height = 650, pixelRatio = 1;
let difficulty = 'club';
let hitEdge = false, hitRelease = false, touchHeld = false, touchLob = false;
let noticeTimer = 0, soundEnabled = false, audioContext;
let lastTime = 0, accumulator = 0, frameCount = 0, fpsTime = 0, elapsed = 0;
let previousPhase = 'menu';
let helpPaused = false;
let fullscreenFallback = false;
let fullscreenPending = false;
const effects = [];
const game = new TennisGame({ difficulty, onEvent: onGameEvent });
// A read-only-accessible game instance also makes reproducible browser diagnostics possible.
window.__tennis = game;

function onGameEvent(event) {
  if (event.type === 'hit' && !event.serve || event.type === 'serve') {
    playSound(event.type === 'serve' ? 420 : 530, .055, 'sine', .1);
    const b = game.state.ball;
    effects.push({ type: 'hit', x: b.x, y: b.y, z: b.z, age: 0 });
  }
  if (event.type === 'bounce') {
    playSound(170, .045, 'triangle', .06);
    const b = game.state.ball;
    effects.push({ type: 'bounce', x: b.x, y: b.y, z: 0, age: 0 });
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
  if (game.state.phase === 'paused') game.resume();
  else if (isPlaying()) { game.pause(); clearInput(); }
  syncUI();
}
function startMatch() {
  clearInput(); effects.length = 0; noticeTimer = 0;
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
function nativeFullscreen() { return document.fullscreenElement || document.webkitFullscreenElement; }
function syncFullscreen() {
  const active = Boolean(nativeFullscreen() || fullscreenFallback);
  document.documentElement.classList.toggle('game-fullscreen', active);
  $('fullscreen-button').setAttribute('aria-pressed', String(active));
  $('fullscreen-button').setAttribute('aria-label', active ? 'Opustit celou obrazovku' : 'Celá obrazovka');
  $('fullscreen-button').title = `${active ? 'Opustit celou obrazovku' : 'Celá obrazovka'} (F)`;
  $('fullscreen-label').textContent = active ? 'Zmenšit' : 'Celá obrazovka';
  $('fullscreen-icon').setAttribute('d', active ? 'M3 9h6V3m6 0v6h6M9 21v-6H3m18 0h-6v6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6');
  clearInput();
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
$('help-dialog').addEventListener('close', () => { if (helpPaused && game.state.phase === 'paused') game.resume(); helpPaused = false; syncUI(); });
$('help-dialog').addEventListener('click', (e) => { if (e.target === $('help-dialog')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeHelp(); } });

const gameKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyQ', 'KeyE', 'KeyL']);
window.addEventListener('keydown', (event) => {
  if ($('help-dialog').open || event.target instanceof HTMLInputElement) return;
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
  const p = unproject(event.clientX - r.left, event.clientY - r.top);
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
  $('menu-overlay').classList.toggle('hidden', s.phase !== 'menu');
  $('pause-overlay').classList.toggle('hidden', s.phase !== 'paused');
  $('finish-overlay').classList.toggle('hidden', s.phase !== 'finished');
  document.body.classList.toggle('playing', isPlaying());
  $('pause-button').disabled = !isPlaying();
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
  canvas.width = Math.round(width * pixelRatio); canvas.height = Math.round(height * pixelRatio);
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}
new ResizeObserver(resize).observe(wrapper);

// Perspective stays invertible, so pointer movement and the visible court agree.
function project(x, y, z = 0) {
  const t = (y + 14) / 28;
  const scale = width * (.041 + .022 * t);
  return { x: width * .5 + x * scale, y: height * (.23 + .68 * t) - z * scale * 1.14, scale };
}
function unproject(x, y) {
  const t = (y / height - .23) / .68;
  const scale = width * (.041 + .022 * t);
  return { x: (x - width * .5) / scale, y: t * 28 - 14 };
}
function path(points, fill, stroke, lineWidth = 1) {
  ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}
function worldLine(x1, y1, x2, y2, color, lineWidth = 1.5, z = 0) {
  const p1 = project(x1, y1, z), p2 = project(x2, y2, z);
  ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.stroke();
}
function worldRect(x, y, w, h, fill, stroke, lineWidth = 1) { path([project(x, y), project(x + w, y), project(x + w, y + h), project(x, y + h)], fill, stroke, lineWidth); }
function ellipse(x, y, rx, ry, fill, stroke) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(.1, rx), Math.max(.1, ry), 0, 0, Math.PI * 2); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); } }

function drawCourt() {
  const bg = ctx.createLinearGradient(0, 0, width, height); bg.addColorStop(0, '#164332'); bg.addColorStop(1, '#113a2e');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
  // Quiet lawn bands and an inset tournament court, all drawn without external assets.
  for (let y = -18; y < 18; y += 2) worldRect(-10, y, 20, 1, '#ffffff02');
  worldRect(-6.65, -13.6, 13.3, 27.2, '#172f24');
  worldRect(-6.5, -13.5, 13, 27, '#ba7650');
  const clay = ctx.createLinearGradient(0, height * .25, 0, height); clay.addColorStop(0, '#be815b'); clay.addColorStop(1, '#ce9064');
  worldRect(-5.48, -11.885, 10.96, 23.77, clay);
  worldRect(-4.1, -11.885, 8.2, 23.77, '#d39a6b18');
  // Deterministic speckle lends clay texture without a per-frame random workload.
  ctx.fillStyle = '#f0c29613';
  for (let i = 0; i < 150; i++) { const x = ((i * 73) % 131) / 10 - 6.5, y = ((i * 97) % 269) / 10 - 13.5; const p = project(x, y); ctx.fillRect(p.x, p.y, 1.2, .7); }
  const line = '#f8ead0de';
  worldRect(-5.48, -11.885, 10.96, 23.77, null, line, 1.6);
  worldLine(-4.1, -11.885, -4.1, 11.885, line, 1.5); worldLine(4.1, -11.885, 4.1, 11.885, line, 1.5);
  worldLine(-4.1, -6.4, 4.1, -6.4, line, 1.4); worldLine(-4.1, 6.4, 4.1, 6.4, line, 1.4);
  worldLine(0, -6.4, 0, 6.4, line, 1.3); worldLine(0, -11.885, 0, -11.4, line, 1.5); worldLine(0, 11.4, 0, 11.885, line, 1.5);
  // Brand lettering sits on the runoff rather than covering the playing surface.
  ctx.save(); const badge = project(0, 13.1); ctx.translate(badge.x, badge.y); ctx.fillStyle = '#f7dab65e'; ctx.font = `600 ${Math.max(7, width * .009)}px system-ui`; ctx.textAlign = 'center'; ctx.fillText('M A T C H   P O I N T', 0, 0); ctx.restore();
  // Baseline positioning hints disappear during the rally.
  if (game.state.phase === 'serve') {
    const player = game.state.players.human, p = project(player.x, player.y);
    ellipse(p.x, p.y, p.scale * .58, p.scale * .23, null, '#e0eb8b77');
  }
}

function drawNet() {
  const a = project(-5.8, 0), b = project(5.8, 0), aTop = project(-5.8, 0, 1.07), bTop = project(5.8, 0, 1.07);
  path([{x:a.x+2,y:a.y+7},{x:b.x+5,y:b.y+7},{x:b.x+15,y:b.y+22},{x:a.x+12,y:a.y+22}], '#242d2030');
  path([aTop, bTop, b, a], '#152b2acc');
  ctx.strokeStyle = '#c3bda135'; ctx.lineWidth = .6;
  for (let i = 1; i < 40; i++) { const t = i / 40; ctx.beginPath(); ctx.moveTo(a.x + (b.x-a.x)*t, aTop.y); ctx.lineTo(a.x + (b.x-a.x)*t, a.y); ctx.stroke(); }
  for (let i = 1; i < 7; i++) { const y = aTop.y + (a.y - aTop.y) * i / 7; ctx.beginPath(); ctx.moveTo(a.x, y); ctx.lineTo(b.x, y); ctx.stroke(); }
  ctx.strokeStyle = '#f2e3c9'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(aTop.x, aTop.y); ctx.quadraticCurveTo(width*.5, aTop.y+3, bTop.x, bTop.y); ctx.stroke();
  worldLine(-5.8, 0, -5.8, 0, '#e6d7b8');
  for (const x of [-5.8, 5.8]) { const p = project(x, 0), q = project(x, 0, 1.24); ctx.strokeStyle='#d9d4b7';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(p.x,p.y+3);ctx.lineTo(q.x,q.y);ctx.stroke();ellipse(q.x,q.y,2,2,'#eee6cc'); }
}

function drawPlayer(player, human) {
  const p = project(player.x, player.y), s = p.scale;
  const moving = Math.hypot(player.vx || 0, player.vy || 0) > .4;
  const step = moving ? Math.sin(elapsed * 17) : 0;
  const body = project(player.x, player.y, .93), head = project(player.x, player.y, 1.3);
  const swing = player.swing || 0;
  ellipse(p.x + s*.08, p.y + s*.08, s*.42, s*.16, '#192a223b');
  if (human) ellipse(p.x, p.y, s*.39, s*.13, null, '#a8dcf380');
  // Legs and shoes.
  for (const sign of [-1, 1]) { const footX = p.x+sign*s*.12, footY=p.y+sign*step*s*.065;
    ctx.strokeStyle='#d6b391';ctx.lineWidth=s*.12;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(body.x+sign*s*.10,body.y+s*.26);ctx.lineTo(footX,footY-s*.07);ctx.stroke();
    ellipse(footX,footY-s*.055,s*.115,s*.055,'#f4eee0'); }
  // A simple readable silhouette and racket stay visible even on a narrow display.
  ctx.strokeStyle='#d7b08b';ctx.lineWidth=s*.12;ctx.beginPath();ctx.moveTo(body.x,body.y-s*.1);ctx.lineTo(head.x,head.y+s*.13);ctx.stroke();
  ellipse(body.x,body.y+s*.10,s*.23,s*.27,human?'#6ab1d5':'#e38d69');
  ctx.fillStyle=human?'#254855':'#754530';ctx.fillRect(body.x-s*.18,body.y+s*.23,s*.36,s*.11);
  const armX = body.x+s*(.25+.18*Math.sin(swing*Math.PI)), armY = body.y-s*(.02+.11*Math.sin(swing*Math.PI));
  ctx.strokeStyle='#d7b08b';ctx.lineWidth=s*.11;ctx.beginPath();ctx.moveTo(body.x+s*.16,body.y);ctx.lineTo(armX,armY);ctx.stroke();
  const racketX=armX+s*(.28+.20*Math.sin(swing*Math.PI)), racketY=armY-s*.14;
  ctx.strokeStyle='#e5eac8';ctx.lineWidth=s*.028;ctx.beginPath();ctx.moveTo(armX,armY);ctx.lineTo(racketX,racketY+s*.1);ctx.stroke();
  ctx.save();ctx.translate(racketX,racketY);ctx.rotate(-.3+swing*1.5);ellipse(0,0,s*.13,s*.19,'#17332a20','#cbe2a3');ctx.strokeStyle='#cce4ba66';ctx.lineWidth=.5;for(let i=-1;i<=1;i++){ctx.beginPath();ctx.moveTo(i*s*.055,-s*.145);ctx.lineTo(i*s*.055,s*.145);ctx.stroke();ctx.beginPath();ctx.moveTo(-s*.1,i*s*.07);ctx.lineTo(s*.1,i*s*.07);ctx.stroke();}ctx.restore();
  ellipse(head.x,head.y,s*.13,s*.15,'#e3bb91');
  ellipse(head.x,head.y-s*.055,s*.14,s*.065,human?'#f1eee0':'#35483b');
  ctx.lineCap='butt';
  if (human && player.charge > .08) {
    const r = s*.46; ctx.strokeStyle='#dfea85'; ctx.lineWidth=3; ctx.beginPath();ctx.arc(p.x,p.y-s*.45,r,-Math.PI/2,-Math.PI/2+Math.PI*2*Math.min(1,player.charge));ctx.stroke();
  }
  if (game.state.phase === 'menu' || game.state.phase === 'serve') { ctx.fillStyle=human?'#c5eaf1':'#efd0b6';ctx.textAlign='center';ctx.font=`600 ${Math.max(8,s*.17)}px system-ui`;ctx.fillText(human?'VY':'CPU',p.x,p.y+s*.36); }
}

function drawBall() {
  const b=game.state.ball; if (!b) return;
  const ground=project(b.x,b.y), p=project(b.x,b.y,b.z);
  ellipse(ground.x+Math.max(0,b.z)*ground.scale*.08,ground.y+3,ground.scale*(.10+b.z*.008),ground.scale*.044,'#2a312445');
  if (b.inPlay && b.trail?.length > 1) {
    const tail=b.trail.slice(-8);
    for(let i=1;i<tail.length;i++){const a=project(tail[i-1].x,tail[i-1].y,tail[i-1].z),c=project(tail[i].x,tail[i].y,tail[i].z);ctx.strokeStyle=`rgba(234,242,150,${.035+.2*i/tail.length})`;ctx.lineWidth=Math.max(1,p.scale*.055*i/tail.length);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(c.x,c.y);ctx.stroke();}
  }
  const r=Math.max(3.2,p.scale*.088);
  if(b.inPlay){ellipse(p.x,p.y,r*1.6,r*1.6,'#edee8620');}
  ellipse(p.x,p.y,r,r,'#e8f38b');
  ctx.strokeStyle='#a3b956';ctx.lineWidth=.9;ctx.beginPath();ctx.arc(p.x-r*.5,p.y,r*.7,-Math.PI*.4,Math.PI*.4);ctx.stroke();
  ellipse(p.x-r*.25,p.y-r*.32,r*.25,r*.2,'#ffffdf');
}
function drawLandingHint() {
  const b=game.state.ball;
  if (!$('assist-toggle').checked || !b.inPlay || b.lastHitter !== 'ai' || b.bounces !== 0) return;
  const t=(b.vz+Math.sqrt(b.vz*b.vz+2*9.81*Math.max(0,b.z-.033)))/9.81;
  const x=b.x+b.vx*t,y=b.y+b.vy*t;
  if(y<0||y>11.92||Math.abs(x)>4.15)return;
  const p=project(x,y),pulse=.33+.025*Math.sin(elapsed*7);
  ellipse(p.x,p.y,p.scale*pulse,p.scale*pulse*.35,'#e4ed9b13','#e7efa67a');
  ctx.fillStyle='#e7efa680';ctx.fillRect(p.x-2,p.y-1,4,2);
}
function drawEffects(dt) {
  for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.age+=dt;if(e.age>.45){effects.splice(i,1);continue;}const p=project(e.x,e.y,e.z);ctx.globalAlpha=1-e.age/.45;if(e.type==='bounce'){ellipse(p.x,p.y,p.scale*(.12+e.age*.8),p.scale*(.05+e.age*.2),null,'#f1eacb');}else{ctx.strokeStyle='#f2f49b';ctx.lineWidth=1.5;for(let j=0;j<5;j++){const a=j*Math.PI*2/5;ctx.beginPath();ctx.moveTo(p.x+Math.cos(a)*p.scale*(.10+e.age*.35),p.y+Math.sin(a)*p.scale*(.10+e.age*.35));ctx.lineTo(p.x+Math.cos(a)*p.scale*(.18+e.age*.45),p.y+Math.sin(a)*p.scale*(.18+e.age*.45));ctx.stroke();}}ctx.globalAlpha=1;}
}

function render(dt) {
  drawCourt();
  drawLandingHint();
  const s=game.state;
  drawPlayer(s.players.ai,false);
  if(s.ball.y<0) drawBall();
  drawNet();
  drawPlayer(s.players.human,true);
  if(s.ball.y>=0) drawBall();
  drawEffects(dt);
  if(pointer.active&&isPlaying()){const p=project(pointer.x,pointer.y);ellipse(p.x,p.y,8,3,null,'#d9e7ad88');}
}

function frame(time) {
  const dt=lastTime?Math.min((time-lastTime)/1000,.1):0; lastTime=time;elapsed+=dt;
  accumulator+=dt;
  let iterations=0;
  while(accumulator>=1/120&&iterations<12){game.update(1/120,readInput());hitEdge=false;hitRelease=false;accumulator-=1/120;iterations++;}
  if(iterations===12)accumulator=0;
  if(noticeTimer>0){noticeTimer-=dt;if(noticeTimer<=0)$('game-notice').classList.remove('visible');}
  render(dt);
  frameCount++;fpsTime+=dt;
  if(fpsTime>.7){$('fps-label').textContent=`${Math.min(240,Math.round(frameCount/fpsTime))} FPS`;frameCount=0;fpsTime=0;syncUI();}
  if(game.state.phase!==previousPhase)syncUI();
  requestAnimationFrame(frame);
}
resize();syncUI();requestAnimationFrame(frame);
