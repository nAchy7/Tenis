#!/usr/bin/env python3
"""Real WebGL rendering and desktop/mobile input validation for Match Point 3D.

Requires Python Playwright plus Chromium (`python -m pip install playwright`).
Starts the project's local Node server unless --base-url is supplied. Screenshots
and a JSON result are saved outside the checkout to --output. Real rallies use
keyboard input only; controlled ball fixtures exercise score and finish UI.
Headless Chromium uses software WebGL for correctness checks; these checks do
not measure a physical device's frame rate. The portable HTML is also served
over HTTP and must need no scripts, assets, or requests from another origin.
"""
from __future__ import annotations

import argparse
from functools import partial
import http.server
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import threading
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


def rendering_diagnostics(page, expected_mode='court'):
    """Require an actual perspective WebGL scene, and verify the ground raycast."""
    page.wait_for_function("""() => window.__tennisRenderer?.renderer?.info.render.triangles > 0""")
    page.wait_for_function("""() => {
      const r = window.__tennisRenderer, c = r.renderer.domElement.getBoundingClientRect();
      return Math.abs(r.width-c.width)<.5 && Math.abs(r.height-c.height)<.5;
    }""")
    result = page.evaluate("""() => {
      const r = window.__tennisRenderer;
      const gl = r.renderer.getContext();
      const size = r.renderer.domElement.getBoundingClientRect();
      const points = [[-3, 4], [0, 8], [3, 10]].map(([x,y]) => {
        const screen = r.project(x,y,0);
        const ground = r.unproject(screen.x,screen.y);
        return {x,y,screen,ground,error:Math.hypot(ground.x-x,ground.y-y)};
      });
      const corners = [[-5.48,-11.885],[5.48,-11.885],[-5.48,11.885],[5.48,11.885]]
        .map(([x,y]) => r.project(x,y,0));
      return {mode:r.mode,perspective:r.camera?.isPerspectiveCamera === true,
        webgl:r.renderer.isWebGLRenderer === true,
        context:gl.constructor.name,triangles:r.renderer.info.render.triangles,
        calls:r.renderer.info.render.calls,width:size.width,height:size.height,
        contextLost:gl.isContextLost(),points,corners,
        canvasMatches:r.renderer.domElement === document.querySelector('#court')};
    }""")
    assert result['mode'] == expected_mode, result
    assert result['webgl'] and result['perspective'] and result['canvasMatches'], result
    assert result['context'] in ['WebGLRenderingContext', 'WebGL2RenderingContext'], result
    assert result['triangles'] > 100 and result['calls'] > 5, result
    assert not result['contextLost'], result
    assert max(point['error'] for point in result['points']) < .001, result
    # Every doubles-court corner must stay in view on portrait and landscape screens.
    for corner in result['corners']:
        assert -.5 <= corner['x'] <= result['width'] + .5, result
        assert -.5 <= corner['y'] <= result['height'] + .5, result
    assert not page.locator('#webgl-error').is_visible()
    return {key:value for key,value in result.items() if key not in ['points','corners']}


def court_visible_in_viewport(page):
    """An oversized mobile canvas must not hide the opponent outside the screen."""
    result = page.evaluate("""() => {
      const r = window.__tennisRenderer, c = r.renderer.domElement.getBoundingClientRect();
      return {width:innerWidth,height:innerHeight,
        corners:[[-5.48,-11.885],[5.48,-11.885],[-5.48,11.885],[5.48,11.885]].map(([x,y]) => {
          const p = r.project(x,y,0); return {x:p.x+c.left,y:p.y+c.top};
        })};
    }""")
    for corner in result['corners']:
        assert -.5 <= corner['x'] <= result['width']+.5, result
        assert -.5 <= corner['y'] <= result['height']+.5, result


