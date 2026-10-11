/** Deterministic, fixed-step tennis simulation. World units are metres. */
export const DIFFICULTIES = Object.freeze({
  casual: { label: 'Pohoda', description: 'Pomalejší soupeř, více času na každý úder.', speed: 4.35, reaction: 0.3, error: 0.9, shotSpeed: 12.8, reach: 1.25 },
  club: { label: 'Klub', description: 'Vyrovnaný zápas a soupeř, který hledá volný prostor.', speed: 5.1, reaction: 0.2, error: 0.58, shotSpeed: 14.3, reach: 1.4 },
  pro: { label: 'Profík', description: 'Rychlé nohy, přesné údery a těžší výměny.', speed: 5.9, reaction: 0.12, error: 0.34, shotSpeed: 15.5, reach: 1.55 },
});

export const COURT = Object.freeze({ halfWidth: 4.115, halfLength: 11.885, serviceLine: 6.4, netHeight: 0.914 });
const STEP = 1 / 120;
const GRAVITY = 9.81;
const BALL_RADIUS = 0.033;
const other = (side) => side === 'human' ? 'ai' : 'human';
const index = (side) => side === 'human' ? 0 : 1;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const approach = (value, goal, amount) => value < goal ? Math.min(goal, value + amount) : Math.max(goal, value - amount);
const blankPlayer = (side) => ({ x: 0, y: side === 'human' ? 10.5 : -10.5, vx: 0, vy: 0, swing: 0, swingSide: 1, swingContact: null, lastShotPower: 0, reach: side === 'human' ? 2.05 : 1.8, energy: 1, charge: 0 });

export class TennisGame {
  constructor({ difficulty = 'club', onEvent = () => {}, random = Math.random } = {}) {
    this.onEvent = onEvent;
    this.random = random;
    this.difficulty = DIFFICULTIES[difficulty] ? difficulty : 'club';
    this.reset();
  }

  reset() {
    this.state = {
      phase: 'menu', difficulty: this.difficulty, time: 0,
      players: { human: blankPlayer('human'), ai: { ...blankPlayer('ai'), reach: DIFFICULTIES[this.difficulty].reach } },
      ball: { x: 0, y: 10.1, z: 1.25, vx: 0, vy: 0, vz: 0, inPlay: false, bounces: 0, lastHitter: null, trail: [] },
      score: { points: [0, 0], games: [0, 0], sets: [0, 0] },
      server: 'human', tiebreak: false, rally: 0, bestRally: 0,
      lastMessage: 'Tvůj kurt. Tvůj zápas.', winner: null,
      pointTimer: 0, serveTimer: 0,
      stats: { pointsPlayed: 0, humanPoints: 0, aiPoints: 0, shots: 0, humanShots: 0, aiShots: 0, aces: 0, winners: 0, longestRally: 0, distance: 0 },
    };
    this._accumulator = 0;
    this._hitBuffer = 0;
    this._bufferedLob = false;
    this._swingCooldown = { human: 0, ai: 0 };
    this._aiReaction = 0;
    this._aiRefresh = 0;
    this._aiTarget = { x: 0, y: -10.5 };
    this._aiPredictionError = 0;
    this._trailTimer = 0;
    this._serveShot = false;
    this._serveBoxSign = -1;
    this._tiebreakFirstServer = 'human';
    this._pausedPhase = null;
  }

  start() {
    this.reset();
    this.state.phase = 'serve';
    this._prepareServe();
  }

  setDifficulty(value) {
    if (!DIFFICULTIES[value]) return;
    this.difficulty = value;
    this.state.difficulty = value;
    this.state.players.ai.reach = DIFFICULTIES[value].reach;
  }

  pause() {
    if (['serve', 'rally', 'point'].includes(this.state.phase)) {
      this._pausedPhase = this.state.phase;
      this.state.phase = 'paused';
      this._accumulator = 0;
      this._hitBuffer = 0;
      this._bufferedLob = false;
      this.state.players.human.charge = 0;
    }
  }

