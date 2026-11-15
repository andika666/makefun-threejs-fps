// VAULTLINE — boot and the one loop: a fixed 60 Hz simulation feeding a render
// at the display's rate. main.js owns the player, the round flow and the wiring
// between the modules; the modules own their own jobs (world, nav, bots, combat,
// weapons, grenades, bomb, economy, rounds, HUD, audio).
//
// ?shot=start|play|buy|end with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createAudio } from './audio.js';
import { createWorld } from './world.js';
import { createNav } from './nav.js';
import { createMover } from './mover.js';
import { createInput } from './input.js';
import { createWeaponRig, WEAPONS, GRENADE_PRICE, ARMOR_PRICE } from './weapons.js';
import { createCombat, hitVolumes } from './combat.js';
import { createBots } from './bots.js';
import { createGrenades } from './grenade.js';
import { createBomb, PLANT_TIME } from './bomb.js';
import { createEconomy, BUY_ITEMS, KILL_REWARD, OBJECTIVE_REWARD } from './economy.js';
import { createRounds, BUY_SECONDS } from './rounds.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const lowFx = params.get('lowfx') === '1'; // software rendering / weak GPUs
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: !lowFx, powerPreference: 'high-performance' });
renderer.setPixelRatio(lowFx ? 1 : Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = !lowFx;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const audio = createAudio();
const world = createWorld(scene);
const nav = createNav(world.colliders);
const hud = createHud(world);
const rounds = createRounds();
const economy = createEconomy();
const bomb = createBomb(scene, audio);

// The player: a fighter like any bot, driven by keyboard and mouse instead of AI.
const playerMover = createMover(world.colliders, world.spawns.vanguard[0]);
const player = {
  id: 'player',
  name: 'You',
  team: 'vanguard',
  isPlayer: true,
  alive: true,
  health: 100,
  armor: 0,
  body: playerMover.body,
  mover: playerMover,
  weaponId: 'pistol',
  primaryId: null,
  grenades: 0,
  isCarrier: true,
  channel: 0,
};
const rig = createWeaponRig(camera, scene);
const fighters = [player];

const combat = createCombat(scene, world.shootables, (position) => bots.hearNoise(position, 28), onKill);
const bots = createBots(scene, world, nav, combat, audio, random);
for (const bot of bots.fighters) fighters.push(bot);
const grenades = createGrenades(scene, world, nav, combat, audio);
const input = createInput(renderer.domElement, onLockChange);

let started = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let elapsed = 0;
let prevFiring = false;
let stepSoundAt = 0;
let buyOpen = false;
let fovTarget = 74;
let lastShotAt = -10;
let lastMatchText = '';

function onKill(attacker, target, part) {
  hud.killfeed(attacker ? attacker.name : 'Blast', target.name, attacker ? attacker.team : 'ember', part === 'head');
  if (attacker === player) {
    economy.earn(KILL_REWARD);
    audio.hit(true);
    hud.setMoney(economy.state.money);
  }
}

function onPlayerHit(outcome, part, attacker) {
  if (!player.alive) return;
  audio.hurt();
  hud.damageFlash();
  if (outcome.killed) {
    // The bomb passes to the nearest living teammate.
    let best = null;
    let bestDistance = Infinity;
    for (const bot of bots.teammates) {
      if (!bot.alive) continue;
      const distance = bot.body.position.distanceTo(player.body.position);
      if (distance < bestDistance) { best = bot; bestDistance = distance; }
    }
    if (best) {
      best.isCarrier = true;
      bomb.state.carrier = best;
    }
    player.isCarrier = false;
  }
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    audio.unlock();
    hud.hideOverlay();
  } else if (rounds.state.phase === 'match') {
    hud.showOverlay('match', lastMatchText);
  } else if (rounds.state.phase === 'buy') {
    // Unlocked during the buy phase: the menu stays up and is clickable.
    buyOpen = true;
    hud.showBuyMenu(true);
    hud.refreshBuy(economy.state.money);
  } else {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (rounds.state.phase === 'match') startMatch();
  audio.unlock();
  input.requestLock();
});
document.getElementById('buy-resume').addEventListener('click', () => {
  if (shot) return;
  audio.unlock();
  input.requestLock();
});
hud.onBuy((id) => buyItem(id));