def camera_controls(page, output, prefix, touch=False):
    """Switch both actual cameras through the visible control and the C shortcut."""
    before = snapshot(page)
    original = page.locator('#camera-button').inner_text()
    court = rendering_diagnostics(page)
    (page.locator('#camera-button').tap if touch else page.locator('#camera-button').click)()
    page.wait_for_function("window.__tennisRenderer.mode === 'player'")
    page.wait_for_timeout(200)
    page.screenshot(path=str(output / f'{prefix}-player-camera.png'), full_page=not touch)
    player = rendering_diagnostics(page, 'player')
    assert page.locator('#camera-button').inner_text() != original
    if touch:
        page.locator('#camera-button').tap()
    else:
        page.keyboard.press('c')
    page.wait_for_function("window.__tennisRenderer.mode === 'court'")
    page.wait_for_timeout(150)
    assert page.locator('#camera-button').inner_text() == original
    assert snapshot(page)['score'] == before['score']
    return {'court':court, 'player':player, 'button_and_keyboard':not touch,'touch_button':touch}


def fullscreen_controls(page, output, prefix, fallback=False, touch=False):
    before = snapshot(page)
    if not fallback:
        page.evaluate("""() => {
          window.__fullscreenTransitionDone = false;
          document.addEventListener('fullscreenchange',() => { window.__fullscreenTransitionDone = true; },{once:true});
        }""")
    if touch:
        page.locator('#fullscreen-button').tap()
    else:
        page.keyboard.press('f')
    page.wait_for_function("document.querySelector('#fullscreen-button').getAttribute('aria-pressed') === 'true'")
    if not fallback:
        page.wait_for_function('window.__fullscreenTransitionDone')
    page.wait_for_timeout(180)
    assert page.evaluate("document.documentElement.classList.contains('game-fullscreen')")
    if not fallback:
        assert page.evaluate('Boolean(document.fullscreenElement)')
    else:
        assert page.evaluate('document.fullscreenElement === null')
    no_overflow(page)
    rendering_diagnostics(page)
    canvas = page.locator('#court').bounding_box()
    assert canvas['width'] > page.viewport_size['width'] * .85, canvas
    assert page.locator('#fullscreen-button').is_visible()
    page.screenshot(path=str(output / f'{prefix}-fullscreen.png'), full_page=not touch)
    # Cameras can change while using the full window, including on touch devices.
    (page.locator('#camera-button').tap if touch else page.locator('#camera-button').click)()
    page.wait_for_function("window.__tennisRenderer.mode === 'player'")
    page.wait_for_timeout(200)
    rendering_diagnostics(page, 'player')
    page.screenshot(path=str(output / f'{prefix}-fullscreen-player.png'), full_page=not touch)
    if touch:
        page.locator('#camera-button').tap()
    else:
        page.keyboard.press('c')
    page.wait_for_function("window.__tennisRenderer.mode === 'court'")
    if not fallback:
        page.evaluate("""() => {
          window.__fullscreenTransitionDone = false;
          document.addEventListener('fullscreenchange',() => { window.__fullscreenTransitionDone = true; },{once:true});
        }""")
    (page.locator('#fullscreen-button').tap if touch else page.locator('#fullscreen-button').click)()
    page.wait_for_function("document.querySelector('#fullscreen-button').getAttribute('aria-pressed') === 'false'")
    if not fallback:
        page.wait_for_function('window.__fullscreenTransitionDone')
    assert not page.evaluate("document.documentElement.classList.contains('game-fullscreen')")
    assert snapshot(page)['score'] == before['score']
    assert snapshot(page)['phase'] == before['phase']
    return {'native':not fallback, 'fallback':fallback, 'camera_switch':True, 'score_preserved':True}