  resume() {
    if (this.state.phase === 'paused') {
      this.state.phase = this._pausedPhase || 'serve';
      this._pausedPhase = null;
    }
  }

  update(dt, input = {}) {
    if (!Number.isFinite(dt) || dt <= 0 || ['menu', 'paused', 'finished'].includes(this.state.phase)) return;
    if (input.hit || input.hitReleased) {
      this._hitBuffer = 0.23;
      this._bufferedLob = Boolean(input.lob);
    }
    // Short stalls are simulated; long background-tab stalls cannot advance an entire match.
    this._accumulator += Math.min(dt, 0.25);
    while (this._accumulator + 1e-10 >= STEP) {
      this._step(STEP, input);
      this._accumulator -= STEP;
    }
  }

  _emit(type, details = {}) {
    this.onEvent({ type, ...details });
  }

  _step(dt, input) {
    const s = this.state;
    s.time += dt;
    this._hitBuffer = Math.max(0, this._hitBuffer - dt);
    for (const side of ['human', 'ai']) {
      this._swingCooldown[side] = Math.max(0, this._swingCooldown[side] - dt);
      s.players[side].swing = Math.max(0, s.players[side].swing - dt * 3.5);
    }
    if (s.phase === 'point') {
      s.pointTimer -= dt;
      this._settlePlayers(dt);
      if (s.pointTimer <= 0) this._prepareServe();
      return;
    }
    if (s.phase !== 'serve' && s.phase !== 'rally') return;

    const human = s.players.human;
    human.charge = input.hitHeld ? Math.min(1, human.charge + dt * 1.2) : Math.max(0, human.charge - dt * 0.5);
    this._moveHuman(dt, input);
    this._moveAI(dt);

    if (s.phase === 'serve') {
      s.serveTimer += dt;
      const server = s.players[s.server];
      const direction = s.server === 'human' ? -1 : 1;
      Object.assign(s.ball, { x: server.x + direction * 0.12, y: server.y + direction * 0.38, z: 1.5 + Math.sin(s.time * 3) * 0.035 });
      if ((s.server === 'human' && (this._hitBuffer > 0 || input.hitHeld)) || (s.server === 'ai' && s.serveTimer >= 1.2)) this._serve();
      return;
    }

    this._integrateBall(dt);
    if (s.phase !== 'rally') return;
    const ball = s.ball;
    if (ball.lastHitter !== 'human' && ball.y > 0 && this._swingCooldown.human <= 0) {
      const automatic = input.assist !== false;
      // Holding the strike button commits to a charged shot. Assistance must
      // wait for release rather than spending the charge at the first contact.
      const wantsHit = !input.hitHeld && (this._hitBuffer > 0 || automatic);
      if (wantsHit && this._canHit('human', automatic && this._hitBuffer <= 0)) this._strike('human', { ...input, lob: input.lob || (this._hitBuffer > 0 && this._bufferedLob) });
    }
    if (ball.lastHitter !== 'ai' && ball.y < 0 && this._swingCooldown.ai <= 0 && this._aiReaction <= 0 && this._canHit('ai', true)) this._strike('ai');

    this._trailTimer += dt;
    if (this._trailTimer >= 1 / 40) {
      this._trailTimer = 0;
      ball.trail.push({ x: ball.x, y: ball.y, z: ball.z });
      if (ball.trail.length > 10) ball.trail.shift();
    }
  }

  _settlePlayers(dt) {
    for (const p of Object.values(this.state.players)) {
      p.vx = approach(p.vx, 0, 28 * dt);
      p.vy = approach(p.vy, 0, 28 * dt);
    }
  }