function buyItem(id) {
  if (rounds.state.phase !== 'buy' || !player.alive) return;
  const item = BUY_ITEMS.find((entry) => entry.id === id);
  if (!item) return;
  if (!economy.buy(item.price)) {
    audio.deny();
    return;
  }
  if (id === 'armor') {
    player.armor = 50;
  } else if (id === 'grenade') {
    player.grenades = 1;
  } else {
    player.primaryId = id;
    player.weaponId = id;
    rig.equip(id);
  }
  audio.buy();
  hud.setMoney(economy.state.money);
  hud.refreshBuy(economy.state.money);
  hud.setWeapon(WEAPONS[player.weaponId].name, player.grenades);
  hud.setAmmo(rig.state.mag, rig.state.reserve);
}

function setupRound() {
  const survived = player.alive;
  player.body.position.copy(world.spawns.vanguard[0]);
  player.body.velocity.set(0, 0, 0);
  player.body.yaw = 0;
  player.body.pitch = 0;
  player.alive = true;
  player.health = 100;
  if (!survived) {
    player.armor = 0;
    player.weaponId = 'pistol';
    player.primaryId = null;
    player.grenades = 0;
    rig.equip('pistol');
  } else {
    rig.refillReserve();
  }
  player.isCarrier = true;
  player.channel = 0;
  bomb.reset(player);
  bots.resetRound(rounds.state.round, player);
  hud.setHealth(player.health, player.armor);
  hud.setAmmo(rig.state.mag, rig.state.reserve);
  hud.setWeapon(WEAPONS[player.weaponId].name, player.grenades);
  hud.setMoney(economy.state.money);
  hud.setRound(rounds.state.round);
  hud.setScore(rounds.state.score.vanguard, rounds.state.score.ember);
  hud.setBomb(false, 0, '');
  hud.setChannel(null, 0);
  buyOpen = true;
  hud.showBuyMenu(true);
  hud.refreshBuy(economy.state.money);
}

function startMatch() {
  economy.reset();
  rounds.reset();
  setupRound();
  hud.hideOverlay();
  input.requestLock();
}

