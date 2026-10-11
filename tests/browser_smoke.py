#!/usr/bin/env python3
"""Real desktop/mobile input validation for Match Point.

Requires Python Playwright plus Chromium (`python -m pip install playwright`).
Starts the project's local Node server unless --base-url is supplied. Screenshots
and a JSON result are saved outside the checkout to --output. Real rallies use
keyboard input only; controlled ball fixtures exercise score and finish UI.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def snapshot(page):
    return page.evaluate("""() => {
      const game = window.__tennis;
      const s = game.state;
      const p = s.players.human;
      const target = s.phase === 'rally' && s.ball.lastHitter === 'ai'
        ? game._predictArrival('human') : { x: 0, y: 10 };
      return {phase:s.phase,time:s.time,human:{x:p.x,y:p.y},target,
        lastHitter:s.ball.lastHitter,rally:s.rally,bestRally:s.bestRally,
        score:s.score,stats:s.stats,server:s.server};
    }""")


def no_overflow(page):
    metrics = page.evaluate("""() => ({width:innerWidth,
      document:document.documentElement.scrollWidth,body:document.body.scrollWidth})""")
    assert max(metrics['document'], metrics['body']) <= metrics['width'] + 1, metrics


def await_phase(page, phases, timeout=3000):
    page.wait_for_function("phases => phases.includes(window.__tennis.state.phase)", arg=phases, timeout=timeout)


def release(page, pressed):
    for key in list(pressed):
        page.keyboard.up(key)
    pressed.clear()


def follow_real_rally(page, seconds=18):
    """Move via actual keyboard events toward incoming-ball predictions."""
    pressed = set()
    end = time.monotonic() + seconds
    max_rally = 0
    start_stats = snapshot(page)['stats']
    try:
        while time.monotonic() < end:
            s = snapshot(page)
            max_rally = max(max_rally, s['rally'])
            wanted = set()
            if s['phase'] == 'serve' and s['server'] == 'human':
                page.keyboard.press('Space')
            if s['phase'] == 'rally':
                dx = s['target']['x'] - s['human']['x']
                dy = s['target']['y'] - s['human']['y']
                if dx > .22:
                    wanted.add('ArrowRight')
                elif dx < -.22:
                    wanted.add('ArrowLeft')
                if dy > .22:
                    wanted.add('ArrowDown')
                elif dy < -.22:
                    wanted.add('ArrowUp')
            for key in pressed - wanted:
                page.keyboard.up(key)
            for key in wanted - pressed:
                page.keyboard.down(key)
            pressed = wanted
            page.wait_for_timeout(35)
    finally:
        release(page, pressed)
    after = snapshot(page)
    result = {
        'largest_real_rally': max_rally,
        'human_shots': after['stats']['humanShots'] - start_stats['humanShots'],
        'ai_shots': after['stats']['aiShots'] - start_stats['aiShots'],
        'naturally_played_points': after['stats']['pointsPlayed'],
    }
    assert result['largest_real_rally'] >= 5, result
    assert result['human_shots'] >= 2 and result['ai_shots'] >= 2, result
    return result


def score_fixture(page, *, reset_score=False):
    """Place a legal human shot at its second bounce; physics awards the point."""
    page.evaluate("""resetScore => {
      const game = window.__tennis;
      const s = game.state;
      s.phase = 'rally';
      if (resetScore) { s.score.points = [0, 0]; s.score.games = [0, 0]; }
      s.tiebreak = false;
      game._serveShot = false;
      Object.assign(s.ball, {x:0,y:-5,z:.034,vx:0,vy:0,vz:-1,
        inPlay:true,bounces:1,lastHitter:'human',trail:[]});
    }""", reset_score)


def desktop(browser, url, output):
    context = browser.new_context(viewport={'width':1440,'height':1050}, device_scale_factor=1)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    page.on('dialog', lambda dialog: dialog.accept())
    page.goto(url, wait_until='networkidle')
    page.wait_for_function('window.__tennis?.state')
    no_overflow(page)
    assert page.locator('#menu-overlay').is_visible()
    page.screenshot(path=str(output / 'desktop-menu.png'), full_page=True)

    page.locator('[data-difficulty="pro"]').click()
    assert page.locator('[data-difficulty="pro"]').get_attribute('aria-pressed') == 'true'
    page.locator('[data-difficulty="casual"]').click()
    page.locator('#start-button').click()
    await_phase(page, ['serve'])
    assert not page.locator('#menu-overlay').is_visible()
    assert page.locator('#pause-button').is_enabled()
    assert page.locator('#difficulty-label').inner_text() == 'POHODA'

    before = snapshot(page)
    page.keyboard.down('ArrowRight')
    page.wait_for_timeout(320)
    page.keyboard.up('ArrowRight')
    assert snapshot(page)['human']['x'] > before['human']['x'] + .7
    page.keyboard.down('ArrowDown')
    page.wait_for_timeout(220)
    page.keyboard.up('ArrowDown')
    before_up = snapshot(page)['human']['y']
    page.keyboard.down('w')
    page.wait_for_timeout(550)
    page.keyboard.up('w')
    assert snapshot(page)['human']['y'] < before_up - .3

    page.locator('#restart-button').click()
    await_phase(page, ['menu'])
    page.locator('#start-button').click()
    await_phase(page, ['serve'])
    assert snapshot(page)['stats']['shots'] == 0
    page.keyboard.press('Space')
    await_phase(page, ['rally'])
    page.keyboard.press('p')
    await_phase(page, ['paused'])
    assert page.locator('#pause-overlay').is_visible()
    paused_time = snapshot(page)['time']
    page.wait_for_timeout(300)
    assert snapshot(page)['time'] == paused_time
    page.locator('#resume-button').click()
    await_phase(page, ['rally', 'point', 'serve'])
    page.locator('#pause-button').click()
    await_phase(page, ['paused'])
    page.keyboard.press('Escape')
    await_phase(page, ['rally', 'point', 'serve'])

    page.locator('#help-button').click()
    assert page.locator('#help-dialog').is_visible()
    page.locator('#help-done').click()
    assert not page.locator('#help-dialog').is_visible()
    await_phase(page, ['rally', 'point', 'serve'])
    original_sound = page.locator('#sound-label').inner_text()
    page.locator('#sound-button').click()
    page.wait_for_function("original => document.querySelector('#sound-label').textContent !== original", arg=original_sound)
    page.locator('#sound-button').click()
    assert page.locator('#sound-label').inner_text() == original_sound
    page.locator('#assist-toggle').uncheck(force=True)
    assert not page.locator('#assist-toggle').is_checked()
    assert page.evaluate('document.activeElement.id') == 'court'
    page.evaluate("""() => {
      document.querySelector('#court').focus();
      const g = window.__tennis, s = g.state;
      s.phase = 'rally'; s.players.human.x = 0; s.players.human.y = 8;
      g._swingCooldown.human = 0; g._hitBuffer = 0; g._serveShot = false;
      Object.assign(s.ball, {x:.2,y:8.5,z:.9,vx:0,vy:4,vz:0,
        inPlay:true,bounces:1,lastHitter:'ai',trail:[]});
    }""")
    before_lob = snapshot(page)['stats']['humanShots']
    page.keyboard.down('l')
    page.wait_for_function("shots => window.__tennis.state.stats.humanShots > shots", arg=before_lob)
    assert page.evaluate('window.__tennis.state.ball.vz') > 6
    page.keyboard.up('l')
    page.locator('#assist-toggle').check(force=True)
    assert page.evaluate('document.activeElement.id') == 'court'

    page.locator('#restart-button').click()
    await_phase(page, ['menu'])
    page.locator('#start-button').click()
    await_phase(page, ['serve'])
    rally = follow_real_rally(page)
    page.screenshot(path=str(output / 'desktop-rally.png'), full_page=True)
    # Deliberately leave the ball to validate natural score progression.
    initial_points = snapshot(page)['stats']['pointsPlayed']
    page.keyboard.down('ArrowRight')
    page.keyboard.down('ArrowDown')
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline and snapshot(page)['stats']['pointsPlayed'] == initial_points:
        if snapshot(page)['phase'] == 'serve':
            page.keyboard.press('Space')
        page.wait_for_timeout(50)
    page.keyboard.up('ArrowRight')
    page.keyboard.up('ArrowDown')
    assert snapshot(page)['stats']['pointsPlayed'] > initial_points, snapshot(page)

    page.locator('#restart-button').click()
    await_phase(page, ['menu'])
    page.locator('#start-button').click()
    await_phase(page, ['serve'])
    # Play every scoring transition of a complete 4:0 set with legal second bounces.
    for point in range(1, 17):
        score_fixture(page)
        await_phase(page, ['finished'] if point == 16 else ['point'])
        label = ['0', '15', '30', '40'][point % 4]
        page.wait_for_function("label => document.querySelector('#human-points').textContent === label", arg=label)
        assert snapshot(page)['score']['games'][0] == point // 4
    await_phase(page, ['finished'])
    assert page.locator('#finish-overlay').is_visible()
    assert page.locator('#human-games').inner_text() == '4'
    assert page.locator('#won-stat').inner_text() == '16'
    page.screenshot(path=str(output / 'desktop-finish.png'), full_page=True)
    page.locator('#again-button').click()
    await_phase(page, ['serve'])
    assert snapshot(page)['score']['games'] == [0, 0]
    assert not page.locator('#finish-overlay').is_visible()
    no_overflow(page)
    assert not errors, errors
    context.close()
    return {**rally, 'natural_point_scored': True, 'complete_controlled_set': '4:0', 'manual_lob_assist_off':True,
            'keyboard_pause_resume':True, 'console_errors': errors}


def mobile(browser, url, output):
    context = browser.new_context(viewport={'width':390,'height':844}, device_scale_factor=2,
                                  is_mobile=True, has_touch=True)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    page.on('dialog', lambda dialog: dialog.accept())
    page.goto(url, wait_until='networkidle')
    page.wait_for_function('window.__tennis?.state')
    no_overflow(page)
    page.screenshot(path=str(output / 'mobile-menu.png'))
    page.locator('[data-difficulty="casual"]').tap()
    page.locator('#start-button').tap()
    await_phase(page, ['serve'])
    assert page.locator('#touch-hit').is_visible()
    page.locator('#touch-hit').tap()
    await_phase(page, ['rally'])
    box = page.locator('#court').bounding_box()
    before = snapshot(page)['human']['x']
    # A held touch-style pointer moves the human without involving control buttons.
    cdp = context.new_cdp_session(page)
    cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{
        'x':box['x'] + box['width']*.25,'y':box['y'] + box['height']*.8}]})
    page.wait_for_timeout(450)
    cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
    assert snapshot(page)['human']['x'] < before - .4, snapshot(page)
    page.locator('#touch-lob').tap()
    page.screenshot(path=str(output / 'mobile-play.png'))
    page.locator('#pause-button').tap()
    await_phase(page, ['paused'])
    page.locator('#resume-button').tap()
    await_phase(page, ['rally', 'point', 'serve'])
    page.locator('#help-button').tap()
    assert page.locator('#help-dialog').is_visible()
    page.locator('#help-done').tap()
    no_overflow(page)
    for width, height in [(320,568),(390,844),(844,390)]:
        page.set_viewport_size({'width':width,'height':height})
        page.wait_for_timeout(80)
        no_overflow(page)
    assert not errors, errors
    context.close()
    return {'touch_serve':True,'pointer_movement':True,'tested_viewports':[[320,568],[390,844],[844,390]],
            'console_errors':errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url')
    parser.add_argument('--output', default='/tmp/tenis-validation')
    parser.add_argument('--browser', default=shutil.which('chromium'))
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    server = None
    url = args.base_url
    if not url:
        with socket.socket() as s:
            s.bind(('127.0.0.1',0))
            port = s.getsockname()[1]
        env = os.environ.copy()
        env['PORT'] = str(port)
        server = subprocess.Popen(['node','server.js'], cwd=ROOT, env=env,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        url = f'http://127.0.0.1:{port}'
        for _ in range(60):
            try:
                with urllib.request.urlopen(url, timeout=.5):
                    break
            except OSError:
                time.sleep(.1)
        else:
            server.terminate()
            raise RuntimeError('Local server did not become ready')
    try:
        with sync_playwright() as p:
            options = {'headless':True,'args':['--no-sandbox']}
            if args.browser:
                options['executable_path'] = args.browser
            browser = p.chromium.launch(**options)
            result = {'desktop':desktop(browser,url,output), 'mobile':mobile(browser,url,output)}
            browser.close()
            (output / 'results.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
            print(json.dumps(result,indent=2))
    finally:
        if server:
            server.terminate()
            server.wait(timeout=5)


if __name__ == '__main__':
    main()
