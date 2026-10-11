import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const UP = new THREE.Vector3(0, 1, 0);
const toWorld = (p) => new THREE.Vector3(p.x, p.z ?? 0, p.y);
const ground = (x, y, z = .025) => new THREE.Vector3(x, z, y);

function canvasTexture(width, height, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Batched scene construction keeps the arena inexpensive even on a phone. */
class Architecture {
  constructor(scene) { this.scene = scene; this.buckets = new Map(); this.dummy = new THREE.Object3D(); }
  add(geometry, material, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, castShadow = false) {
    const d = this.dummy;
    d.position.set(x, y, z); d.rotation.set(0, ry, 0); d.scale.set(sx, sy, sz); d.updateMatrix();
    const transformed = geometry.clone().applyMatrix4(d.matrix);
    const key = `${material.uuid}:${castShadow}`;
    if (!this.buckets.has(key)) this.buckets.set(key, { material, castShadow, geometries: [] });
    this.buckets.get(key).geometries.push(transformed);
  }
  box(material, x, y, z, sx, sy, sz, ry = 0, castShadow = false) {
    this.add(this.boxGeometry ||= new THREE.BoxGeometry(1, 1, 1), material, x, y, z, sx, sy, sz, ry, castShadow);
  }
  finish() {
    for (const { geometries, material, castShadow } of this.buckets.values()) {
      const merged = mergeGeometries(geometries, false);
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = castShadow; mesh.receiveShadow = true;
      this.scene.add(mesh);
      for (const geometry of geometries) geometry.dispose();
    }
    this.boxGeometry?.dispose(); this.buckets.clear();
  }
}

class Instances {
  constructor(scene, geometry, material, count, castShadow = true) {
    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = castShadow; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.dummy = new THREE.Object3D(); this.count = 0;
    scene.add(this.mesh);
  }
  begin() { this.count = 0; }
  add(position, scale, quaternion = null) {
    const d = this.dummy;
    d.position.copy(position); d.scale.copy(scale);
    if (quaternion) d.quaternion.copy(quaternion); else d.quaternion.identity();
    d.updateMatrix(); this.mesh.setMatrixAt(this.count++, d.matrix);
  }
  segment(a, b, radius) {
    const direction = new THREE.Vector3().subVectors(b, a);
    this.add(new THREE.Vector3().addVectors(a, b).multiplyScalar(.5), new THREE.Vector3(radius, direction.length(), radius), new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize()));
  }
  finish() { this.mesh.count = this.count; this.mesh.instanceMatrix.needsUpdate = true; }
}

