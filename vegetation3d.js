import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import treeModelURL from './assets/vegetation/tree.glb';

export const TREE_MODEL_URL = treeModelURL;
const TREE_COUNT = 30;
const MODEL_HEIGHT = 8.1;
const MODEL_WIDTH = 4.65;

function triangleCount(geometry) {
  const available = geometry.index?.count ?? geometry.getAttribute('position').count;
  return Math.floor(Math.max(0, Math.min(available - geometry.drawRange.start, geometry.drawRange.count)) / 3);
}

function resourcesFor(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : []) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  return { geometries, materials, textures };
}

function disposeResources({ geometries, materials, textures }, retainedTextures = new Set()) {
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) if (!retainedTextures.has(texture)) texture.dispose();
}

function positionAt(index) {
  const angle = Math.PI + index * Math.PI / 29;
  const radius = 31 + Math.sin(index * 7) * 5;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

function makePlaceholder() {
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: '#675b40', roughness: .9, metalness: 0 });
  const foliageMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .9, metalness: 0 });
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.2, .32, 4, 5), trunkMaterial, TREE_COUNT);
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), foliageMaterial, TREE_COUNT);
  const dummy = new THREE.Object3D();
  for (let index = 0; index < TREE_COUNT; index++) {
    const { x, z } = positionAt(index);
    dummy.position.set(x, 2, z); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix(); trunks.setMatrixAt(index, dummy.matrix);
    dummy.position.y = 5.1 + Math.sin(index * 3) * .7;
    dummy.scale.set(2.3, 3 + (index % 3) * .5, 2.1); dummy.rotation.y = index;
    dummy.updateMatrix(); crowns.setMatrixAt(index, dummy.matrix);
    crowns.setColorAt(index, new THREE.Color(index % 3 === 0 ? '#4f7555' : '#3d6249'));
  }
  trunks.name = 'Tree trunks • load fallback'; crowns.name = 'Tree crowns • load fallback';
  for (const mesh of [trunks, crowns]) {
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
  }
  return [trunks, crowns];
}

