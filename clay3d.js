import * as THREE from 'three';
import clayColorURL from './assets/clay/clay_color.jpg';
import clayNormalURL from './assets/clay/clay_normal_gl.jpg';
import clayRoughnessURL from './assets/clay/clay_roughness.jpg';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Local, self-contained textures; esbuild embeds the images in the offline game. */
export const CLAY_TEXTURE_URLS = Object.freeze({
  color: clayColorURL,
  normal: clayNormalURL,
  roughness: clayRoughnessURL,
});

function makeCanvas(width, height = width) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}

function configureTexture(texture, renderer, width, length, tileSize, color = false) {
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(width / tileSize, length / tileSize);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  return texture;
}

/** Fine compacted brick dust remains visible if an image cannot be decoded. */
function fallbackMaps(renderer, width, length, tileSize) {
  const size = 512;
  const color = makeCanvas(size), normal = makeCanvas(size), roughness = makeCanvas(size);
  const colorContext = color.getContext('2d'), normalContext = normal.getContext('2d'), roughContext = roughness.getContext('2d');
  const colorData = colorContext.createImageData(size, size);
  const normalData = normalContext.createImageData(size, size);
  const roughData = roughContext.createImageData(size, size);
  const heights = new Float32Array(size * size);
  let seed = 19437;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let index = 0; index < heights.length; index++) heights[index] = random();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = y * size + x, channel = index * 4;
    const grain = heights[index], powder = random();
    // Most grains have similar colour; occasional dark brick fragments add depth.
    const shade = grain < .085 ? -23 : (grain - .5) * 23 + (powder - .5) * 6;
    colorData.data[channel] = clamp(171 + shade, 0, 255);
    colorData.data[channel + 1] = clamp(79 + shade * .64, 0, 255);
    colorData.data[channel + 2] = clamp(52 + shade * .4, 0, 255);
    colorData.data[channel + 3] = 255;
    const dx = heights[y * size + ((x + 1) % size)] - heights[y * size + ((x + size - 1) % size)];
    const dy = heights[((y + 1) % size) * size + x] - heights[((y + size - 1) % size) * size + x];
    normalData.data[channel] = 128 - dx * 29;
    normalData.data[channel + 1] = 128 + dy * 29;
    normalData.data[channel + 2] = 254;
    normalData.data[channel + 3] = 255;
    const rough = 225 + grain * 26;
    roughData.data[channel] = roughData.data[channel + 1] = roughData.data[channel + 2] = rough;
    roughData.data[channel + 3] = 255;
  }
  colorContext.putImageData(colorData, 0, 0);
  normalContext.putImageData(normalData, 0, 0);
  roughContext.putImageData(roughData, 0, 0);
  return {
    color: configureTexture(new THREE.CanvasTexture(color), renderer, width, length, tileSize, true),
    normal: configureTexture(new THREE.CanvasTexture(normal), renderer, width, length, tileSize),
    roughness: configureTexture(new THREE.CanvasTexture(roughness), renderer, width, length, tileSize),
  };
}

const CLAY_NOISE = `
varying vec3 vClayWorld;
uniform sampler2D clayWearMap;
uniform vec2 clayCourtSize;
uniform vec3 clayPigment;
float clayHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float clayNoise(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(clayHash(cell), clayHash(cell + vec2(1.0, 0.0)), f.x),
             mix(clayHash(cell + vec2(0.0, 1.0)), clayHash(cell + vec2(1.0)), f.x), f.y);
}
`;

