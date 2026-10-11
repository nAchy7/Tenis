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
      let bounce;
      game.onEvent = (event) => { if (event.type === 'bounce' && !bounce) bounce = event; };
      game._serve();
      // The serving player can move across the court while the ball is in flight.
      game.state.players[side].x *= -1;
      simulate(game, 1.15, { moveX: -1, assist: false });
      assert.ok(bounce);
      assert.ok(Math.abs(bounce.y) <= COURT.serviceLine);
      assert.equal(game.state.stats.pointsPlayed, 0, 'a valid serve stays valid after server movement');
      const expectedXSign = (pointTotal ? 1 : -1) * (side === 'human' ? 1 : -1);
      assert.equal(Math.sign(bounce.x), expectedXSign);
    }
  }
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