  _moveHuman(dt, input) {
    const s = this.state;
    const p = s.players.human;
    let dx = clamp(Number(input.moveX) || 0, -1, 1);
    let dy = clamp(Number(input.moveY) || 0, -1, 1);
    if (input.pointerMove && Number.isFinite(input.targetX) && Number.isFinite(input.targetY)) {
      dx = input.targetX - p.x;
      dy = input.targetY - p.y;
      const length = Math.hypot(dx, dy);
      const scale = Math.min(1, length * 2.7);
      if (length > 0.025) { dx = dx / length * scale; dy = dy / length * scale; }
      else { dx = 0; dy = 0; }
    } else {
      const length = Math.hypot(dx, dy);
      if (length > 1) { dx /= length; dy /= length; }
    }
    p.vx = approach(p.vx, dx * 6.15, 36 * dt);
    p.vy = approach(p.vy, dy * 6.15, 36 * dt);
    const beforeX = p.x;
    const beforeY = p.y;
    p.x = clamp(p.x + p.vx * dt, -5.7, 5.7);
    if (s.phase === 'serve' && s.server === 'human') {
      const deuce = (s.score.points[0] + s.score.points[1]) % 2 === 0;
      p.x = deuce ? Math.max(0.15, p.x) : Math.min(-0.15, p.x);
    }
    p.y = clamp(p.y + p.vy * dt, s.phase === 'serve' && s.server === 'human' ? 12.15 : 0.9, 13.7);
    s.stats.distance += Math.hypot(p.x - beforeX, p.y - beforeY);
  }

  _moveAI(dt) {
    const s = this.state;
    const p = s.players.ai;
    const settings = DIFFICULTIES[this.difficulty];
    this._aiReaction = Math.max(0, this._aiReaction - dt);
    this._aiRefresh -= dt;
    if (s.phase === 'serve') {
      p.vx = 0;
      p.vy = 0;
      return;
    }
    if (this._aiRefresh <= 0 && this._aiReaction <= 0) {
      this._aiRefresh = 0.12;
      if (s.ball.lastHitter === 'human') {
        const prediction = this._predictArrival('ai');
        this._aiTarget = { x: clamp(prediction.x + this._aiPredictionError, -5.2, 5.2), y: clamp(prediction.y, -12.9, -2.5) };
      } else {
        this._aiTarget = { x: clamp(s.players.human.x * 0.18, -1.1, 1.1), y: -9.7 };
      }
    }
    const dx = this._aiTarget.x - p.x;
    const dy = this._aiTarget.y - p.y;
    const length = Math.hypot(dx, dy);
    const speed = Math.min(settings.speed, length * 5);
    const vx = length > 0.06 ? dx / length * speed : 0;
    const vy = length > 0.06 ? dy / length * speed : 0;
    p.vx = approach(p.vx, vx, 19 * dt);
    p.vy = approach(p.vy, vy, 19 * dt);
    p.x = clamp(p.x + p.vx * dt, -5.7, 5.7);
    p.y = clamp(p.y + p.vy * dt, -13.7, -0.9);
  }

  _predictArrival(side) {
    const ball = { ...this.state.ball };
    const p = this.state.players[side];
    const direction = side === 'human' ? 1 : -1;
    const speed = side === 'human' ? 6.15 : DIFFICULTIES[this.difficulty].speed;
    let fallback = { x: ball.x, y: direction * 10 };
    // Prediction uses the same gravity and bounce rules as the live ball.
    for (let time = 0; time < 3.8; time += 0.025) {
      ball.x += ball.vx * 0.025;
      ball.y += ball.vy * 0.025;
      ball.z += ball.vz * 0.025 - 0.5 * GRAVITY * 0.025 * 0.025;
      ball.vz -= GRAVITY * 0.025;
      if (ball.z < BALL_RADIUS) {
        ball.z = BALL_RADIUS;
        ball.vz = Math.abs(ball.vz) * 0.68;
        ball.vx *= 0.91;
        ball.vy *= 0.91;
        ball.bounces++;
        if (ball.bounces >= 2) break;
      }
      if (ball.y * direction > 3 && ball.y * direction < 13.2) {
        fallback = { x: ball.x, y: ball.y };
        const available = speed * Math.max(0, time - 0.05) + p.reach * 0.65;
        const distance = Math.hypot(ball.x - p.x, ball.y - p.y);
        if ((!this._serveShot || ball.bounces > 0) && ball.z >= 0.45 && ball.z <= 1.65 && distance <= available) return fallback;
      }
    }
    return fallback;
  }

