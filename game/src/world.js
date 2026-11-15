// The map: MERIDIAN YARD, a container terminal at dusk, 52 x 40 m. Two bomb sites
// (A north-west, B north-east), three lanes — west, mid, east — and container cover
// everywhere. Every box is a collider for fighters and a surface a bullet stops on.
// Plain geometry plus one runtime canvas texture for the asphalt; no models, no
// external assets. Spawn points and site rectangles are data the other modules use.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const WALL_H = 5;
const HALF_X = 26;
const HALF_Z = 20;

// Two bomb sites, each an 8 x 8 m rectangle on the ground.
export const SITES = [
  { id: 'A', center: new THREE.Vector3(-19, 0, -13), minX: -23, maxX: -15, minZ: -17, maxZ: -9 },
  { id: 'B', center: new THREE.Vector3(19, 0, -13), minX: 15, maxX: 23, minZ: -17, maxZ: -9 },
];

export const SPAWNS = {
  vanguard: [
    new THREE.Vector3(0, 0, 17.5),
    new THREE.Vector3(-3, 0, 17.5),
    new THREE.Vector3(3, 0, 17.5),
    new THREE.Vector3(-6, 0, 16),
    new THREE.Vector3(6, 0, 16),
  ],
  ember: [
    new THREE.Vector3(0, 0, -17.5),
    new THREE.Vector3(-4, 0, -17.5),
    new THREE.Vector3(4, 0, -17.5),
    new THREE.Vector3(-8, 0, -16),
    new THREE.Vector3(8, 0, -16),
  ],
};

// Waypoint nodes for the bot nav graph. nav.js connects pairs with a clear
// straight line between them; nodes sit in open lanes so the graph stays connected.
export const NAV_NODES = [
  [0, 17.5], [-4, 17.5], [4, 17.5], // attacker spawn
  [0, 12], [-7, 11], [7, 11], // south mid
  [-13, 8], [13, 8], // lane mouths
  [0, 2], // mid doors
  [-6, -3], [6, -3], [0, -4], // upper mid
  [0, -8], // north gap
  [-8, -12], [8, -12], [0, -14], // connector
  [-8, -16], [8, -16], [-14, -16], [14, -16], // north corridor
  [-14, -13], [-19, -16], [-19, -13], // site A
  [14, -13], [19, -16], [19, -13], // site B
  [-12, 0], [12, 0], // mid-to-lane bridges
  [-22, 14], [-22, 6], [-22, -4], [-22, -10], // west lane
  [22, 14], [22, 6], [22, -4], [22, -10], // east lane
  [0, -17.5], [-5, -17.5], [5, -17.5], // defender spawn
];

function asphaltTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PALETTE.ground;
  ctx.fillRect(0, 0, 256, 256);
  // Speckle.
  for (let i = 0; i < 2600; i += 1) {
    const shade = 38 + Math.floor(Math.random() * 26);
    ctx.fillStyle = `rgb(${shade},${shade + 2},${shade + 6})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  // Faded lane paint.
  ctx.strokeStyle = 'rgba(233,230,223,0.16)';
  ctx.lineWidth = 3;
  ctx.setLineDash([18, 14]);
  ctx.beginPath();
  ctx.moveTo(128, 0);
  ctx.lineTo(128, 256);
  ctx.stroke();
  ctx.setLineDash([]);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(13, 10);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function letterTexture(letter) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(245,166,35,0.92)';
  ctx.font = 'bold 84px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.04,
    });
  }
  const groundMaterial = new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.95, metalness: 0.02 });
  const emissiveLamp = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 2.4,
  });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function cylinder(radius, height, x, z, material) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 14), materials[material]);
    mesh.position.set(x, height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Ground.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(HALF_X * 2 + 4, HALF_Z * 2 + 4), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Perimeter walls.
  box(HALF_X * 2 + 1.2, WALL_H, 0.6, 0, WALL_H / 2, -HALF_Z - 0.3, 'surface');
  box(HALF_X * 2 + 1.2, WALL_H, 0.6, 0, WALL_H / 2, HALF_Z + 0.3, 'surface');
  box(0.6, WALL_H, HALF_Z * 2 + 1.2, -HALF_X - 0.3, WALL_H / 2, 0, 'surface');
  box(0.6, WALL_H, HALF_Z * 2 + 1.2, HALF_X + 0.3, WALL_H / 2, 0, 'surface');

  // Mid container wall (z = 2) with a door gap at x in [-1.5, 1.5].
  box(6.5, 2.6, 1.2, -4.75, 1.3, 2, 'rust');
  box(6.5, 2.6, 1.2, 4.75, 1.3, 2, 'teal');
  box(6.5, 2.6, 1.2, -4.75, 3.9, 2, 'slate');

  // North wall (z = -8) with a centre gap at x in [-2, 2].
  box(10, 3, 0.8, -7, 1.5, -8, 'surface');
  box(10, 3, 0.8, 7, 1.5, -8, 'surface');

  // Lane cover: long containers along the west and east lanes.
  box(6.1, 2.6, 2.4, -18, 1.3, 8, 'rust');
  box(6.1, 2.6, 2.4, -18, 1.3, -2, 'teal');
  box(6.1, 2.6, 2.4, 18, 1.3, 8, 'ochre');
  box(6.1, 2.6, 2.4, 18, 1.3, -2, 'rust');
  // Site approach cover (shortened so the north corridor stays open).
  box(2.4, 2.6, 3.5, -10, 1.3, -11, 'slate');
  box(2.4, 2.6, 3.5, 10, 1.3, -11, 'teal');
  box(6.1, 2.6, 2.4, -6, 1.3, -12, 'rust');
  box(6.1, 2.6, 2.4, 6, 1.3, -12, 'ochre');
  // Spawn cover flanks mid instead of blocking it, so the lane reads at a glance.
  box(1.2, 1.2, 1.2, -4, 0.6, 12.5, 'hairline');
  box(1.2, 1.2, 1.2, 4, 0.6, 12.5, 'hairline');
  // Second layer on two stacks, for height and sightline breaks.
  box(6.1, 2.6, 2.4, -18, 3.9, -2, 'slate');
  box(6.1, 2.6, 2.4, 18, 3.9, 8, 'teal');

  // Crouch crates (1.1 m) and low walls at the sites.
  const crates = [
    [-13, 4, 1.2], [-2, 6.5, 1.2], [3, 6.5, 1.2], [13, 4, 1.2],
    [-10, -4, 1.2], [10, -4, 1.2], [-3, -5.5, 1.2], [3, -5.5, 1.2],
    [-16, -11, 1.2], [-22, -13, 1.2], [16, -11, 1.2], [22, -13, 1.2],
    [-12, 13, 1.2], [12, 13, 1.2], [-3, -11, 1.1],
  ];
  for (const [x, z, size] of crates) box(size, size, size, x, size / 2, z, 'hairline');
  box(4.5, 1.1, 0.7, -19, 0.55, -9.4, 'hairline'); // site A south lip
  box(4.5, 1.1, 0.7, 19, 0.55, -9.4, 'hairline'); // site B south lip

  // Barrels.
  cylinder(0.45, 1.1, -24, 2, 'rust');
  cylinder(0.45, 1.1, -24, 3.2, 'ochre');
  cylinder(0.45, 1.1, 24, -6, 'teal');
  cylinder(0.45, 1.1, -8, 16, 'rust');
  cylinder(0.45, 1.1, 8, 16, 'ochre');

  // Site markers: glowing ground ring plus a floating letter.
  const siteMarkers = [];
  for (const site of SITES) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 3, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.center.x, 0.03, site.center.z);
    group.add(ring);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: letterTexture(site.id), transparent: true, depthWrite: false }));
    sprite.scale.set(2.2, 2.2, 1);
    sprite.position.set(site.center.x, 3.4, site.center.z);
    group.add(sprite);
    siteMarkers.push({ site, ring, sprite });
  }

  // Sodium lamp posts: emissive head + a real point light (only three, for speed).
  const lampSpots = [[-12, 0], [12, 0], [0, -14]];
  for (const [x, z] of lampSpots) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 5.2, 8), materials.hairline);
    pole.position.set(x, 2.6, z);
    group.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.3), emissiveLamp);
    head.position.set(x, 5.2, z);
    group.add(head);
    const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 30, 22, 1.8);
    light.position.set(x, 5, z);
    scene.add(light);
  }

  // Distant skyline silhouettes outside the walls, for depth in wide shots.
  const skyline = new THREE.Group();
  const skyMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#161d29') });
  const silhouettes = [[-34, -26, 8, 18], [-18, -30, 6, 26], [6, -32, 10, 14], [24, -28, 7, 22], [34, -20, 9, 16], [-38, 10, 7, 14], [38, 12, 8, 20]];
  for (const [x, z, w, h] of silhouettes) {
    const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.6), skyMat);
    block.position.set(x, h / 2 - 0.5, z);
    skyline.add(block);
  }
  // Two cranes.
  for (const [x, z] of [[-30, -14], [30, -18]]) {
    const mast = new THREE.Mesh(new THREE.BoxGeometry(1.2, 26, 1.2), skyMat);
    mast.position.set(x, 13, z);
    const jib = new THREE.Mesh(new THREE.BoxGeometry(18, 1, 1), skyMat);
    jib.position.set(x + 6, 25, z);
    skyline.add(mast, jib);
  }
  scene.add(skyline);

  // Light: low warm sun from the west, cool sky fill.
  const sky = new THREE.HemisphereLight(new THREE.Color('#8fa3c7'), new THREE.Color(PALETTE.ground), 1.2);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb45e'), 2.4);
  sun.position.set(-30, 18, 12);
  sun.target.position.set(4, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -32;
  sun.shadow.camera.right = 32;
  sun.shadow.camera.top = 28;
  sun.shadow.camera.bottom = -28;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5a6b8c'), 0.5);
  fill.position.set(20, 14, -18);
  scene.add(fill);

  return { colliders, shootables, group, siteMarkers, sites: SITES, spawns: SPAWNS };
}