def pointer_movement(page, *, touch=False, target=None):
    """Send a real pointer event to a projected world target in either camera."""
    target = target or {'x':-2.7,'y':8}
    location = page.evaluate("""p => {
      const r = window.__tennisRenderer, c = document.querySelector('#court').getBoundingClientRect();
      const screen = r.project(p.x,p.y,0);
      return {x:c.left+screen.x,y:c.top+screen.y};
    }""", target)
    before = snapshot(page)['human']
    before_distance = ((before['x']-target['x'])**2+(before['y']-target['y'])**2)**.5
    if touch:
        cdp = page.context.new_cdp_session(page)
        cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[location]})
    else:
        page.mouse.move(location['x'], location['y'])
        page.mouse.down()
    page.wait_for_function("""({target,distance}) => {
      const p = window.__tennis.state.players.human;
      return Math.hypot(p.x-target.x,p.y-target.y) < distance-.4;
    }""",arg={'target':target,'distance':before_distance})
    if touch:
        cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
        cdp.detach()
    else:
        page.mouse.up()
    after = snapshot(page)['human']
    after_distance = ((after['x']-target['x'])**2+(after['y']-target['y'])**2)**.5
    assert after_distance < before_distance-.4, {'before':before,'after':after,'target':target}
    return {'world_target':target, 'approached_by':round(before_distance-after_distance,3)}


def await_phase(page, phases, timeout=3000):
    page.wait_for_function("phases => phases.includes(window.__tennis.state.phase)", arg=phases, timeout=timeout)


def release(page, pressed):
    for key in list(pressed):
        page.keyboard.up(key)
    pressed.clear()


def follow_real_rally(page, seconds=18):
    """Move via actual keyboard events toward incoming-ball predictions."""
    pressed = set()
    start_time = snapshot(page)['time']
    end = time.monotonic() + seconds * 6
    max_rally = 0
    start_stats = snapshot(page)['stats']
    try:
        while time.monotonic() < end:
            s = snapshot(page)
            if s['time'] - start_time >= seconds:
                break
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
        'simulation_seconds':round(after['time']-start_time,2),
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
    page.screenshot(path=str(output / 'desktop-menu.png'), full_page=True)
    rendering_diagnostics(page)
    no_overflow(page)
    assert page.locator('#menu-overlay').is_visible()

    page.locator('[data-difficulty="pro"]').click()
    assert page.locator('[data-difficulty="pro"]').get_attribute('aria-pressed') == 'true'
    page.locator('[data-difficulty="casual"]').click()
    page.locator('#start-button').click()
    await_phase(page, ['serve'])
    assert not page.locator('#menu-overlay').is_visible()
    assert page.locator('#pause-button').is_enabled()
    assert page.locator('#difficulty-label').inner_text() == 'POHODA'
    cameras = camera_controls(page, output, 'desktop')
    fullscreen = fullscreen_controls(page, output, 'desktop')

    before = snapshot(page)
    page.keyboard.down('ArrowRight')
    page.wait_for_function("x => window.__tennis.state.players.human.x > x + .7", arg=before['human']['x'])
    page.keyboard.up('ArrowRight')
    assert snapshot(page)['human']['x'] > before['human']['x'] + .7, {'before':before,'after':snapshot(page)}
    before_down = snapshot(page)['human']['y']
    page.keyboard.down('ArrowDown')
    page.wait_for_function("y => window.__tennis.state.players.human.y > y + .3",arg=before_down)
    page.keyboard.up('ArrowDown')
    before_up = snapshot(page)['human']['y']
    page.keyboard.down('w')
    page.wait_for_function("y => window.__tennis.state.players.human.y < y - .3",arg=before_up)
    page.keyboard.up('w')
    assert snapshot(page)['human']['y'] < before_up - .3
    pointer_court = pointer_movement(page)
    page.locator('#camera-button').click()
    page.wait_for_function("window.__tennisRenderer.mode === 'player'")
    page.wait_for_timeout(150)
    pointer_player = pointer_movement(page, target={'x':2.7,'y':10})
    page.keyboard.press('c')
    page.wait_for_function("window.__tennisRenderer.mode === 'court'")

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
            'keyboard_pause_resume':True, 'cameras':cameras, 'fullscreen':fullscreen,
            'pointer_court':pointer_court, 'pointer_player':pointer_player, 'console_errors': errors}