  _canHit(side, automatic) {
    const p = this.state.players[side];
    const b = this.state.ball;
    if (!b.inPlay || b.lastHitter === side || b.z < 0.2 || b.z > (automatic ? 1.8 : 2.7)) return false;
    // A serve must land in its service box before the receiver may strike it.
    if (this._serveShot && b.bounces === 0) return false;
    const reach = p.reach + (automatic ? 0 : 0.16);
    // The racket reaches farther sideways than behind the player.
    return Math.hypot((b.x - p.x) * 0.92, (b.y - p.y) * 1.12) <= reach;
  }

  _serve() {
    const s = this.state;
    const side = s.server;
    const p = s.players[side];
    const direction = side === 'human' ? -1 : 1;
    const deuce = (s.score.points[0] + s.score.points[1]) % 2 === 0;
    const targetX = (deuce ? -1 : 1) * (side === 'human' ? 1 : -1) * (1.5 + this.random() * 0.65);
    Object.assign(s.ball, { x: p.x, y: p.y + direction * 0.3, z: 2.15, inPlay: true, bounces: 0, lastHitter: side, trail: [] });
    const targetY = direction * (4.6 + this.random() * 0.75);
    this._serveBoxSign = Math.sign(targetX);
    this._launch(targetX, targetY, 1.07);
    this._serveShot = true;
    this._hitBuffer = 0;
    this._swingCooldown[side] = 0.4;
    p.swing = 1;
    p.swingSide = targetX > p.x ? 1 : -1;
    p.swingContact = { x: s.ball.x, y: s.ball.y, z: s.ball.z };
    p.lastShotPower = 0.55;
    p.charge = 0;
    s.phase = 'rally';
    s.rally = 1;
    s.stats.shots++;
    s.stats[side === 'human' ? 'humanShots' : 'aiShots']++;
    s.lastMessage = side === 'human' ? 'Podání. Najdi si místo pro další úder.' : 'Soupeř podává. Připrav se.';
    this._onIncoming(side);
    this._emit('serve', { side, message: s.lastMessage });
    this._emit('hit', { side, power: 0.55, serve: true, contact: { ...p.swingContact } });
  }

  _strike(side, input = {}) {
    const s = this.state;
    const p = s.players[side];
    const opponent = s.players[other(side)];
    const direction = side === 'human' ? -1 : 1;
    const settings = DIFFICULTIES[this.difficulty];
    const power = side === 'human' ? p.charge : 0.35 + this.random() * 0.45;
    let targetX;
    let targetY;
    let speed;
    if (side === 'human') {
      const aim = clamp(Number(input.aim) || 0, -1, 1);
      // Neutral aim chooses open space; explicit aim always follows the player.
      targetX = Math.abs(aim) > 0.08 ? aim * 3.8 : (opponent.x > 0 ? -1 : 1) * (2.85 + power * 0.9);
      targetY = direction * (8.9 + power * 1.25);
      speed = 14.6 + power * 4;
    } else {
      const gap = s.players.human.x > 0.15 ? -1 : s.players.human.x < -0.15 ? 1 : this.random() < 0.5 ? -1 : 1;
      targetX = gap * (2.7 + power * 0.4) + (this.random() * 2 - 1) * settings.error;
      targetY = direction * (8.5 + this.random() * 1.65);
      speed = settings.shotSpeed + power * 1.8;
    }
    const distance = Math.hypot(targetX - s.ball.x, targetY - s.ball.y);
    let flight = clamp(distance / speed, 0.76, 1.75);
    if (input.lob && side === 'human') flight = Math.max(2.05, distance / 9.2);
    this._launch(targetX, targetY, flight);
    s.ball.bounces = 0;
    s.ball.lastHitter = side;
    this._serveShot = false;
    p.swing = 1;
    p.swingSide = s.ball.x > p.x ? 1 : -1;
    p.swingContact = { x: s.ball.x, y: s.ball.y, z: s.ball.z };
    p.lastShotPower = power;
    p.charge = 0;
    this._swingCooldown[side] = 0.32;
    this._hitBuffer = 0;
    this._bufferedLob = false;
    s.rally++;
    s.bestRally = Math.max(s.bestRally, s.rally);
    s.stats.longestRally = s.bestRally;
    s.stats.shots++;
    s.stats[side === 'human' ? 'humanShots' : 'aiShots']++;
    s.lastMessage = input.lob ? 'Lob. Vrať se do dobré pozice.' : power > 0.65 ? 'Silný úder!' : s.rally > 5 ? 'Dobrá výměna. Drž se!' : 'Hledej volný prostor.';
    this._onIncoming(side);
    this._emit('hit', { side, power, lob: Boolean(input.lob), contact: { ...p.swingContact } });
  }

