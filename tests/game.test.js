import test from 'node:test';
import assert from 'node:assert/strict';
import { TennisGame, COURT } from '../game.js';

function makeGame(options = {}) {
  const game = new TennisGame({ random: () => 0.5, ...options });
  game.start();
  return game;
}

function givePoint(game, winner) {
  game.state.phase = 'rally';
  game._awardPoint(winner, 'Test');
}

function simulate(game, seconds, input = {}, frame = 1 / 60) {
  for (let elapsed = 0; elapsed < seconds - 1e-8; elapsed += frame) game.update(Math.min(frame, seconds - elapsed), input);
}

test('deuce needs a two-point margin and server changes only after a game', () => {
  const game = makeGame();
  for (let i = 0; i < 3; i++) { givePoint(game, 'human'); givePoint(game, 'ai'); }
  assert.deepEqual(game.state.score.points, [3, 3]);
  givePoint(game, 'human');
  assert.deepEqual(game.state.score.games, [0, 0]);
  givePoint(game, 'ai');
  assert.deepEqual(game.state.score.points, [4, 4]);
  givePoint(game, 'human');
  givePoint(game, 'human');
  assert.deepEqual(game.state.score.games, [1, 0]);
  assert.deepEqual(game.state.score.points, [0, 0]);
  assert.equal(game.state.server, 'ai');
});

test('short match ends at four games with a two-game lead', () => {
  const game = makeGame();
  for (let i = 0; i < 16; i++) givePoint(game, 'human');
  assert.equal(game.state.phase, 'finished');
  assert.equal(game.state.winner, 'human');
  assert.deepEqual(game.state.score.games, [4, 0]);
  assert.deepEqual(game.state.score.sets, [1, 0]);
});

test('3–3 starts a tie-break with correct serve order and two-point margin', () => {
  const game = makeGame();
  for (let g = 0; g < 6; g++) for (let p = 0; p < 4; p++) givePoint(game, g % 2 ? 'ai' : 'human');
  assert.equal(game.state.tiebreak, true);
  assert.equal(game.state.server, 'human');
  givePoint(game, 'human');
  assert.equal(game.state.server, 'ai');
  givePoint(game, 'ai');
  assert.equal(game.state.server, 'ai');
  givePoint(game, 'human');
  assert.equal(game.state.server, 'human');
  for (let i = 0; i < 4; i++) { givePoint(game, 'human'); givePoint(game, 'ai'); }
  givePoint(game, 'ai');
  assert.deepEqual(game.state.score.points, [6, 6]);
  givePoint(game, 'human');
  assert.equal(game.state.phase, 'point');
  givePoint(game, 'human');
  assert.equal(game.state.phase, 'finished');
  assert.deepEqual(game.state.score.games, [4, 3]);
});

test('a low crossing hits the net and awards the receiver', () => {
  const game = makeGame();
  game.state.phase = 'rally';
  Object.assign(game.state.ball, { x: 0, y: 0.05, z: 0.4, vx: 0, vy: -12, vz: 0, inPlay: true, lastHitter: 'human' });
  game.update(1 / 60, { assist: false });
  assert.equal(game.state.phase, 'point');
  assert.deepEqual(game.state.score.points, [0, 1]);
  assert.match(game.state.lastMessage, /Síť/);
});

test('an out first bounce awards receiver and an inside second bounce awards hitter', () => {
  for (const [x, bounces, expected] of [[COURT.halfWidth + 0.2, 0, [0, 1]], [0, 1, [1, 0]]]) {
    const game = makeGame();
    game.state.phase = 'rally';
    Object.assign(game.state.ball, { x, y: -7, z: 0.035, vx: 0, vy: -3, vz: -3, bounces, inPlay: true, lastHitter: 'human' });
    game.update(1 / 120, { assist: false });
    assert.deepEqual(game.state.score.points, expected);
    assert.equal(game.state.phase, 'point');
  }
});