/** Embedded CC0 tree geometry, batched into one draw per material primitive. */
export function createVegetation({ scene, renderer, modelURL = TREE_MODEL_URL } = {}) {
  if (!scene?.isScene) throw new TypeError('createVegetation needs a Three.js scene');
  let disposed = false;
  let meshes = makePlaceholder();
  const owned = { geometries: new Set(), materials: new Set(), textures: new Set() };
  const remember = (mesh) => {
    owned.geometries.add(mesh.geometry); owned.materials.add(mesh.material);
    for (const value of Object.values(mesh.material)) if (value?.isTexture) owned.textures.add(value);
  };
  meshes.forEach((mesh) => { remember(mesh); scene.add(mesh); });
  const fallbackTriangles = meshes.reduce((total, mesh) => total + triangleCount(mesh.geometry), 0);
  const status = {
    state: 'loading', assets: { tree: 'loading' }, fallback: true, treeCount: TREE_COUNT,
    primitiveCount: meshes.length, materialCount: meshes.length, drawCalls: meshes.length,
    trianglesPerTree: fallbackTriangles, triangles: fallbackTriangles * TREE_COUNT,
    source: 'Quaternius Ultimate Nature Pack • CommonTree_4', error: null,
  };

  function removeMeshes(list) {
    const geometries = new Set(), materials = new Set();
    for (const mesh of list) {
      mesh.removeFromParent();
      mesh.dispose();
      geometries.add(mesh.geometry); materials.add(mesh.material);
    }
    for (const geometry of geometries) if (owned.geometries.delete(geometry)) geometry.dispose();
    for (const material of materials) if (owned.materials.delete(material)) material.dispose();
  }

  function loadInstances(gltf) {
    const root = gltf.scene;
    const sourceResources = resourcesFor(root);
    const created = [];
    const materialCache = new Map();
    try {
      root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(root, true);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      if (![size.x, size.y, size.z].every(Number.isFinite) || size.y <= 0 || Math.max(size.x, size.z) <= 0) {
        throw new Error('Tree model has invalid bounds');
      }
      const normalize = new THREE.Matrix4().makeScale(MODEL_WIDTH / Math.max(size.x, size.z), MODEL_HEIGHT / size.y, MODEL_WIDTH / Math.max(size.x, size.z));
      normalize.multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
      const dummy = new THREE.Object3D();
      root.traverse((object) => {
        if (!object.isMesh) return;
        if (object.isSkinnedMesh) throw new Error('Tree model must be static geometry');
        const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
        const ranges = Array.isArray(object.material)
          ? object.geometry.groups
          : [{ start: object.geometry.drawRange.start, count: object.geometry.drawRange.count, materialIndex: 0 }];
        for (const range of ranges) {
          const sourceMaterial = sourceMaterials[range.materialIndex];
          if (!sourceMaterial) continue;
          let material = materialCache.get(sourceMaterial);
          if (!material) {
            material = new THREE.MeshStandardMaterial({
              color: sourceMaterial.color ?? '#ffffff', map: sourceMaterial.map ?? null,
              normalMap: sourceMaterial.normalMap ?? null, normalScale: sourceMaterial.normalScale ?? new THREE.Vector2(1, 1),
              roughnessMap: sourceMaterial.roughnessMap ?? null, aoMap: sourceMaterial.aoMap ?? null,
              aoMapIntensity: sourceMaterial.aoMapIntensity ?? 1,
              vertexColors: sourceMaterial.vertexColors ?? false, side: sourceMaterial.side ?? THREE.FrontSide,
              metalness: 0, roughness: .9, transparent: false, opacity: 1, depthWrite: true,
            });
            material.name = `${sourceMaterial.name || 'Tree'} • matte opaque`;
            materialCache.set(sourceMaterial, material);
            for (const value of Object.values(material)) if (value?.isTexture) {
              value.anisotropy = Math.min(4, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
              owned.textures.add(value);
            }
          }
          const geometry = object.geometry.clone();
          geometry.clearGroups(); geometry.setDrawRange(range.start, range.count);
          // The asset's root rotates Z-up to Y-up and scales its centimetre mesh.
          geometry.applyMatrix4(normalize.clone().multiply(object.matrixWorld));
          const mesh = new THREE.InstancedMesh(geometry, material, TREE_COUNT);
          created.push(mesh); remember(mesh);
          mesh.name = `Trees • ${sourceMaterial.name || object.name || 'primitive'}`;
          mesh.castShadow = mesh.receiveShadow = true;
          mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
          for (let index = 0; index < TREE_COUNT; index++) {
            const { x, z } = positionAt(index);
            const height = MODEL_HEIGHT + Math.sin(index * 3) * .6 + (index % 3) * .1;
            const width = MODEL_WIDTH + Math.sin(index * 5) * .2;
            dummy.position.set(x, -.05, z);
            dummy.rotation.set(0, index * 2.399963229728653, 0);
            dummy.scale.set(width / MODEL_WIDTH, height / MODEL_HEIGHT, width / MODEL_WIDTH);
            dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
          }
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingBox(); mesh.computeBoundingSphere();
        }
      });
      if (!created.length) throw new Error('Tree model contains no mesh primitives');
      const trianglesPerTree = created.reduce((sum, mesh) => sum + triangleCount(mesh.geometry), 0);
      removeMeshes(meshes); meshes = created;
      meshes.forEach((mesh) => scene.add(mesh));
      Object.assign(status, {
        state: 'ready', fallback: false, primitiveCount: meshes.length,
        materialCount: materialCache.size, drawCalls: meshes.length,
        trianglesPerTree, triangles: trianglesPerTree * TREE_COUNT,
        sourceSize: { x: size.x, y: size.y, z: size.z },
        normalizedSize: { height: MODEL_HEIGHT, width: MODEL_WIDTH },
        variation: { minHeight: 7.5, maxHeight: 8.9, minWidth: 4.45, maxWidth: 4.85 },
      });
      status.assets.tree = 'ready';
    } catch (error) {
      const usedMaterials = new Set(created.map((mesh) => mesh.material));
      removeMeshes(created);
      for (const material of materialCache.values()) {
        if (!usedMaterials.has(material)) material.dispose();
      }
      for (const texture of sourceResources.textures) owned.textures.delete(texture);
      throw error;
    } finally {
      disposeResources(sourceResources, owned.textures);
    }
  }

  const ready = new GLTFLoader().loadAsync(modelURL).then((gltf) => {
    if (disposed) { disposeResources(resourcesFor(gltf.scene)); return status; }
    loadInstances(gltf);
    return status;
  }).catch((error) => {
    if (!disposed) {
      status.state = 'fallback'; status.assets.tree = 'fallback';
      status.error = error?.message || 'Tree model could not be loaded';
    }
    return status;
  });

  function dispose() {
    if (disposed) return;
    disposed = true;
    removeMeshes(meshes); meshes = [];
    disposeResources(owned);
    owned.geometries.clear(); owned.materials.clear(); owned.textures.clear();
    status.state = 'disposed';
  }

  return { status, ready, dispose };
}