function finishRound(winner, reason) {
  const playerWon = winner === 'vanguard';
  economy.roundEnd(playerWon);
  hud.setMoney(economy.state.money);
  hud.showBuyMenu(false);
  buyOpen = false;
  hud.setChannel(null, 0);
  const title = playerWon ? 'ROUND WON' : 'ROUND LOST';
  hud.showBanner(title, reason, playerWon, 3600);
  if (playerWon) audio.roundWin();
  else audio.roundLose();
  if (rounds.state.matchWinner) {
    lastMatchText = `${rounds.state.score.vanguard} — ${rounds.state.score.ember}. ${rounds.state.matchWinner === 'vanguard' ? 'Vanguard takes Meridian Yard.' : 'Ember holds Meridian Yard.'}`;
    hud.showOverlay('match', lastMatchText);
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

function checkRoundEnd() {
  if (rounds.state.phase !== 'live') return;
  const emberAlive = bots.defenders.some((bot) => bot.alive);
  const vanAlive = player.alive || bots.teammates.some((bot) => bot.alive);
  if (!bomb.state.planted) {
    if (!emberAlive) {
      if (rounds.endRound('vanguard', 'Ember team eliminated.')) finishRound('vanguard', 'Ember team eliminated.');
      return;
    }
    if (!vanAlive) {
      if (rounds.endRound('ember', 'Vanguard team eliminated.')) finishRound('ember', 'Vanguard team eliminated.');
      return;
    }
  } else if (!emberAlive) {
    if (rounds.endRound('vanguard', 'Ember team eliminated — the charge stands.')) finishRound('vanguard', 'Ember team eliminated — the charge stands.');
  }
}

function syncCamera() {
  camera.position.set(player.body.position.x, player.body.position.y + player.body.eye, player.body.position.z);
  camera.rotation.set(player.body.pitch, player.body.yaw, 0, 'YXZ');
}

function shootPlayer() {
  if (!rig.takeRound()) {
    audio.dryFire();
    rig.state.cooldown = 0.25;
    return;
  }
  const spread = rig.spread(playerMover.groundSpeed()) * (player.body.crouching ? 0.6 : 1) * (fovTarget < 74 ? 0.3 : 1);
  const result = combat.playerShot(camera, world.shootables, spread, random, player, player);
  rig.fire(result.point);
  const def = rig.def();
  audio.shot(def.kind, 0);
  combat.makeNoise(player.body.position);
  playerMover.recoil(def.recoil, (random() * 2 - 1) * def.recoil * 0.4);
  if (result.hit === 'fighter') {
    const damage = combat.falloff(def.damage * (result.part === 'head' ? def.headMult : 1), result.distance);
    const outcome = combat.damage(result.fighter, damage, result.part, player);
    audio.hit(outcome.killed);
    hud.hitMarker(outcome.killed, 4000);
  }
  hud.setAmmo(rig.state.mag, rig.state.reserve);
  lastShotAt = elapsed;
}

function siteAt(position) {
  for (const site of world.sites) {
    if (position.x >= site.minX && position.x <= site.maxX && position.z >= site.minZ && position.z <= site.maxZ) return site;
  }
  return null;
}

function stepPlayer(dt) {
  const keys = input.state.keys;
  const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const sin = Math.sin(player.body.yaw);
  const cos = Math.cos(player.body.yaw);
  const wishX = -sin * forward + cos * strafe;
  const wishZ = -cos * forward - sin * strafe;
  const crouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
  const jump = input.takePressed('Space');
  const walk = keys.has('ShiftLeft') || keys.has('ShiftRight');
  playerMover.step(dt, wishX, wishZ, crouch, jump, walk ? 0.5 : 1);

  // Footsteps.
  const speed = playerMover.groundSpeed();
  if (speed > 1 && player.body.onGround && elapsed - stepSoundAt > 0.45) {
    stepSoundAt = elapsed;
    audio.step();
  }

  // Zoom: right mouse with the sniper.
  fovTarget = input.state.zooming && player.weaponId === 'sniper' ? 30 : 74;
  if (Math.abs(camera.fov - fovTarget) > 0.5) {
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
  }

  // Weapon slots: 1 primary, 2 pistol.
  if (input.takePressed('Digit1') && player.primaryId) {
    player.weaponId = player.primaryId;
    rig.equip(player.primaryId, true);
    hud.setWeapon(WEAPONS[player.weaponId].name, player.grenades);
    hud.setAmmo(rig.state.mag, rig.state.reserve);
  }
  if (input.takePressed('Digit2')) {
    player.weaponId = 'pistol';
    rig.equip('pistol', true);
    hud.setWeapon(WEAPONS[player.weaponId].name, player.grenades);
    hud.setAmmo(rig.state.mag, rig.state.reserve);
  }
  if (input.takePressed('KeyR') && rig.reload()) audio.reload();

  // Grenade.
  if (input.takePressed('KeyG') && player.grenades > 0 && rounds.state.phase === 'live') {
    player.grenades -= 1;
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    const origin = camera.position.clone().addScaledVector(direction, 0.5);
    origin.y -= 0.1;
    grenades.throwGrenade(origin, direction, 13);
    hud.setWeapon(WEAPONS[player.weaponId].name, player.grenades);
  }

  // Planting: hold E inside a site while carrying the charge.
  const site = siteAt(player.body.position);
  if (rounds.state.phase === 'live' && player.isCarrier && !bomb.state.planted && site && keys.has('KeyE')) {
    player.channel += dt;
    hud.setChannel(`Planting charge — site ${site.id}`, player.channel / PLANT_TIME);
    if (player.channel >= PLANT_TIME) {
      bomb.plant(site.id, player.body.position);
      economy.earn(OBJECTIVE_REWARD);
      hud.setMoney(economy.state.money);
      hud.setChannel(null, 0);
      hud.showBanner('CHARGE PLANTED', `Site ${site.id} — defend it until it blows.`, true, 3000);
      player.isCarrier = false;
      player.channel = 0;
    }
  } else {
    if (player.channel > 0) {
      player.channel = Math.max(0, player.channel - dt * 2);
      hud.setChannel(player.channel > 0.05 ? 'Planting charge' : null, player.channel / PLANT_TIME);
    } else {
      hud.setChannel(null, 0);
    }
  }
}

function step(dt) {
  elapsed += dt;
  const phase = rounds.state.phase;

  // Round clock.
  const clockEvent = rounds.step(dt);
  if (clockEvent === 'buy-timeout' && phase === 'buy') {
    buyOpen = false;
    hud.showBuyMenu(false);
    rounds.startRound();
    if (!input.state.locked && !shot) hud.showOverlay('paused');
  } else if (clockEvent === 'round-timeout') {
    if (rounds.endRound('ember', 'Time expired — the charge was never planted.')) finishRound('ember', 'Time expired — the charge was never planted.');
  } else if (clockEvent === 'round-end-done') {
    if (rounds.state.matchWinner) {
      rounds.state.phase = 'match';
    } else {
      rounds.nextRound();
      setupRound();
    }
  }

  // Buy menu toggle.
  if (input.takePressed('KeyB') && rounds.state.phase === 'buy') {
    buyOpen = !buyOpen;
    hud.showBuyMenu(buyOpen);
    hud.refreshBuy(economy.state.money);
  }
  if (rounds.state.phase === 'buy') {
    for (let i = 0; i < BUY_ITEMS.length; i += 1) {
      if (input.takePressed(`Digit${i + 1}`)) buyItem(BUY_ITEMS[i].id);
    }
  }

  // The player can move during the buy phase (like freeze time); firing,
  // grenades and the bots only run once the round is live.
  if (rounds.state.phase === 'buy' && player.alive) stepPlayer(dt);

  if (phase === 'live' || rounds.state.phase === 'live') {
    if (player.alive) stepPlayer(dt);
    // Firing: autos hold, semis fire on the press edge.
    if (player.alive && input.state.firing && rig.ready()) {
      if (rig.def().auto || !prevFiring) shootPlayer();
    }
    prevFiring = input.state.firing;
    rig.step(dt);
    grenades.step(dt, fighters, onPlayerHit);
    const exploded = bomb.step(dt);
    if (exploded) {
      if (rounds.endRound('vanguard', 'The charge detonated on site ' + bomb.state.siteId + '.')) finishRound('vanguard', 'The charge detonated on site ' + bomb.state.siteId + '.');
    }
    bots.step(dt, {
      time: elapsed,
      fighters,
      player,
      phase: rounds.state.phase,
      bomb: bomb.state,
      rig,
      onPlant: (bot, siteId) => {
        bomb.plant(siteId, bot.body.position);
        hud.showBanner('CHARGE PLANTED', `${bot.name} planted on site ${siteId} — defend it.`, true, 3000);
      },
      onDefuse: (bot) => {
        bomb.defuse();
        if (rounds.endRound('ember', `${bot.name} defused the charge.`)) finishRound('ember', `${bot.name} defused the charge.`);
      },
      onPlayerHit,
    });
    combat.step(dt);
    checkRoundEnd();
  } else {
    rig.step(dt);
    combat.step(dt);
  }

  // HUD, every step (setters skip unchanged values).
  hud.setHealth(player.health, player.armor);
  hud.setAmmo(rig.state.mag, rig.state.reserve);
  hud.setTimer(rounds.state.timeLeft, rounds.state.phase);
  hud.setScore(rounds.state.score.vanguard, rounds.state.score.ember);
  hud.setBomb(bomb.state.planted, bomb.state.timeLeft, bomb.state.siteId || '');
  hud.setCrosshairGap(6 + rig.spread(playerMover.groundSpeed()) * 900);
  hud.drawMinimap(fighters, bomb, player);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    playerMover.look(look.x, look.y);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

// --- Deterministic screenshot staging -------------------------------------
function runShot(name) {
  hud.hideOverlay();
  setupRound();
  // setupRound opens the buy menu; shots stage their own UI after it.
  hud.showBuyMenu(false);
  buyOpen = false;
  rounds.state.phase = 'live';
  rounds.state.timeLeft = 62;

  if (name === 'start') {
    // Spawn view down mid: three teammates ahead, site letters in the distance.
    // Settle first, then stage: settle steps the bots, so staging comes last.
    player.body.position.set(0, 0, 17.5);
    player.body.yaw = 0;
    player.body.pitch = 0;
    settle(30);
    bots.teammates[0].body.position.set(-2.5, 0, 12);
    bots.teammates[0].body.yaw = 0;
    bots.teammates[0].visual.group.position.set(-2.5, 0, 12);
    bots.teammates[0].visual.group.rotation.y = 0;
    bots.teammates[1].body.position.set(2.5, 0, 12);
    bots.teammates[1].body.yaw = 0;
    bots.teammates[1].visual.group.position.set(2.5, 0, 12);
    bots.teammates[1].visual.group.rotation.y = 0;
    bots.teammates[2].body.position.set(0, 0, 9);
    bots.teammates[2].body.yaw = 0.3;
    bots.teammates[2].visual.group.position.set(0, 0, 9);
    bots.teammates[2].visual.group.rotation.y = 0.3;
  } else if (name === 'play') {
    // Mid firefight: an Ember bot in the crosshair, tracer and flash frozen.
    player.body.position.set(0, 0, 8);
    player.body.yaw = 0;
    player.body.pitch = 0;
    rig.equip('rifle');
    player.weaponId = 'rifle';
    player.primaryId = 'rifle';
    settle(20);
    const enemy = bots.defenders[4];
    enemy.body.position.set(1.5, 0, -4);
    enemy.body.yaw = Math.PI;
    enemy.alive = true;
    enemy.visual.group.position.set(1.5, 0, -4);
    enemy.visual.group.rotation.y = Math.PI;
    bots.teammates[0].body.position.set(-3, 0, 4);
    bots.teammates[0].body.yaw = 0;
    bots.teammates[0].visual.group.position.set(-3, 0, 4);
    bots.teammates[0].visual.group.rotation.y = 0;
    const target = new THREE.Vector3(1.5, 1.2, -4);
    const dx = target.x - player.body.position.x;
    const dy = target.y - (player.body.position.y + player.body.eye);
    const dz = target.z - player.body.position.z;
    const length = Math.hypot(dx, dy, dz);
    player.body.yaw = Math.atan2(-dx, -dz);
    player.body.pitch = Math.asin(dy / length);
    syncCamera();
    shootPlayer();
    settle(2);
  } else if (name === 'buy') {
    // Buy phase with the menu open and money to spend.
    rounds.state.phase = 'buy';
    rounds.state.timeLeft = BUY_SECONDS;
    economy.state.money = 3850;
    hud.setMoney(3850);
    player.body.position.set(0, 0, 17.5);
    player.body.yaw = 0;
    buyOpen = true;
    hud.showBuyMenu(true);
    hud.refreshBuy(3850);
    settle(20);
  } else {
    // Round won at site A: banner, planted charge, a fallen defender.
    // Stand back from the site so the lip does not hide the fallen bot.
    player.body.position.set(-19, 0, -1);
    player.body.yaw = -0.12;
    player.body.pitch = -0.04;
    settle(20);
    bomb.plant('A', new THREE.Vector3(-19, 0, -13));
    const fallen = bots.defenders[0];
    fallen.body.position.set(-17.5, 0, -12.5);
    fallen.alive = false;
    fallen.fall = 1;
    fallen.visual.group.position.set(-17.5, 0, -12.5);
    fallen.visual.group.rotation.x = -1.45;
    fallen.visual.group.position.y = -0.08;
    bots.teammates[0].body.position.set(-21, 0, -9);
    bots.teammates[0].body.yaw = 0.5;
    bots.teammates[0].visual.group.position.set(-21, 0, -9);
    bots.teammates[0].visual.group.rotation.y = 0.5;
    rounds.state.score.vanguard = 2;
    rounds.state.score.ember = 1;
    hud.setScore(2, 1);
    hud.showBanner('ROUND WON', 'The charge detonated on site A.', true, 60000);
    hud.setBomb(true, 12, 'A');
  }
  hud.setHealth(player.health, player.armor);
  hud.setAmmo(rig.state.mag, rig.state.reserve);
  hud.setWeapon(WEAPONS[player.weaponId].name, player.grenades);
  hud.setTimer(rounds.state.timeLeft, rounds.state.phase);
  hud.setScore(rounds.state.score.vanguard, rounds.state.score.ember);
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
setupRound();
// Debug handle for automated playtests (read-only state, no gameplay effect).
window.__vaultline = {
  player, rounds: rounds.state, economy: economy.state, bomb: bomb.state, fighters,
  get playerMag() { return rig.state.mag; },
};
if (shot) runShot(shot);
else requestAnimationFrame(frame);