test('serves land inside the opposite service box and AI can return them', () => {
  for (const difficulty of ['casual', 'club', 'pro']) {
    const game = makeGame({ difficulty });
    game.update(1 / 60, { hit: true });
    assert.equal(game.state.phase, 'rally');
    let firstBounce;
    const events = [];
    game.onEvent = (event) => { events.push(event); if (event.type === 'bounce' && !firstBounce) firstBounce = event; };
    simulate(game, 2.5, { assist: false });
    assert.ok(firstBounce, `${difficulty} serve must bounce`);
    assert.ok(firstBounce.y < 0 && firstBounce.y >= -COURT.serviceLine);
    assert.ok(firstBounce.x < 0 && Math.abs(firstBounce.x) < COURT.halfWidth);
    assert.ok(events.some((event) => event.type === 'hit' && event.side === 'ai'), `${difficulty} AI returns a reachable serve`);
  }
});

test('a player cannot hit twice in a row', () => {
  const game = makeGame();
  game.update(1 / 60, { hit: true });
  const hits = game.state.stats.humanShots;
  simulate(game, 0.35, { hitHeld: true, assist: true });
  assert.equal(game.state.stats.humanShots, hits);
});

test('both servers use the correct deuce and advantage box even after moving', () => {
  for (const side of ['human', 'ai']) {
    for (const pointTotal of [0, 1]) {
      const game = makeGame();
      game.state.server = side;
      game.state.score.points = [pointTotal, 0];
      game._prepareServe();
      assert.ok(Math.abs(game.state.players[side].y) > COURT.halfLength);
      const expectedXSign = (pointTotal ? 1 : -1) * (side === 'human' ? 1 : -1);
      const receiver = side === 'human' ? 'ai' : 'human';
      assert.equal(Math.sign(game.state.players[receiver].x), expectedXSign, 'the receiver starts in the service destination half');
      let bounce;
      game.onEvent = (event) => { if (event.type === 'bounce' && !bounce) bounce = event; };
      game._serve();
      // The serving player can move across the court while the ball is in flight.
      game.state.players[side].x *= -1;
      simulate(game, 1.15, { moveX: -1, assist: false });
      assert.ok(bounce);
      assert.ok(Math.abs(bounce.y) <= COURT.serviceLine);
      assert.equal(game.state.stats.pointsPlayed, 0, 'a valid serve stays valid after server movement');
      assert.equal(Math.sign(bounce.x), expectedXSign);
    }
  }
});

function incomingGame() {
  const game = makeGame();
  game.state.phase = 'rally';
  Object.assign(game.state.players.human, { x: 0, y: 10 });
  Object.assign(game.state.ball, { x: 0, y: -9, z: 1.2, inPlay: true, lastHitter: 'ai' });
  game._launch(0, 10.2, 1.5);
  return game;
}

test('holding charge reserves an assisted shot until release, and increases its speed', () => {
  const shots = [];
  for (const charged of [false, true]) {
    const game = incomingGame();
    const events = [];
    game.onEvent = (event) => { if (event.type === 'hit') events.push(event); };
    simulate(game, 1.4, { hitHeld: charged, assist: charged });
    assert.equal(game.state.stats.humanShots, 0, 'charge must not be spent by automatic assistance');
    game.update(1 / 60, { hitReleased: true, assist: charged });
    assert.equal(game.state.stats.humanShots, 1);
    assert.equal(events.length, 1);
    assert.deepEqual(game.state.players.human.swingContact, events[0].contact);
    assert.equal(game.state.players.human.lastShotPower, events[0].power);
    shots.push({ power: events[0].power, speed: Math.hypot(game.state.ball.vx, game.state.ball.vy) });
  }
  assert.ok(shots[1].power > 0.98);
  assert.ok(shots[1].speed > shots[0].speed * 1.2, 'a held shot should travel meaningfully faster');
});