def mobile(browser, url, output):
    context = browser.new_context(viewport={'width':390,'height':844}, device_scale_factor=2,
                                  is_mobile=True, has_touch=True)
    # Simulate mobile browsers that have no native Fullscreen API.
    context.add_init_script("""(() => {
      Object.defineProperty(Element.prototype,'requestFullscreen',{value:undefined,configurable:true});
      Object.defineProperty(Element.prototype,'webkitRequestFullscreen',{value:undefined,configurable:true});
    })();""")
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    page.on('dialog', lambda dialog: dialog.accept())
    page.goto(url, wait_until='networkidle')
    page.wait_for_function('window.__tennis?.state')
    page.screenshot(path=str(output / 'mobile-menu.png'))
    rendering_diagnostics(page)
    no_overflow(page)
    page.locator('[data-difficulty="casual"]').tap()
    page.locator('#start-button').tap()
    await_phase(page, ['serve'])
    cameras = camera_controls(page, output, 'mobile',touch=True)
    fullscreen = fullscreen_controls(page, output, 'mobile', fallback=True,touch=True)
    assert page.locator('#touch-hit').is_visible()
    page.locator('#touch-hit').tap()
    await_phase(page, ['rally'])
    pointer_court = pointer_movement(page, touch=True)
    page.locator('#camera-button').tap()
    page.wait_for_function("window.__tennisRenderer.mode === 'player'")
    page.wait_for_timeout(150)
    pointer_player = pointer_movement(page, touch=True, target={'x':2.7,'y':10})
    page.locator('#camera-button').tap()
    page.wait_for_function("window.__tennisRenderer.mode === 'court'")
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
        page.wait_for_timeout(200)
        no_overflow(page)
        rendering_diagnostics(page)
        page.locator('#camera-button').tap()
        page.wait_for_function("window.__tennisRenderer.mode === 'player'")
        page.wait_for_timeout(200)
        page.screenshot(path=str(output / f'mobile-{width}x{height}-player.png'))
        rendering_diagnostics(page, 'player')
        court_visible_in_viewport(page)
        page.locator('#camera-button').tap()
        page.wait_for_function("window.__tennisRenderer.mode === 'court'")
        page.screenshot(path=str(output / f'mobile-{width}x{height}-court.png'))
        rendering_diagnostics(page)
        court_visible_in_viewport(page)
    # A short landscape viewport must still allow starting a match from its menu.
    page.locator('#restart-button').tap()
    await_phase(page,['menu'])
    page.locator('#start-button').scroll_into_view_if_needed()
    start_box = page.locator('#start-button').bounding_box()
    assert start_box['y'] >= -.5 and start_box['y']+start_box['height'] <= page.viewport_size['height']+.5,start_box
    page.screenshot(path=str(output/'mobile-landscape-menu.png'))
    page.locator('#start-button').tap()
    await_phase(page,['serve'])
    rendering_diagnostics(page)
    court_visible_in_viewport(page)
    assert not errors, errors
    context.close()
    return {'touch_serve':True,'pointer_movement':True,'tested_viewports':[[320,568],[390,844],[844,390]],
            'cameras':cameras, 'fullscreen_fallback':fullscreen,
            'landscape_menu_start':True,
            'pointer_court':pointer_court, 'pointer_player':pointer_player, 'console_errors':errors}