  _launch(targetX, targetY, flight) {
    const b = this.state.ball;
    const fraction = -b.y / (targetY - b.y);
    // A supported arc clears the net even for a low ball close to the net.
    if (fraction > 0 && fraction < 1) {
      const minimum = (1.15 - b.z * (1 - fraction)) / (0.5 * GRAVITY * fraction * (1 - fraction));
      if (minimum > 0) flight = Math.max(flight, Math.sqrt(minimum));
    }
    b.vx = (targetX - b.x) / flight;
    b.vy = (targetY - b.y) / flight;
    b.vz = (BALL_RADIUS - b.z + 0.5 * GRAVITY * flight * flight) / flight;
    b.trail = [];
  }

  _onIncoming(hitter) {
    if (hitter === 'human') {
      this._aiReaction = DIFFICULTIES[this.difficulty].reaction;
      this._aiRefresh = 0;
      this._aiPredictionError = (this.random() * 2 - 1) * DIFFICULTIES[this.difficulty].error * 0.8;
    }
  }

  _integrateBall(dt) {
    const s = this.state;
    const b = s.ball;
    const oldY = b.y;
    const oldZ = b.z;
    const oldVz = b.vz;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt - 0.5 * GRAVITY * dt * dt;
    b.vz -= GRAVITY * dt;
    if (oldY * b.y <= 0 && oldY !== b.y) {
      const fraction = Math.abs(oldY / (b.y - oldY));
      const netZ = oldZ + oldVz * dt * fraction - 0.5 * GRAVITY * (dt * fraction) ** 2;
      if (netZ <= COURT.netHeight + BALL_RADIUS && Math.abs(b.x) <= COURT.halfWidth + 0.2) {
        b.y = 0;
        b.z = Math.max(BALL_RADIUS, netZ);
        this._emit('net', { side: b.lastHitter });
        this._awardPoint(other(b.lastHitter), 'Síť');
        return;
      }
    }
    if (b.z <= BALL_RADIUS && b.vz < 0) {
      b.z = BALL_RADIUS;
      b.bounces++;
      this._emit('bounce', { x: b.x, y: b.y, side: b.y > 0 ? 'human' : 'ai' });
      if (b.bounces === 1) {
        const expectedHalf = b.lastHitter === 'human' ? -1 : 1;
        const isOutside = Math.abs(b.x) > COURT.halfWidth + BALL_RADIUS || Math.abs(b.y) > COURT.halfLength + BALL_RADIUS || b.y * expectedHalf <= 0;
        const serveOutside = this._serveShot && (Math.abs(b.y) > COURT.serviceLine + BALL_RADIUS || b.x * this._serveBoxSign <= 0);
        if (isOutside || serveOutside) {
          this._awardPoint(other(b.lastHitter), 'Aut');
          return;
        }
      } else {
        if (this._serveShot) s.stats.aces++;
        else s.stats.winners++;
        this._awardPoint(b.lastHitter, this._serveShot ? 'Eso' : 'Druhý odskok');
        return;
      }
      b.vz = Math.abs(b.vz) * 0.68;
      b.vx *= 0.91;
      b.vy *= 0.91;
    }
    // A ball that leaves the visual area still has a well-defined point result.
    if (Math.abs(b.x) > 18 || Math.abs(b.y) > 30 || b.z > 25) this._awardPoint(b.bounces ? b.lastHitter : other(b.lastHitter), b.bounces ? 'Druhý odskok' : 'Aut');
  }