test('an early manual lob input stays buffered until a physically reachable contact', () => {
  const game = incomingGame();
  const events = [];
  game.onEvent = (event) => { if (event.type === 'hit') events.push(event); };
  simulate(game, 1.15, { assist: false });
  game.update(1 / 60, { hit: true, lob: true, assist: false });
  assert.equal(game.state.stats.humanShots, 0, 'the racket must not contact an unreachable ball');
  simulate(game, 0.2, { assist: false });
  assert.equal(game.state.stats.humanShots, 1);
  assert.equal(events[0].lob, true, 'the buffered tap must preserve the chosen shot type');
  assert.ok(game.state.ball.vz > 8);
  simulate(game, 0.3, { hit: true, assist: false });
  assert.equal(game.state.stats.humanShots, 1, 'a buffered input cannot create a second consecutive hit');
});

test('a receiver running forward cannot volley a serve before its first bounce', () => {
  const game = makeGame();
  game.state.server = 'ai';
  game._prepareServe();
  const events = [];
  game.onEvent = (event) => events.push(event);
  game._serve();
  simulate(game, 1.3, { moveY: -1, hit: true, assist: false });
  const firstBounce = events.findIndex((event) => event.type === 'bounce');
  const returnHit = events.findIndex((event) => event.type === 'hit' && event.side === 'human');
  assert.ok(firstBounce >= 0 && returnHit > firstBounce);
  assert.equal(game.state.stats.humanShots, 1);
});

test('assistance returns reachable balls automatically while manual mode requires an input', () => {
  for (const assist of [true, false]) {
    const game = makeGame();
    game.state.phase = 'rally';
    const p = game.state.players.human;
    Object.assign(game.state.ball, { x: p.x + 0.2, y: p.y - 0.3, z: 1, vx: 0, vy: 6, vz: -0.2, inPlay: true, bounces: 1, lastHitter: 'ai' });
    game.update(1 / 60, { assist });
    assert.equal(game.state.stats.humanShots, assist ? 1 : 0);
    if (!assist) {
      game.update(1 / 60, { assist, hit: true, lob: true });
      assert.equal(game.state.stats.humanShots, 1);
      assert.ok(game.state.ball.vz > 8, 'a lob launches a higher arc');
    }
  }
});

test('AI movement respects its running speed instead of jumping to the ball', () => {
  const game = makeGame({ difficulty: 'casual' });
  game._serve();
  const before = { x: game.state.players.ai.x, y: game.state.players.ai.y };
  game.state.ball.x = -4;
  simulate(game, 0.5, { assist: false });
  const p = game.state.players.ai;
  assert.ok(Math.hypot(p.x - before.x, p.y - before.y) <= 4.35 * 0.5 + 1e-6);
});

test('movement is bounded, diagonal speed is normalized, and pause freezes simulation', () => {
  const straight = makeGame();
  const diagonal = makeGame();
  straight.state.phase = 'rally';
  diagonal.state.phase = 'rally';
  Object.assign(straight.state.ball, { z: 20, inPlay: false });
  Object.assign(diagonal.state.ball, { z: 20, inPlay: false });
  simulate(straight, 0.5, { moveX: 1, assist: false });
  simulate(diagonal, 0.5, { moveX: 1, moveY: -1, assist: false });
  assert.ok(Math.hypot(diagonal.state.players.human.vx, diagonal.state.players.human.vy) <= 6.16);
  straight.pause();
  const before = JSON.stringify(straight.state);
  straight.update(1, { moveX: 1, hit: true });
  assert.equal(JSON.stringify(straight.state), before);
  straight.resume();
  assert.equal(straight.state.phase, 'rally');
  simulate(straight, 3, { moveX: 1, moveY: 1, assist: false });
  assert.ok(straight.state.players.human.x <= 5.7);
  assert.ok(straight.state.players.human.y <= 13.7);
});

