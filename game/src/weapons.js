// Weapons: the numbers, the view models, and the firing state. Four guns, one
// grenade (grenade.js). Damage is body damage; the head multiplier and the armor
// rule live in combat.js. Spread grows with movement speed, recoil kicks the
// view up, and every shot draws a tracer from the muzzle — the player sees
// exactly what the numbers do.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    name: 'P9 Sidearm', price: 0, kind: 'pistol', damage: 26, headMult: 4, fireGap: 0.14, auto: false,
    mag: 12, reserve: 36, spreadStill: 0.004, spreadMove: 0.02, recoil: 0.008, kick: 0.03,
  },
  smg: {
    name: 'Raptor-9', price: 1500, kind: 'smg', damage: 22, headMult: 4, fireGap: 0.075, auto: true,
    mag: 28, reserve: 84, spreadStill: 0.006, spreadMove: 0.03, recoil: 0.007, kick: 0.025,
  },
  rifle: {
    name: 'VK-47', price: 2700, kind: 'rifle', damage: 34, headMult: 4, fireGap: 0.105, auto: true,
    mag: 30, reserve: 90, spreadStill: 0.003, spreadMove: 0.026, recoil: 0.011, kick: 0.045,
  },
  sniper: {
    name: 'Longbow .50', price: 4750, kind: 'sniper', damage: 110, headMult: 2, fireGap: 1.1, auto: false,
    mag: 5, reserve: 15, spreadStill: 0.0005, spreadMove: 0.045, recoil: 0.05, kick: 0.12,
  },
};

export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 650;

const TRACER_COUNT = 10;
const TRACER_LIFE = 0.07;

function buildModel(kind) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.6, metalness: 0.3 });
  const light = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.45, metalness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });
  const group = new THREE.Group();
  function part(material, w, h, d, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  }
  if (kind === 'pistol') {
    part(dark, 0.05, 0.07, 0.22, 0, 0, -0.1);
    part(dark, 0.045, 0.1, 0.07, 0, -0.07, 0.03);
    part(accent, 0.052, 0.015, 0.05, 0, 0.04, -0.18);
  } else if (kind === 'smg') {
    part(dark, 0.07, 0.09, 0.34, 0, 0, -0.08);
    part(light, 0.04, 0.04, 0.3, 0, 0.02, -0.3);
    part(dark, 0.05, 0.14, 0.06, 0, -0.1, 0.02);
    part(dark, 0.06, 0.06, 0.16, 0, -0.02, 0.22);
    part(accent, 0.072, 0.015, 0.06, 0, 0.05, -0.2);
  } else if (kind === 'sniper') {
    part(dark, 0.08, 0.1, 0.62, 0, 0, -0.12);
    part(light, 0.035, 0.035, 0.5, 0, 0.03, -0.45);
    part(dark, 0.06, 0.06, 0.2, 0, -0.02, 0.28);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), light);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.09, -0.1);
    group.add(scope);
    part(accent, 0.082, 0.015, 0.05, 0, 0.055, -0.3);
  } else {
    part(dark, 0.09, 0.1, 0.42, 0, 0, -0.1);
    part(dark, 0.045, 0.045, 0.4, 0, 0.025, -0.42);
    part(dark, 0.075, 0.08, 0.22, 0, -0.02, 0.28);
    part(dark, 0.05, 0.16, 0.05, 0, -0.11, -0.05);
    part(accent, 0.092, 0.015, 0.06, 0, 0.055, -0.22);
  }
  group.position.set(0.26, -0.24, -0.55);
  group.scale.setScalar(0.85);
  return group;
}

export function createWeaponRig(camera, scene) {
  const models = {};
  for (const kind of ['pistol', 'smg', 'rifle', 'sniper']) {
    models[kind] = buildModel(kind);
    models[kind].visible = false;
    camera.add(models[kind]);
  }

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.18),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.26, -0.22, -1.05);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.26, -0.2, -0.7);
  camera.add(flashLight);

  // A small pool of tracer lines, reused so firing never allocates.
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 }));
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;
  const muzzle = new THREE.Vector3();

  const state = {
    id: 'pistol', mag: 12, reserve: 36, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, reloadTime: 1.9,
  };

  function def() {
    return WEAPONS[state.id];
  }

  function equip(id, keepAmmo = false) {
    if (!WEAPONS[id]) return false;
    for (const kind of Object.keys(models)) models[kind].visible = kind === WEAPONS[id].kind;
    state.id = id;
    if (!keepAmmo) {
      state.mag = WEAPONS[id].mag;
      state.reserve = WEAPONS[id].reserve;
    }
    state.reloadLeft = 0;
    state.cooldown = 0;
    return true;
  }

  function refillReserve() {
    state.reserve = WEAPONS[state.id].reserve;
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[def().kind];
    model.position.z = -0.55 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 8;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (state.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def().mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
    for (const tracer of tracers) {
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      tracer.line.material.opacity = Math.max(0, tracer.life / TRACER_LIFE) * 0.85;
      if (tracer.life <= 0) tracer.line.visible = false;
    }
  }

  return {
    state,
    def,
    equip,
    refillReserve,
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === def().mag || state.reserve === 0) return false;
      state.reloadLeft = state.reloadTime;
      return true;
    },
    spread(speed) {
      const d = def();
      return d.spreadStill + Math.min(1, speed / 5.2) * d.spreadMove;
    },
    // Visual + audio side of a shot; combat.js decides whether it hit.
    fire(endPoint) {
      state.cooldown = def().fireGap;
      state.flash = 0.06;
      state.kick = def().kick;
      const tracer = tracers[tracerIndex];
      tracerIndex = (tracerIndex + 1) % TRACER_COUNT;
      camera.localToWorld(muzzle.set(0.26, -0.2, -1.0));
      const positions = tracer.line.geometry.attributes.position.array;
      positions[0] = muzzle.x;
      positions[1] = muzzle.y;
      positions[2] = muzzle.z;
      positions[3] = endPoint.x;
      positions[4] = endPoint.y;
      positions[5] = endPoint.z;
      tracer.line.geometry.attributes.position.needsUpdate = true;
      tracer.line.visible = true;
      tracer.life = TRACER_LIFE;
    },
    // A tracer from an arbitrary start (bot shots use this).
    tracerFrom(start, endPoint) {
      const tracer = tracers[tracerIndex];
      tracerIndex = (tracerIndex + 1) % TRACER_COUNT;
      const positions = tracer.line.geometry.attributes.position.array;
      positions[0] = start.x;
      positions[1] = start.y;
      positions[2] = start.z;
      positions[3] = endPoint.x;
      positions[4] = endPoint.y;
      positions[5] = endPoint.z;
      tracer.line.geometry.attributes.position.needsUpdate = true;
      tracer.line.visible = true;
      tracer.life = TRACER_LIFE;
    },
  };
}
