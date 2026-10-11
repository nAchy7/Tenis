import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import courtEnvironmentUrl from './assets/environment/daylight.hdr';

/** Daylight only: the court, camera and simulation retain their own coordinates. */
export function createDaylight({ scene, renderer, environmentUrl = courtEnvironmentUrl }) {
  const previous = {
    background: scene.background,
    fog: scene.fog,
    environment: scene.environment,
    environmentIntensity: scene.environmentIntensity,
    environmentRotation: scene.environmentRotation.clone(),
  };
  let disposed = false;
  let environmentGeneration = 0;
  let environmentTarget = null;
  const textures = [];
  const environmentStatus = { state: environmentUrl ? 'loading' : 'disabled', source: environmentUrl, error: null };

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // A modest sky fill preserves the difference between sunlit and shaded faces.
  const hemisphere = new THREE.HemisphereLight('#c4dcf3', '#847660', .85);
  hemisphere.name = 'daylight.skyFill';
  const sun = new THREE.DirectionalLight('#fff3de', 2.7);
  sun.name = 'daylight.sun';
  sun.position.set(-14, 28, 16);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;

  // This covers both baselines and their run-off, rather than the whole stadium.
  // At 2048 pixels the ~40 m projection resolves about 2 cm per shadow texel.
  Object.assign(sun.shadow.camera, {
    left: -20.5, right: 20.5, top: 20, bottom: -20, near: 9, far: 61,
  });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -.00012;
  sun.shadow.normalBias = .018;
  sun.shadow.intensity = 1;
  // PCFSoftShadowMap ignores radius in Three r180. Its built-in PCF kernel is
  // already soft enough for clear player silhouettes at this shadow resolution.
  sun.shadow.radius = 1;
  scene.add(hemisphere, sun, sun.target);

  const horizon = new THREE.Color('#dce9eb');
  const background = horizon.clone();
  const fog = new THREE.Fog(horizon, 48, 118);
  scene.background = background;
  scene.fog = fog;

  // An inexpensive background dome avoids a flat clear colour and avoids an
  // HDRI photograph's unrelated terrain or sun direction in the gameplay view.
  const skyGeometry = new THREE.SphereGeometry(112, 32, 16);
  const skyMaterial = new THREE.ShaderMaterial({
    name: 'daylight.skyGradient',
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      zenith: { value: new THREE.Color('#78abd0') },
      horizon: { value: horizon },
      lowerSky: { value: new THREE.Color('#c8d6d3') },
      sunDirection: { value: sun.position.clone().normalize() },
      sunHaze: { value: new THREE.Color('#fff2dc') },
    },
    vertexShader: /* glsl */`
      varying vec3 vSkyDirection;
      void main() {
        vSkyDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vSkyDirection;
      uniform vec3 zenith;
      uniform vec3 horizon;
      uniform vec3 lowerSky;
      uniform vec3 sunDirection;
      uniform vec3 sunHaze;
      void main() {
        vec3 direction = normalize(vSkyDirection);
        float height = max(direction.y, 0.0);
        vec3 colour = mix(horizon, zenith, pow(height, 0.58));
        colour = mix(colour, lowerSky, smoothstep(0.0, 0.32, -direction.y));
        float haze = pow(max(dot(direction, sunDirection), 0.0), 18.0) * 0.13;
        colour = mix(colour, sunHaze, haze);
        gl_FragColor = vec4(colour, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeometry, skyMaterial);
  sky.name = 'daylight.sky';
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  sky.userData.daylight = true;
  scene.add(sky);

  function setShadowQuality(size) {
    const requested = THREE.MathUtils.clamp(Math.round(size), 1024, 2048);
    const resolution = Math.min(requested, renderer.capabilities.maxTextureSize);
    if (sun.shadow.mapSize.x === resolution && sun.shadow.mapSize.y === resolution) return;
    sun.shadow.mapSize.set(resolution, resolution);
    // r180 allocates a shadow target only when map is null; mapSize alone does
    // not resize an existing allocation when switching phone/desktop layouts.
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    sun.shadow.mapPass?.dispose();
    sun.shadow.mapPass = null;
    sun.shadow.needsUpdate = true;
  }

  function resetEnvironment() {
    environmentStatus.state = 'loading';
    environmentStatus.error = null;
    scene.environment = null;
    hemisphere.intensity = .85;
    environmentTarget?.dispose();
    environmentTarget = null;
    textures.length = 0;
  }

  async function loadEnvironment() {
    if (!environmentUrl || disposed) return environmentStatus;
    const generation = ++environmentGeneration;
    resetEnvironment();
    let sourceTexture = null;
    let generator = null;
    let nextTarget = null;
    try {
      // RGBELoader is a deprecated alias of HDRLoader in Three r180.
      sourceTexture = await new HDRLoader().setDataType(THREE.HalfFloatType).loadAsync(environmentUrl);
      if (disposed || generation !== environmentGeneration) return environmentStatus;
      sourceTexture.mapping = THREE.EquirectangularReflectionMapping;
      generator = new THREE.PMREMGenerator(renderer);
      nextTarget = generator.fromEquirectangular(sourceTexture);
      if (disposed || generation !== environmentGeneration) return environmentStatus;
      environmentTarget = nextTarget;
      nextTarget = null;
      environmentTarget.texture.name = 'daylight.courtEnvironment';
      textures.push(environmentTarget.texture);
      scene.environment = environmentTarget.texture;
      scene.environmentIntensity = .55;
      // The sky remains the stable visual background; the local HDR supplies
      // broad illumination and reflections on skin, cloth and racket materials.
      // quarry_01's sun sits at equirectangular azimuth ~0.63 rad. Align its
      // horizontal direction with the shadow-casting key so highlights agree.
      scene.environmentRotation.set(0, .63 - Math.atan2(sun.position.z, sun.position.x), 0);
      hemisphere.intensity = .35;
      environmentStatus.state = 'ready';
    } catch (error) {
      // Keep a fully lit court if decoding or a device's PMREM allocation fails.
      if (!disposed && generation === environmentGeneration) {
        environmentStatus.state = 'fallback';
        environmentStatus.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      nextTarget?.dispose();
      sourceTexture?.dispose();
      generator?.dispose();
    }
    return environmentStatus;
  }

  // GPU render-target contents are lost with the context. Reload the embedded
  // HDR and regenerate its PMREM instead of reusing an empty restored target.
  function onContextLost() {
    if (disposed) return;
    environmentGeneration++;
    // Release old handles while the context is lost; deleting those handles
    // after restoration would attempt to delete objects from the old context.
    if (environmentUrl) resetEnvironment();
    // Release this rig's cached GPU handles in the lost context as well. Their
    // CPU geometry and shader data remain available for the renderer to upload.
    skyGeometry.dispose();
    skyMaterial.dispose();
    sun.shadow.dispose();
    sun.shadow.map = null;
    sun.shadow.mapPass = null;
    sun.shadow.needsUpdate = true;
  }
  function onContextRestored() {
    if (!disposed) void loadEnvironment();
  }
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);
  const ready = loadEnvironment();

  function dispose() {
    if (disposed) return;
    disposed = true;
    environmentGeneration++;
    renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
    renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
    scene.remove(sky, hemisphere, sun, sun.target);
    skyGeometry.dispose();
    skyMaterial.dispose();
    sun.dispose();
    if (scene.background === background) scene.background = previous.background;
    if (scene.fog === fog) scene.fog = previous.fog;
    if (scene.environment === environmentTarget?.texture || scene.environment === null) {
      scene.environment = previous.environment;
      scene.environmentIntensity = previous.environmentIntensity;
      scene.environmentRotation.copy(previous.environmentRotation);
    }
    environmentTarget?.dispose();
    environmentTarget = null;
    textures.length = 0;
    environmentStatus.state = 'disposed';
  }

  return { sun, hemisphere, sky, textures, environmentStatus, ready, setShadowQuality, dispose };
}