test('fixed physics gives matching results at 30, 60 and 144 FPS', () => {
  const games = [30, 60, 144].map((fps) => {
    const game = makeGame();
    game._serve();
    simulate(game, 0.75, { moveX: -0.4, assist: false }, 1 / fps);
    return game;
  });
  for (const game of games.slice(1)) {
    for (const key of ['x', 'y', 'z', 'vx', 'vy', 'vz']) assert.ok(Math.abs(game.state.ball[key] - games[0].state.ball[key]) < 1e-8, key);
    assert.ok(Math.abs(game.state.players.human.x - games[0].state.players.human.x) < 1e-8);
  }
});

// This test player only reads the court and sends ordinary controls. Its own
// forecast chooses where to run; points and contact are resolved by the game.
function receivingTarget(state) {
  const player = state.players.human;
  const ball = { ...state.ball };
  let target = { x: ball.x, y: 10 };
  for (let time = 0; time < 3.7; time += 1 / 120) {
    ball.x += ball.vx / 120;
    ball.y += ball.vy / 120;
    ball.z += ball.vz / 120 - 9.81 / 28800;
    ball.vz -= 9.81 / 120;
    if (ball.z <= 0.033 && ball.vz < 0) {
      if (++ball.bounces >= 2) break;
      ball.z = 0.033;
      ball.vz = Math.abs(ball.vz) * 0.68;
      ball.vx *= 0.91;
      ball.vy *= 0.91;
    }
    if (ball.y < 1 || ball.y > 13.2 || ball.z < 0.45 || ball.z > 1.7) continue;
    if (state.rally === 1 && ball.bounces === 0) continue;
    target = { x: ball.x, y: ball.y };
    if (Math.hypot(ball.x - player.x, ball.y - player.y) <= 6.15 * Math.max(0, time - 0.08) + 1.6) break;
  }
  return target;
}

test('movement and charged shots play complete matches at every difficulty, including long rallies', () => {
  for (const difficulty of ['casual', 'club', 'pro']) {
    let seed = 104;
    const hits = [];
    const points = [];
    const game = makeGame({ difficulty, random: () => ((seed = Math.imul(seed, 1664525) + 1013904223 | 0) >>> 0) / 4294967296, onEvent: (event) => {
      if (event.type === 'hit') hits.push(event);
      if (event.type === 'point') points.push(event);
    } });
    for (let frame = 0; frame < 18000 && game.state.phase !== 'finished'; frame++) {
      const state = game.state;
      const ball = state.ball;
      const player = state.players.human;
      const incoming = state.phase === 'rally' && ball.lastHitter === 'ai';
      const target = incoming ? receivingTarget(state) : { x: 0, y: 10 };
      const swing = incoming && Math.hypot(ball.x - player.x, ball.y - player.y) < 1.7 && ball.z > 0.35 && ball.z < 1.7 && (state.rally > 1 || ball.bounces > 0);
      // Changing direction matters against the faster professional opponent.
      game.update(1 / 60, { pointerMove: true, targetX: target.x, targetY: target.y, hit: state.phase === 'serve', hitHeld: !swing, hitReleased: swing, assist: true, aim: difficulty === 'pro' ? -1 : 0 });
    }
    assert.equal(game.state.phase, 'finished', `${difficulty}: ordinary controls must complete a match`);
    assert.equal(game.state.winner, 'human', `${difficulty}: tactical play can beat the computer`);
    assert.ok(points.length >= 16);
    assert.ok(game.state.stats.aiShots >= 10, 'the computer must return actual shots');
    assert.ok(game.state.stats.distance > 150, 'the test player must run to balls');
    assert.ok(hits.some((event) => event.side === 'human' && !event.serve && event.power > 0.65));
    if (difficulty !== 'casual') assert.ok(game.state.bestRally >= 10, `${difficulty}: both sides must sustain a rally`);
    for (let i = 1; i < hits.length; i++) {
      if (!hits[i].serve) assert.notEqual(hits[i].side, hits[i - 1].side, 'rally contacts must alternate');
    }
  }
});