function addClayShader(material, wearTexture, width, length, pigment) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.clayWearMap = { value: wearTexture };
    shader.uniforms.clayCourtSize = { value: new THREE.Vector2(width, length) };
    shader.uniforms.clayPigment = { value: pigment };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vClayWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvClayWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CLAY_NOISE}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 clayXZ = vClayWorld.xz;
        diffuseColor.rgb *= clayPigment;
        // Metre-scale, continuous variations do not repeat with the fine PBR tile.
        float clayMacro = clayNoise(clayXZ * .24 + vec2(8.7, 2.1)) * .52
                        + clayNoise(clayXZ * .73 + vec2(1.3, 9.2)) * .31
                        + clayNoise(clayXZ * 2.5) * .17;
        diffuseColor.rgb *= .86 + .25 * clayMacro;
        float clayBaseline = exp(-pow((abs(clayXZ.y) - 10.75) / 1.32, 2.0))
                           * exp(-pow(clayXZ.x / 4.6, 4.0));
        float clayService = exp(-pow((abs(clayXZ.y) - 6.15) / .62, 2.0))
                          * exp(-pow(clayXZ.x / 4.0, 4.0)) * .23;
        float clayWear = (clayBaseline + clayService) * (.54 + .46 * clayMacro);
        // The worn running lanes expose slightly paler, compressed brick powder.
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.13, 1.17, 1.2), clayWear * .38);
        vec2 clayMarkUV = vec2(clayXZ.x / clayCourtSize.x + .5, .5 - clayXZ.y / clayCourtSize.y);
        vec2 clayMarks = texture2D(clayWearMap, clayMarkUV).rg;
        diffuseColor.rgb *= 1.0 - clayMarks.g * .2;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 1.3, 1.32), clayMarks.r * .44);
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        // Dry compacted clay stays matte, even where a roughness scan has dark pits.
        roughnessFactor = clamp(roughnessFactor, .83, 1.0);
        roughnessFactor = max(.82, roughnessFactor - clayWear * .035 - clayMarks.g * .02);
      `);
  };
  material.customProgramCacheKey = () => 'tennis-clay-pbr-world-wear-v1';
}

/**
 * A horizontal 16.5 × 33 m top surface in world x/z coordinates.
 * update accepts the existing game's state; it never changes the simulation.
 */
export function createClaySurface({
  renderer, width = 16.5, length = 33, height = .035, tileSize = 1.35,
  textureURLs = CLAY_TEXTURE_URLS,
} = {}) {
  const fallback = fallbackMaps(renderer, width, length, tileSize);
  const textures = Object.values(fallback);
  const wearCanvas = makeCanvas(512, 1024);
  const wearContext = wearCanvas.getContext('2d');
  wearContext.fillStyle = '#000000'; wearContext.fillRect(0, 0, wearCanvas.width, wearCanvas.height);
  const wearTexture = new THREE.CanvasTexture(wearCanvas);
  wearTexture.colorSpace = THREE.NoColorSpace;
  wearTexture.minFilter = THREE.LinearFilter; wearTexture.magFilter = THREE.LinearFilter;
  wearTexture.generateMipmaps = false;
  textures.push(wearTexture);
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff', map: fallback.color, normalMap: fallback.normal,
    normalScale: new THREE.Vector2(.4, .4), roughnessMap: fallback.roughness,
    roughness: 1, metalness: 0,
  });
  material.name = 'Fine red clay • local PBR / world-space wear';
  // The CC0 scan supplies real mineral texture; iron-rich brick powder supplies
  // its tennis-clay colour. These are linear multipliers, applied after sRGB decode.
  const pigment = new THREE.Vector3(1, 1, 1);
  addClayShader(material, wearTexture, width, length, pigment);
  const geometry = new THREE.PlaneGeometry(width, length);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2; mesh.position.y = height;
  mesh.receiveShadow = true; mesh.name = 'Clay playing surface';

  const status = { state: 'loading', assets: { color: 'loading', normal: 'loading', roughness: 'loading' }, tileSize };
  const loader = new THREE.TextureLoader();
  let disposed = false, dirty = false, uploadClock = 0, lastTime = -1;
  const tracks = new Map();
  const slots = { color: 'map', normal: 'normalMap', roughness: 'roughnessMap' };
  const ready = Promise.all(Object.entries(slots).map(([kind, slot]) => new Promise((resolve) => {
    const url = textureURLs[kind];
    if (!url) { status.assets[kind] = 'fallback'; resolve(); return; }
    const loadingTexture = loader.load(url, (texture) => {
      if (disposed) { texture.dispose(); resolve(); return; }
      configureTexture(texture, renderer, width, length, tileSize, kind === 'color');
      if (kind === 'color') pigment.set(1.3, .32, .22);
      material[slot] = texture; material.needsUpdate = true;
      status.assets[kind] = 'ready'; resolve();
    }, undefined, () => { status.assets[kind] = 'fallback'; resolve(); });
    textures.push(loadingTexture);
  }))).then(() => {
    status.state = Object.values(status.assets).every((value) => value === 'ready') ? 'ready' : 'fallback';
    return status;
  });

  function stamp(x, z, angle, radiusX, radiusZ, dust, compact) {
    if (disposed || !Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > width / 2 - .15 || Math.abs(z) > length / 2 - .15) return;
    const px = (x / width + .5) * wearCanvas.width;
    const py = (.5 - z / length) * wearCanvas.height;
    const sx = wearCanvas.width / width, sy = wearCanvas.height / length;
    wearContext.save(); wearContext.translate(px, py); wearContext.rotate(angle);
    wearContext.globalCompositeOperation = 'lighter';
    const radial = wearContext.createRadialGradient(0, 0, 0, 0, 0, radiusZ * sy * 1.55);
    radial.addColorStop(0, `rgba(255,0,0,${dust})`);
    radial.addColorStop(1, 'rgba(255,0,0,0)');
    wearContext.fillStyle = radial;
    wearContext.scale(radiusX * sx / (radiusZ * sy), 1);
    wearContext.beginPath(); wearContext.arc(0, 0, radiusZ * sy * 1.55, 0, Math.PI * 2); wearContext.fill();
    wearContext.restore();
    if (compact > 0) {
      wearContext.save(); wearContext.translate(px, py); wearContext.rotate(angle);
      wearContext.globalCompositeOperation = 'lighter';
      wearContext.fillStyle = `rgba(0,255,0,${compact})`;
      wearContext.beginPath(); wearContext.ellipse(0, 0, radiusX * sx * .63, radiusZ * sy * .68, 0, 0, Math.PI * 2); wearContext.fill();
      wearContext.restore();
    }
    dirty = true;
  }

  function markBounce(x, z, strength = 1) {
    const intensity = clamp(strength, .25, 1.8);
    stamp(x, z, 0, .07, .082, .3 * intensity, .42 * intensity);
  }

  function reset() {
    tracks.clear(); lastTime = -1;
    wearContext.fillStyle = '#000000'; wearContext.fillRect(0, 0, wearCanvas.width, wearCanvas.height);
    wearTexture.needsUpdate = true; dirty = false;
  }

  function update(state, dt = 1 / 60) {
    if (disposed || !state) return;
    if (Number.isFinite(state.time) && state.time < lastTime) reset();
    lastTime = state.time;
    if (dt > 0 && ['serve', 'rally'].includes(state.phase)) {
      for (const side of ['human', 'ai']) {
        const player = state.players?.[side];
        if (!player) continue;
        const previous = tracks.get(side);
        if (!previous) { tracks.set(side, { x: player.x, z: player.y, distance: 0, foot: 1 }); continue; }
        const dx = player.x - previous.x, dz = player.y - previous.z, distance = Math.hypot(dx, dz);
        if (distance > 2) { previous.distance = 0; }
        else if (distance > .002) {
          previous.distance += distance;
          if (previous.distance > .42) {
            const perpendicularX = dz / distance, perpendicularZ = -dx / distance;
            stamp(player.x + perpendicularX * .09 * previous.foot, player.y + perpendicularZ * .09 * previous.foot,
              Math.atan2(dx, -dz), .095, .18 + Math.min(.13, distance * 1.8), .16, .13);
            previous.distance = 0; previous.foot *= -1;
          }
        }
        previous.x = player.x; previous.z = player.y;
      }
    }
    uploadClock += Math.max(0, dt);
    // One tiny canvas upload per 100 ms at most, regardless of the render rate.
    if (dirty && uploadClock >= .1) { wearTexture.needsUpdate = true; dirty = false; uploadClock = 0; }
  }

  function dispose() {
    if (disposed) return;
    disposed = true; mesh.removeFromParent(); geometry.dispose(); material.dispose();
    for (const texture of new Set(textures)) texture.dispose();
    tracks.clear();
  }

  return { mesh, material, textures, status, ready, update, markBounce, reset, dispose };
}