  _prepareServe() {
    const s = this.state;
    s.phase = 'serve';
    s.pointTimer = 0;
    s.serveTimer = 0;
    s.rally = 0;
    const deuce = (s.score.points[0] + s.score.points[1]) % 2 === 0;
    const sign = deuce ? 1 : -1;
    Object.assign(s.players.human, { x: s.server === 'human' ? 1.25 * sign : 1.15 * sign, y: 12.3, vx: 0, vy: 0, charge: 0 });
    Object.assign(s.players.ai, { x: s.server === 'ai' ? -1.25 * sign : -1.15 * sign, y: -12.3, vx: 0, vy: 0, charge: 0 });
    const p = s.players[s.server];
    Object.assign(s.ball, { x: p.x, y: p.y + (s.server === 'human' ? -0.38 : 0.38), z: 1.5, vx: 0, vy: 0, vz: 0, inPlay: false, bounces: 0, lastHitter: null, trail: [] });
    s.lastMessage = s.server === 'human' ? 'Podáváš. Stiskni mezerník nebo tlačítko úderu.' : 'Podává soupeř. Připrav se na příjem.';
    this._hitBuffer = 0;
    this._bufferedLob = false;
    this._aiTarget = { x: s.players.ai.x, y: s.players.ai.y };
    this._aiReaction = 0;
  }

  _awardPoint(winner, reason = '') {
    const s = this.state;
    if (s.phase !== 'rally') return;
    const i = index(winner);
    const j = 1 - i;
    s.ball.inPlay = false;
    s.score.points[i]++;
    s.stats.pointsPlayed++;
    s.stats[winner === 'human' ? 'humanPoints' : 'aiPoints']++;
    s.bestRally = Math.max(s.bestRally, s.rally);
    s.stats.longestRally = s.bestRally;
    const name = winner === 'human' ? 'Tvůj bod' : 'Bod pro soupeře';
    s.lastMessage = `${name}${reason ? ` · ${reason}` : ''}`;
    let wonGame = false;
    if (s.tiebreak) {
      if (s.score.points[i] >= 7 && s.score.points[i] - s.score.points[j] >= 2) {
        s.score.games[i]++;
        wonGame = true;
        this._finish(winner);
      } else {
        const total = s.score.points[0] + s.score.points[1];
        s.server = Math.floor((total + 1) / 2) % 2 ? other(this._tiebreakFirstServer) : this._tiebreakFirstServer;
      }
    } else if (s.score.points[i] >= 4 && s.score.points[i] - s.score.points[j] >= 2) {
      s.score.games[i]++;
      s.score.points = [0, 0];
      s.server = other(s.server);
      wonGame = true;
      if (s.score.games[i] >= 4 && s.score.games[i] - s.score.games[j] >= 2) this._finish(winner);
      else if (s.score.games[0] === 3 && s.score.games[1] === 3) {
        s.tiebreak = true;
        this._tiebreakFirstServer = s.server;
        s.lastMessage += ' · Tie-break do 7';
      }
    }
    this._emit('point', { winner, reason, message: s.lastMessage, game: wonGame });
    if (s.phase !== 'finished') {
      s.phase = 'point';
      s.pointTimer = wonGame ? 2.05 : 1.4;
    }
  }

  _finish(winner) {
    const s = this.state;
    s.phase = 'finished';
    s.winner = winner;
    s.score.sets[index(winner)] = 1;
    s.lastMessage = winner === 'human' ? 'Vyhráváš zápas. Dobrý tenis!' : 'Zápas bere soupeř. Odveta?';
    this._emit('finish', { winner, message: s.lastMessage });
  }
}