def portable(browser, output):
    """Serve the single-file export and reject every additional network request."""
    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    handler = partial(QuietHandler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(('127.0.0.1',0),handler) as server:
        thread = threading.Thread(target=server.serve_forever,daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_address[1]}/play.html'
        context = browser.new_context(viewport={'width':1280,'height':900})
        page = context.new_page()
        errors = []
        requests = []
        page.on('pageerror',lambda error: errors.append(str(error)))
        page.on('console',lambda message: errors.append(message.text) if message.type == 'error' else None)
        page.on('request',lambda request: requests.append(request.url))
        page.goto(url,wait_until='networkidle')
        page.wait_for_function('window.__tennis?.state')
        renderer = rendering_diagnostics(page)
        page.locator('[data-difficulty="casual"]').click()
        page.locator('#start-button').click()
        await_phase(page,['serve'])
        page.keyboard.press('Space')
        await_phase(page,['rally'])
        page.wait_for_timeout(600)
        assert snapshot(page)['stats']['humanShots'] >= 1
        page.locator('#camera-button').click()
        page.wait_for_function("window.__tennisRenderer.mode === 'player'")
        page.wait_for_timeout(200)
        rendering_diagnostics(page,'player')
        page.screenshot(path=str(output/'portable-player-camera.png'),full_page=True)
        assert requests == [url], requests
        assert not errors, errors
        context.close()
        server.shutdown()
        return {'single_html_only':True,'requests':requests,'webgl':renderer,'console_errors':errors}


def unavailable_gpu(browser,url):
    """An unavailable GPU must explain the problem and never start a fake 3D game."""
    context = browser.new_context(viewport={'width':1280,'height':900})
    context.add_init_script("""(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      window.__courtContexts = [];
      HTMLCanvasElement.prototype.getContext = function(type,...options) {
        if (this.id === 'court') {
          window.__courtContexts.push(type);
          if (/webgl/.test(type)) return null;
        }
        return original.call(this,type,...options);
      };
    })();""")
    page = context.new_page()
    page.goto(url,wait_until='networkidle')
    assert page.locator('#webgl-error').is_visible()
    assert page.locator('#start-button').is_disabled()
    assert page.evaluate('window.__tennis.state.phase') == 'menu'
    contexts = page.evaluate('window.__courtContexts')
    assert any('webgl' in name for name in contexts), contexts
    assert '2d' not in contexts, contexts
    context.close()
    return {'unsupported_gpu_message':True,'start_disabled':True,'no_2d_fallback':True}


def fullscreen_held_key_regression(browser,url):
    """A late native fullscreenchange must preserve a movement key held meanwhile."""
    context = browser.new_context(viewport={'width':1280,'height':900})
    page = context.new_page()
    page.goto(url,wait_until='networkidle')
    page.wait_for_function('window.__tennisRenderer?.renderer?.info.render.triangles > 0')
    page.locator('#start-button').click()
    await_phase(page,['serve'])
    page.evaluate("""() => {
      window.__fullscreenTransitionDone = false;
      document.addEventListener('fullscreenchange',() => { window.__fullscreenTransitionDone = true; },{once:true});
    }""")
    page.locator('#fullscreen-button').click()
    page.wait_for_function('window.__fullscreenTransitionDone')
    assert page.evaluate('Boolean(document.fullscreenElement)')
    before = snapshot(page)
    page.evaluate("""() => {
      window.__fullscreenTransitionDone = false;
      document.addEventListener('fullscreenchange',() => { window.__fullscreenTransitionDone = true; },{once:true});
    }""")
    page.keyboard.down('ArrowRight')
    page.locator('#fullscreen-button').click()
    page.wait_for_function('window.__fullscreenTransitionDone')
    assert page.evaluate('document.fullscreenElement === null')
    page.wait_for_function("x => window.__tennis.state.players.human.x > x + .5",arg=before['human']['x'])
    page.keyboard.up('ArrowRight')
    after = snapshot(page)
    assert after['phase'] == 'serve' and after['score'] == before['score'],after
    context.close()
    return {'held_key_survives_native_exit':True,'moved':round(after['human']['x']-before['human']['x'],3)}


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
            options = {'headless':True,'args':['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']}
            if args.browser:
                options['executable_path'] = args.browser
            browser = p.chromium.launch(**options)
            result = {'desktop':desktop(browser,url,output), 'mobile':mobile(browser,url,output),
                      'portable':portable(browser,output),
                      'unavailable_gpu':unavailable_gpu(browser,url),
                      'fullscreen_held_key':fullscreen_held_key_regression(browser,url),
                      'gpu_validation':'software WebGL; device performance is not inferred'}
            browser.close()
            (output / 'results.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
            print(json.dumps(result,indent=2))
    finally:
        if server:
            server.terminate()
            server.wait(timeout=5)


if __name__ == '__main__':
    main()