/** A genuine WebGL court, with the simulation's x/y plane mapped to Three's x/z. */
export class TennisRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.width = 1; this.height = 1; this.mode = 'player'; this.clock = 0;
    this.modes = Object.freeze(['player', 'first-person', 'court']);
    this.cameraInfo = { eyeHeight: 2.12, followDistance: 1.45, behindDistance: 1.35, target: null };
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#c8ddd8');
    this.scene.fog = new THREE.Fog('#c8ddd8', 40, 102);
    this.camera = new THREE.PerspectiveCamera(43, 1, .1, 150);
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(UP, 0);
    this.pointerVector = new THREE.Vector2();
    this.projectVector = new THREE.Vector3();
    this.materials = []; this.textures = [];
    this.events = []; this.contacts = { human: null, ai: null };
    this.lastStateTime = -1; this.cameraReady = false; this.lastState = null;
    this.cameraYaw = null; this.cameraPitch = null;
    this._createLights(); this._createArena(); this._createPlayers(); this._createBallAndGuides();
    this.resize(canvas.clientWidth || 900, canvas.clientHeight || 650, window.devicePixelRatio || 1);
  }

  _mat(color, options = {}) {
    const material = new THREE.MeshStandardMaterial({ color, roughness: .85, ...options });
    this.materials.push(material); return material;
  }

  _texture(width, height, paint) { const texture = canvasTexture(width, height, paint); this.textures.push(texture); return texture; }

  _createLights() {
    this.scene.add(new THREE.HemisphereLight('#eaf8ff', '#9c714f', 2.25));
    this.sun = new THREE.DirectionalLight('#fff4d7', 3.2);
    this.sun.position.set(-9, 24, 11); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1536, 1536);
    Object.assign(this.sun.shadow.camera, { left: -17, right: 17, top: 19, bottom: -19, near: 1, far: 65 });
    this.sun.shadow.bias = -.00035; this.sun.shadow.normalBias = .025;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun); this.scene.add(this.sun.target);
  }

  _createArena() {
    const a = new Architecture(this.scene);
    const darkGreen = this._mat('#183f34');
    const rail = this._mat('#456052', { metalness: .2, roughness: .65 });
    const stone = this._mat('#d4d0b8');
    const bleacher = this._mat('#747e68');
    const seat = this._mat('#476c55');
    const line = this._mat('#fff5dc');
    const grass = this._mat('#647e58');
    const clayTexture = this._texture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#b86043'; ctx.fillRect(0, 0, w, h);
      let seed = 19;
      for (let i = 0; i < 4800; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const x = seed % w; seed = (seed * 1664525 + 1013904223) >>> 0;
        ctx.fillStyle = i % 3 ? '#c779552e' : '#92492d22';
        ctx.fillRect(x, seed % h, 1, 1);
      }
    });
    clayTexture.wrapS = clayTexture.wrapT = THREE.RepeatWrapping;
    clayTexture.repeat.set(10, 19); clayTexture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    const clay = this._mat('#fff5ee', { map: clayTexture });
    a.box(grass, 0, -.2, 0, 160, .3, 160);
    a.box(stone, 0, -.055, 0, 20, .12, 36.2);
    a.box(clay, 0, .005, 0, 16.5, .06, 33);
    // Regulation doubles outline, singles alleys, service boxes and centre marks.
    for (const x of [-5.48, 5.48, -4.115, 4.115]) a.box(line, x, .045, 0, .07, .012, 23.84);
    for (const z of [-11.885, 11.885]) a.box(line, 0, .045, z, 11.03, .012, .075);
    for (const z of [-6.4, 6.4]) a.box(line, 0, .045, z, 8.23, .012, .065);
    a.box(line, 0, .045, 0, .06, .012, 12.8);
    for (const z of [-11.64, 11.64]) a.box(line, 0, .045, z, .065, .012, .5);
    // Light fencing allows an open view while setting the court in a real arena.
    for (const side of [-1, 1]) {
      a.box(darkGreen, side * 8.75, .35, 0, .14, .7, 34.7);
      for (let z = -17.2; z <= 17.3; z += 2.46) {
        a.box(rail, side * 8.78, 1.5, z, .08, 3, .08);
      }
      for (const y of [.8, 2.9]) a.box(rail, side * 8.78, y, 0, .06, .06, 34.4);
      a.box(darkGreen, 0, .55, side * 17.4, 17.7, 1.1, .18);
      for (let x = -8.75; x <= 8.8; x += 2.5) a.box(rail, x, 1.5, side * 17.4, .08, 3, .08);
      a.box(rail, 0, 2.9, side * 17.4, 17.7, .06, .06);
      // Stands are deliberately beyond the sidelines, with clear player silhouettes.
      for (let row = 0; row < 4; row++) {
        const x = side * (10.35 + row * .7), y = .25 + row * .48;
        a.box(bleacher, x, y, -2.4, .8, .35, 25);
        a.box(seat, x - side * .16, y + .24, -2.4, .5, .12, 24.7);
        a.box(seat, x + side * .16, y + .46, -2.4, .1, .47, 24.7);
      }
      a.box(stone, side * 11.5, .08, -2.5, 4, .18, 25.5);
      // Tall floodlights and clipped evergreens give the stadium a readable skyline.
      for (const z of [-16, 13]) {
        a.box(rail, side * 10.2, 5.6, z, .18, 11.2, .18);
        a.box(stone, side * 10.2, 11.1, z, 1.8, .45, .38);
      }
    }
    a.finish();

    // A transparent mesh net has visible strings and a gently sagging white tape.
    const netTexture = this._texture(256, 128, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h); ctx.strokeStyle = '#213b32'; ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 16) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = 0; y <= h; y += 16) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
    });
    netTexture.wrapS = netTexture.wrapT = THREE.RepeatWrapping; netTexture.repeat.set(7.8, 1.1);
    const netMaterial = this._mat('#ffffff', { map: netTexture, transparent: true, alphaTest: .08, side: THREE.DoubleSide, depthWrite: false });
    const net = new THREE.Mesh(new THREE.PlaneGeometry(11.9, .9, 20, 1), netMaterial);
    const positions = net.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i);
      if (y > 0) positions.setY(i, y + .16 * Math.pow(x / 5.95, 2));
    }
    positions.needsUpdate = true; net.position.y = .48; this.scene.add(net);
    const top = new THREE.CatmullRomCurve3(Array.from({ length: 17 }, (_, i) => {
      const x = -5.95 + i * 11.9 / 16; return new THREE.Vector3(x, .93 + .16 * Math.pow(x / 5.95, 2), 0);
    }));
    const tape = new THREE.Mesh(new THREE.TubeGeometry(top, 32, .037, 5, false), line);
    tape.castShadow = true; this.scene.add(tape);
    const postGeometry = new THREE.CylinderGeometry(.065, .065, 1.18, 10);
    for (const x of [-5.95, 5.95]) {
      const post = new THREE.Mesh(postGeometry, darkGreen); post.position.set(x, .59, 0); post.castShadow = true; this.scene.add(post);
    }
    const strap = new THREE.Mesh(new THREE.BoxGeometry(.045, .92, .045), line); strap.position.y = .47; this.scene.add(strap);

    const fenceMaterial = this._mat('#365545', { map: netTexture, transparent: true, alphaTest: .1, opacity: .48, side: THREE.DoubleSide, depthWrite: false });
    const fences = new Architecture(this.scene);
    const fenceGeometry = new THREE.PlaneGeometry(1, 1);
    for (const side of [-1, 1]) {
      fences.add(fenceGeometry, fenceMaterial, side * 8.77, 1.9, 0, 34.4, 2.1, 1, Math.PI / 2);
      fences.add(fenceGeometry, fenceMaterial, 0, 2, side * 17.39, 17.5, 1.8, 1);
    }
    fences.finish(); fenceGeometry.dispose();
    this._createCrowd(); this._createTrees(); this._createBanners();
  }

  _createCrowd() {
    const bodyGeometry = new THREE.CapsuleGeometry(.13, .29, 2, 5);
    const bodyMaterial = this._mat('#ffffff');
    const headGeometry = new THREE.SphereGeometry(.105, 6, 5);
    const headMaterial = this._mat('#bf9678');
    const count = 224;
    const bodies = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, count);
    const heads = new THREE.InstancedMesh(headGeometry, headMaterial, count);
    const dummy = new THREE.Object3D(); const palette = ['#f1dfbf', '#497967', '#d89076', '#547fa0', '#e6be5c', '#718460'];
    let index = 0;
    for (const side of [-1, 1]) for (let row = 0; row < 4; row++) for (let column = 0; column < 28; column++) {
      const x = side * (10.25 + row * .7), z = -14.2 + column * .87, y = .76 + row * .48;
      dummy.position.set(x, y, z); dummy.rotation.set(0, -side * Math.PI / 2, 0); dummy.updateMatrix(); bodies.setMatrixAt(index, dummy.matrix);
      bodies.setColorAt(index, new THREE.Color(palette[(column * 7 + row * 3 + (side + 1)) % palette.length]));
      dummy.position.y += .34; dummy.updateMatrix(); heads.setMatrixAt(index++, dummy.matrix);
    }
    this.scene.add(bodies, heads);
  }

  _createTrees() {
    const trunkMaterial = this._mat('#675b40'); const foliageMaterial = this._mat('#ffffff');
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.2, .32, 4, 5), trunkMaterial, 30);
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), foliageMaterial, 30);
    const d = new THREE.Object3D();
    for (let i = 0; i < 30; i++) {
      const angle = Math.PI + i * Math.PI / 29, radius = 31 + Math.sin(i * 7) * 5;
      d.position.set(Math.cos(angle) * radius, 2, Math.sin(angle) * radius); d.scale.set(1, 1, 1); d.updateMatrix(); trunks.setMatrixAt(i, d.matrix);
      d.position.y = 5.1 + Math.sin(i * 3) * .7; d.scale.set(2.3, 3 + (i % 3) * .5, 2.1); d.rotation.y = i; d.updateMatrix(); crowns.setMatrixAt(i, d.matrix);
      crowns.setColorAt(i, new THREE.Color(i % 3 === 0 ? '#4f7555' : '#3d6249'));
    }
    this.scene.add(trunks, crowns);
  }

  _createBanners() {
    const texture = this._texture(1024, 128, (ctx, w, h) => {
      ctx.fillStyle = '#173c31'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#e0e99a'; ctx.font = '700 53px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('MATCH POINT', w / 2, h / 2);
      ctx.strokeStyle = '#90aa73'; ctx.lineWidth = 2; ctx.strokeRect(6, 6, w - 12, h - 12);
      for (const x of [98, w - 98]) { ctx.beginPath(); ctx.arc(x, h / 2, 18, 0, Math.PI * 2); ctx.stroke(); }
    });
    const material = this._mat('#ffffff', { map: texture, side: THREE.DoubleSide });
    const geometry = new THREE.PlaneGeometry(8, .9);
    for (const z of [-17.28, 17.28]) { const banner = new THREE.Mesh(geometry, material); banner.position.set(0, .63, z); this.scene.add(banner); }
  }

  _createPlayers() {
    this.skinMaterial = this._mat('#dcab86');
    this.skinLimbs = new Instances(this.scene, new THREE.CylinderGeometry(1, .87, 1, 8), this.skinMaterial, 20);
    this.skinJoints = new Instances(this.scene, new THREE.SphereGeometry(1, 8, 6), this.skinMaterial, 20);
    this.socks = new Instances(this.scene, new THREE.CylinderGeometry(1, 1, 1, 8), this._mat('#f2f1dc'), 4);
    this.shoes = new Instances(this.scene, new THREE.BoxGeometry(1, 1, 1), this._mat('#f8f6e9'), 4);
    this.playerModels = {};
    const hair = this._mat('#33392e'); const shorts = this._mat('#f0efde');
    const frame = this._mat('#2d453d', { roughness: .42 }); const racketAccent = this._mat('#dcf083', { roughness: .5 });
    const strings = new THREE.LineBasicMaterial({ color: '#e4e8bc', transparent: true, opacity: .75 }); this.materials.push(strings);
    const stringVertices = [];
    for (let i = -3; i <= 3; i++) {
      const x = i * .065, halfHeight = .35 * Math.sqrt(1 - Math.pow(x / .28, 2));
      stringVertices.push(x, -halfHeight, 0, x, halfHeight, 0);
      const y = i * .083, halfWidth = .28 * Math.sqrt(1 - Math.pow(y / .35, 2));
      stringVertices.push(-halfWidth, y, 0, halfWidth, y, 0);
    }
    const stringGeometry = new THREE.BufferGeometry(); stringGeometry.setAttribute('position', new THREE.Float32BufferAttribute(stringVertices, 3));
    for (const side of ['human', 'ai']) {
      const root = new THREE.Group(); root.rotation.y = side === 'ai' ? Math.PI : 0; this.scene.add(root);
      const shirt = this._mat(side === 'human' ? '#62b8e8' : '#ef987c');
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(.285, .225, .66, 10), shirt); torso.scale.z = .69; torso.position.y = 1.21; torso.castShadow = true; root.add(torso);
      const pants = new THREE.Mesh(new THREE.CylinderGeometry(.245, .27, .29, 10), shorts); pants.scale.z = .7; pants.position.y = .765; pants.castShadow = true; root.add(pants);
      const head = new THREE.Mesh(new THREE.SphereGeometry(.18, 12, 9), this.skinMaterial); head.scale.set(.9, 1.1, .88); head.position.y = 1.77; head.castShadow = true; root.add(head);
      const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(.185, 10, 6, 0, Math.PI * 2, 0, Math.PI * .55), side === 'human' ? shirt : hair);
      hairMesh.position.y = 1.815; hairMesh.scale.set(.93, .82, .93); root.add(hairMesh);
      if (side === 'human') {
        const visor = new THREE.Mesh(new THREE.BoxGeometry(.29, .035, .17), shirt); visor.position.set(0, 1.88, -.18); root.add(visor);
      }
      const racket = new THREE.Group(); this.scene.add(racket);
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(.28, .021, 6, 22), frame); hoop.scale.y = 1.25; racket.add(hoop);
      const accent = new THREE.Mesh(new THREE.TorusGeometry(.261, .007, 4, 22), racketAccent); accent.scale.y = 1.25; racket.add(accent);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(.028, .031, .35, 7), frame); handle.position.y = -.52; racket.add(handle);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.014, .019, .19, 7), racketAccent); shaft.position.y = -.325; racket.add(shaft);
      racket.add(new THREE.LineSegments(stringGeometry, strings));
      this.playerModels[side] = { root, torso, pants, head, hairMesh, racket, step: 0 };
    }
  }

  _createBallAndGuides() {
    const ballMaterial = this._mat('#effd4c', { roughness: .74, emissive: '#647808', emissiveIntensity: .22 });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(.13, 14, 10), ballMaterial); this.scene.add(this.ball);
    // The white tennis seam follows the sphere and remains useful at close range.
    const seamPoints = [];
    for (let i = 0; i <= 80; i++) {
      const angle = i / 80 * Math.PI * 2, latitude = .52 * Math.sin(angle * 2);
      seamPoints.push(new THREE.Vector3(.132 * Math.cos(latitude) * Math.cos(angle), .132 * Math.sin(latitude), .132 * Math.cos(latitude) * Math.sin(angle)));
    }
    const seam = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seamPoints, true), 64, .008, 3, true), this._mat('#fffbea'));
    this.ball.add(seam);
    this.trail = new Instances(this.scene, new THREE.SphereGeometry(.075, 6, 4), this._mat('#f4f67a', { transparent: true, opacity: .45, emissive: '#8a963d', emissiveIntensity: .15, depthWrite: false }), 12, false);
    const shadowTexture = this._texture(64, 64, (ctx, w, h) => {
      const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gradient.addColorStop(0, '#152819a0'); gradient.addColorStop(.45, '#15281970'); gradient.addColorStop(1, '#15281900');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
    });
    const shadowMaterial = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    this.materials.push(shadowMaterial);
    const makeShadow = () => { const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMaterial.clone()); mesh.rotation.x = -Math.PI / 2; mesh.position.y = .047; this.scene.add(mesh); return mesh; };
    this.ballShadow = makeShadow(); this.playerShadows = { human: makeShadow(), ai: makeShadow() };
    const flatRing = (radius, width, color, opacity) => {
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }); this.materials.push(material);
      const mesh = new THREE.Mesh(new THREE.RingGeometry(radius - width, radius, 40), material); mesh.rotation.x = -Math.PI / 2; mesh.position.y = .054; this.scene.add(mesh); return mesh;
    };
    this.humanRing = flatRing(.48, .045, '#a8dded', .73);
    this.landingRing = flatRing(.36, .045, '#f6f4a0', .8);
    this.pointerRing = flatRing(.23, .035, '#d6edc0', .65);
    this.effects = Array.from({ length: 8 }, () => { const ring = flatRing(.3, .035, '#fff3b7', .7); ring.visible = false; return { ring, age: 0, active: false }; });
    const aimGeometry = new THREE.BufferGeometry(); aimGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    const aimMaterial = new THREE.LineDashedMaterial({ color: '#e3edbb', dashSize: .23, gapSize: .22, transparent: true, opacity: .48 }); this.materials.push(aimMaterial);
    this.aimLine = new THREE.Line(aimGeometry, aimMaterial); this.scene.add(this.aimLine);
  }

  resize(width, height, pixelRatio = 1) {
    this.width = Math.max(1, width); this.height = Math.max(1, height);
    const portrait = this.width < 580;
    this.renderer.setPixelRatio(Math.min(pixelRatio, portrait ? 1.5 : 2));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.sun.shadow.mapSize.set(portrait ? 1024 : 1536, portrait ? 1024 : 1536);
    this.cameraReady = false; this._updateCamera(this.lastState, 1);
  }

  setCamera(mode) {
    if (!this.modes.includes(mode) || mode === this.mode) return;
    this.mode = mode; this.cameraReady = false; this.cameraYaw = null; this.cameraPitch = null;
  }

  _updateCamera(state, dt) {
    const human = state?.players?.human || { x: 0, y: 10.5 };
    if (this.mode !== 'court') {
      const firstPerson = this.mode === 'first-person';
      const eyeHeight = firstPerson ? 1.67 : 2.12;
      const behind = firstPerson ? -.04 : 1.35;
      const shoulder = firstPerson ? 0 : .52;
      // A fixed eye/shoulder offset follows every step without artificial head bob
      // or a delayed chase that could leave the camera outside the player's body.
      this.camera.position.set(human.x + shoulder, eyeHeight, human.y + behind);
      this.camera.fov = clamp(64 + Math.max(0, 1 - this.camera.aspect) * 64, 64, 96);
      this.camera.near = .06;
      const target = new THREE.Vector3(human.x * .35, 1.05, -7.5);
      const ball = state?.ball;
      if (ball?.inPlay && state.phase === 'rally') {
        const ballTarget = toWorld(ball);
        // A slight look ahead keeps the incoming arc readable. At contact the
        // camera follows the ball itself; it never turns completely backwards.
        const incoming = ball.lastHitter === 'ai';
        if (incoming && ball.y < human.y - 3) {
          ballTarget.x += (ball.vx || 0) * .055;
          ballTarget.z += (ball.vy || 0) * .055;
        }
        target.lerp(ballTarget, incoming ? .98 : .86);
      } else if (state?.phase === 'serve' && state.server === 'human') {
        // Looking a little downward places the held serve ball in the lower
        // foreground while preserving the receiver and the far court.
        target.set(human.x * .5, .85, -5);
      }
      const direction = target.clone().sub(this.camera.position);
      const horizontal = Math.hypot(direction.x, direction.z);
      const desiredYaw = clamp(Math.atan2(direction.x, -direction.z), -Math.PI * .36, Math.PI * .36);
      const desiredPitch = clamp(Math.atan2(direction.y, Math.max(.1, horizontal)), -.52, .66);
      const orientationBlend = !this.cameraReady || this.cameraYaw === null ? 1 : 1 - Math.exp(-Math.max(0, dt) * 12);
      this.cameraYaw = this.cameraYaw === null ? desiredYaw : THREE.MathUtils.lerp(this.cameraYaw, desiredYaw, orientationBlend);
      this.cameraPitch = this.cameraPitch === null ? desiredPitch : THREE.MathUtils.lerp(this.cameraPitch, desiredPitch, orientationBlend);
      const cosine = Math.cos(this.cameraPitch);
      const look = new THREE.Vector3(Math.sin(this.cameraYaw) * cosine, Math.sin(this.cameraPitch), -Math.cos(this.cameraYaw) * cosine);
      const lookTarget = this.camera.position.clone().addScaledVector(look, 10);
      this.camera.lookAt(lookTarget); this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
      this.cameraInfo = { eyeHeight, followDistance: Math.hypot(shoulder, behind), behindDistance: behind,
        headDistance: this.camera.position.distanceTo(new THREE.Vector3(human.x, 1.77, human.y)),
        target: { x: lookTarget.x, y: lookTarget.z, z: lookTarget.y }, yaw: this.cameraYaw, pitch: this.cameraPitch };
      this.cameraReady = true;
      return;
    }
    // The overview remains available explicitly. Only this mode fits all court
    // corners; the two immersive views stay physically close to the player.
    const target = new THREE.Vector3(0, .65, .6);
    const direction = new THREE.Vector3(0, .68, .733).normalize();
    const up = new THREE.Vector3(0, direction.z, -direction.y);
    this.camera.fov = 43; this.camera.near = .1;
    const tangent = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    let distance = 25;
    // Fit the entire playable area, including a standing player at either baseline.
    for (const x of [-6.7, 6.7]) for (const z of [-14.7, 14.7]) for (const y of [0, 2.1]) {
      const offset = new THREE.Vector3(x, y, z).sub(target);
      const depth = offset.dot(direction);
      distance = Math.max(distance, depth + Math.max(Math.abs(offset.x) / (tangent * this.camera.aspect), Math.abs(offset.dot(up)) / tangent) * 1.1);
    }
    const destination = target.clone().addScaledVector(direction, distance);
    const blend = this.cameraReady ? 1 - Math.exp(-Math.max(0, dt) * 7) : 1;
    this.camera.position.lerp(destination, blend);
    this.camera.lookAt(target); this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
    this.cameraInfo = { eyeHeight: this.camera.position.y, followDistance: Math.hypot(this.camera.position.x - human.x, this.camera.position.z - human.y),
      behindDistance: this.camera.position.z - human.y, target: { x: target.x, y: target.z, z: target.y } };
    this.cameraReady = true;
  }

  project(x, y, z = 0) {
    this.projectVector.set(x, z, y);
    const inFront = this.projectVector.clone().applyMatrix4(this.camera.matrixWorldInverse).z < -this.camera.near;
    this.projectVector.project(this.camera);
    return { x: (this.projectVector.x + 1) * this.width / 2, y: (1 - this.projectVector.y) * this.height / 2,
      inFront, visible: inFront && Math.abs(this.projectVector.x) <= 1 && Math.abs(this.projectVector.y) <= 1 && Math.abs(this.projectVector.z) <= 1 };
  }

  unproject(pixelX, pixelY) {
    this.pointerVector.set(pixelX / this.width * 2 - 1, 1 - pixelY / this.height * 2);
    this.raycaster.setFromCamera(this.pointerVector, this.camera);
    const result = this.raycaster.ray.intersectPlane(this.groundPlane, new THREE.Vector3());
    return result ? { x: result.x, y: result.z } : null;
  }

  handleEvent(event, state) {
    const ball = event.contact || state.ball;
    if (event.type === 'hit' || event.type === 'serve') this.contacts[event.side || state.ball.lastHitter || state.server] = { x: ball.x, y: ball.y, z: ball.z };
    if (['bounce', 'hit', 'net'].includes(event.type)) {
      const effect = this.effects.find((e) => !e.active) || this.effects[0];
      effect.active = true; effect.age = 0; effect.ring.visible = true;
      effect.ring.position.copy(ground(event.x ?? ball.x, event.y ?? ball.y, event.type === 'bounce' ? .059 : ball.z));
      effect.ring.rotation.x = event.type === 'bounce' ? -Math.PI / 2 : 0;
      effect.ring.material.color.set(event.type === 'bounce' ? '#f6d1a2' : '#f9ffb0');
    }
    if (event.type === 'point') this.pointFlash = .4;
  }

  _animatePlayers(state, dt) {
    for (const batch of [this.skinLimbs, this.skinJoints, this.socks, this.shoes]) batch.begin();
    for (const side of ['human', 'ai']) {
      const p = state.players[side], model = this.playerModels[side], root = model.root;
      const speed = Math.hypot(p.vx || 0, p.vy || 0), moving = clamp(speed / 6, 0, 1);
      model.step += dt * speed * 3.8;
      const swing = p.swing || 0, bob = Math.abs(Math.sin(model.step)) * .055 * moving;
      root.position.set(p.x, bob, p.y); root.rotation.y = side === 'ai' ? Math.PI : 0; root.updateMatrixWorld(true);
      const hidden = side === 'human' && this.mode === 'first-person';
      root.visible = !hidden; model.racket.visible = !hidden; this.playerShadows[side].visible = !hidden;
      if (hidden) continue;
      const local = (x, y, z) => root.localToWorld(new THREE.Vector3(x, y, z));
      const quaternion = root.quaternion;
      const legSign = side === 'ai' ? -1 : 1;
      for (const direction of [-1, 1]) {
        const stride = Math.sin(model.step + (direction === 1 ? Math.PI : 0)) * .36 * moving;
        const lift = Math.max(0, Math.cos(model.step + (direction === 1 ? Math.PI : 0))) * .1 * moving;
        const footX = direction * .2 + stride * clamp((p.vx || 0) / Math.max(speed, .1), -1, 1) * legSign;
        const footZ = -.1 + stride * clamp((p.vy || 0) / Math.max(speed, .1), -1, 1) * legSign;
        const hip = local(direction * .17, .76, 0), knee = local(direction * .195 + (footX - direction * .2) * .4, .43 + lift * .5, footZ * .52 - .07);
        const ankle = local(footX, .16 + lift, footZ);
        this.skinLimbs.segment(hip, knee, .105); this.skinLimbs.segment(knee, ankle, .078);
        this.skinJoints.add(knee, new THREE.Vector3(.082, .082, .082));
        this.socks.segment(local(footX, .145 + lift, footZ), local(footX, .285 + lift, footZ), .086);
        this.shoes.add(local(footX, .09 + lift - bob, footZ - .055), new THREE.Vector3(.19, .15, .34), quaternion);
      }
      this.skinJoints.add(local(0, 1.575, 0), new THREE.Vector3(.09, .13, .09));
      const handedness = (p.swingSide || 1) * (side === 'ai' ? -1 : 1);
      const shoulder = local(handedness * .27, 1.46, -.01);
      const ready = local(handedness * .85, 1.22, -.65);
      let centre = ready.clone();
      const contact = p.swingContact || this.contacts[side];
      if (swing > 0 && contact) {
        const progress = 1 - swing, contactPoint = toWorld(contact);
        const follow = Math.sin(progress * Math.PI);
        contactPoint.x -= handedness * legSign * follow * .65;
        contactPoint.y += follow * .35;
        contactPoint.z -= legSign * follow * .38;
        centre.lerp(contactPoint, 1 - smooth(.35, 1, progress));
      } else if (state.ball.inPlay && state.ball.lastHitter !== side) {
        const distance = Math.hypot(state.ball.x - p.x, state.ball.y - p.y);
        if (distance < 3.2 && state.ball.z > .25 && state.ball.z < 2.8) centre.lerp(toWorld(state.ball), .5 * (1 - smooth(1.1, 3.2, distance)));
      }
      const longAxis = centre.clone().sub(shoulder).normalize();
      const normal = new THREE.Vector3(0, .12, -legSign).normalize();
      const across = new THREE.Vector3().crossVectors(longAxis, normal);
      if (across.lengthSq() < .001) across.set(1, 0, 0);
      across.normalize();
      const correctedNormal = new THREE.Vector3().crossVectors(across, longAxis).normalize();
      model.racket.position.copy(centre); model.racket.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, longAxis, correctedNormal));
      const wrist = centre.clone().addScaledVector(longAxis, -.66);
      const distance = shoulder.distanceTo(wrist);
      const bend = Math.sqrt(Math.max(.015, .44 ** 2 - Math.min(.44, distance / 2) ** 2));
      const elbow = shoulder.clone().add(wrist).multiplyScalar(.5).add(new THREE.Vector3(handedness * legSign * bend * .5, -bend, .12));
      this.skinLimbs.segment(shoulder, elbow, .088); this.skinLimbs.segment(elbow, wrist, .073);
      this.skinJoints.add(elbow, new THREE.Vector3(.078, .078, .078));
      this.skinJoints.add(wrist, new THREE.Vector3(.065, .065, .065));
      const otherShoulder = local(-handedness * .27, 1.46, 0);
      const otherElbow = local(-handedness * (.38 + swing * .11), 1.14 + swing * .1, .09 + Math.sin(model.step) * .13 * moving);
      const otherWrist = local(-handedness * (.32 + swing * .3), .97 + swing * .33, -.1 + swing * .35);
      this.skinLimbs.segment(otherShoulder, otherElbow, .088); this.skinLimbs.segment(otherElbow, otherWrist, .073);
      this.skinJoints.add(otherElbow, new THREE.Vector3(.077, .077, .077)); this.skinJoints.add(otherWrist, new THREE.Vector3(.066, .066, .066));
      const shadow = this.playerShadows[side]; shadow.position.set(p.x, .049, p.y); shadow.scale.set(1, .68, 1);
    }
    for (const batch of [this.skinLimbs, this.skinJoints, this.socks, this.shoes]) batch.finish();
  }

  render(state, dt = 1 / 60, { assist = true, pointer = null, aim = 0 } = {}) {
    dt = Math.min(.1, Math.max(0, dt)); this.clock += dt;
    if (state.time < this.lastStateTime) { this.contacts = { human: null, ai: null }; this.cameraReady = false; for (const e of this.effects) { e.active = false; e.ring.visible = false; } }
    this.lastStateTime = state.time; this.lastState = state;
    this._updateCamera(state, dt); this._animatePlayers(state, ['paused', 'menu', 'finished'].includes(state.phase) ? 0 : dt);
    const b = state.ball;
    this.ball.position.set(b.x, Math.max(.13, b.z), b.y);
    const cameraDistance = this.camera.position.distanceTo(this.ball.position);
    const screenRadius = .13 * this.height / (2 * cameraDistance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    // Overview exaggerates the tennis ball slightly. Up close it approaches
    // physical size, so an eye-level serve cannot fill the entire screen.
    const ballScale = clamp(3.1 / Math.max(screenRadius, .1), this.mode === 'court' ? 1 : .33, 1.9);
    this.ball.scale.setScalar(ballScale); this.ball.position.y = Math.max(.13 * ballScale, b.z);
    this.ball.rotation.set(state.time * 3.1, state.time * 2.6, state.time * 1.1);
    const shadowScale = .37 + Math.max(0, b.z) * .045;
    this.ballShadow.position.set(b.x, .053, b.y); this.ballShadow.scale.set(shadowScale, shadowScale, 1); this.ballShadow.material.opacity = .9 / (1 + b.z * .16);
    this.trail.begin();
    if (b.inPlay) for (const [i, point] of (b.trail || []).entries()) {
      const scale = (.3 + i / Math.max(1, b.trail.length) * .65) * ballScale;
      this.trail.add(toWorld(point), new THREE.Vector3(scale, scale, scale));
    }
    this.trail.finish();
    const human = state.players.human;
    this.humanRing.position.set(human.x, .056, human.y); this.humanRing.visible = state.phase !== 'menu' && this.mode !== 'first-person';
    this.landingRing.visible = Boolean(assist && state.phase === 'rally' && b.inPlay && b.lastHitter === 'ai');
    if (this.landingRing.visible) {
      const time = (b.vz + Math.sqrt(b.vz * b.vz + 2 * 9.81 * Math.max(0, b.z - .033))) / 9.81;
      this.landingRing.position.set(b.x + b.vx * time, .061, b.y + b.vy * time);
      this.landingRing.material.opacity = .62 + Math.sin(this.clock * 5) * .12;
    }
    this.pointerRing.visible = Boolean(pointer?.active && ['serve', 'rally'].includes(state.phase));
    if (this.pointerRing.visible) this.pointerRing.position.set(pointer.x, .058, pointer.y);
    this.aimLine.visible = Boolean(Math.abs(aim) > .1 && ['serve', 'rally'].includes(state.phase));
    if (this.aimLine.visible) {
      const positions = this.aimLine.geometry.attributes.position;
      positions.setXYZ(0, human.x, .066, human.y - .3); positions.setXYZ(1, clamp(aim, -1, 1) * 3.8, .066, -9.5);
      positions.needsUpdate = true; this.aimLine.computeLineDistances();
    }
    for (const effect of this.effects) {
      if (!effect.active) continue;
      effect.age += dt; effect.ring.scale.setScalar(1 + effect.age * 3.6);
      effect.ring.material.opacity = Math.max(0, .65 * (1 - effect.age / .4));
      if (effect.age > .4) { effect.active = false; effect.ring.visible = false; }
      else if (effect.ring.rotation.x === 0) effect.ring.lookAt(this.camera.position);
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    const geometries = new Set(), materials = new Set();
    this.scene.traverse((object) => { if (object.geometry) geometries.add(object.geometry); if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material); });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.renderer.dispose();
  }
}
