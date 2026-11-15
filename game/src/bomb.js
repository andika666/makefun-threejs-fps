// The bomb: planted by holding E on a site, a 35-second countdown, defused by
// holding E beside it. While it ticks it beeps faster and faster; the blast ends
// the round for the attackers. The mesh is a small dark case with a blinking red
// light, dropped where it was planted.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const BOMB_TIMER = 35;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;

export function createBomb(scene, audio) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.2, 0.24),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#20242a'), roughness: 0.5, metalness: 0.4 }),
  );
  body.position.y = 0.1;
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 8, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.danger) }),
  );
  light.position.set(0.1, 0.22, 0);
  group.add(body, light);
  group.visible = false;
  scene.add(group);

  const state = {
    planted: false,
    exploded: false,
    defused: false,
    siteId: null,
    position: new THREE.Vector3(),
    timeLeft: BOMB_TIMER,
    carrier: null, // the fighter carrying it (player or a bot)
    plantProgress: 0,
    defuseProgress: 0,
    beepAt: 0,
  };

  function reset(carrier) {
    state.planted = false;
    state.exploded = false;
    state.defused = false;
    state.siteId = null;
    state.timeLeft = BOMB_TIMER;
    state.carrier = carrier;
    state.plantProgress = 0;
    state.defuseProgress = 0;
    state.beepAt = 0;
    group.visible = false;
  }

  function plant(siteId, position) {
    state.planted = true;
    state.siteId = siteId;
    state.position.copy(position);
    state.position.y = 0;
    state.timeLeft = BOMB_TIMER;
    state.beepAt = 0;
    group.position.copy(state.position);
    group.visible = true;
    audio.plantTick();
  }

  function step(dt) {
    if (!state.planted || state.exploded || state.defused) return false;
    state.timeLeft -= dt;
    // Beeps accelerate: every 1 s early, every 0.35 s at the end.
    const interval = 0.35 + (state.timeLeft / BOMB_TIMER) * 0.65;
    state.beepAt += dt;
    if (state.beepAt >= interval) {
      state.beepAt = 0;
      audio.bombTick();
      light.visible = !light.visible;
    }
    if (state.timeLeft <= 0) {
      state.exploded = true;
      group.visible = false;
      audio.explosion();
      return true;
    }
    return false;
  }

  function defuse() {
    state.defused = true;
    group.visible = false;
  }

  return { state, reset, plant, step, defuse, group };
}
