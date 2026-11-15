// Bots: five Ember defenders and four Vanguard teammates, driven by one state
// machine each. A bot follows waypoint routes to its objective, holds a position
// and scans, engages what it can see, investigates gunfire it hears, plants the
// bomb when it carries it, and converges to defuse when the bomb is down. Aim is
// a model, not a cheat: reaction time, angular error that shrinks as it tracks,
// burst fire with pauses, worse while moving. Bots are fair opponents, not
// aimbots — and they lose gunfights they should lose.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createMover } from './mover.js';
import { WEAPONS } from './weapons.js';
import { range } from './rng.js';

const BOT_NAMES = {
  vanguard: ['Rook', 'Havoc', 'Sable', 'Wren'],
  ember: ['Cinder', 'Ash', 'Flint', 'Soot', 'Ember'],
};
const PLANT_TIME = 3;
const DEFUSE_TIME = 5;
const SEE_DISTANCE = 55;
const FOV_COS = -0.15; // ~100 degrees of vision

function buildBotMesh(team) {
  const teamColor = team === 'vanguard' ? PALETTE.vanguard : PALETTE.ember;
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.65, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#20242a'), roughness: 0.8, metalness: 0.1 });
  const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a186'), roughness: 0.7 });
  const group = new THREE.Group();
  function part(material, w, h, d, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }
  part(darkMat, 0.16, 0.72, 0.2, -0.11, 0.36, 0); // left leg
  part(darkMat, 0.16, 0.72, 0.2, 0.11, 0.36, 0); // right leg
  const torso = part(bodyMat, 0.52, 0.62, 0.3, 0, 1.03, 0);
  part(darkMat, 0.5, 0.08, 0.28, 0, 0.72, 0); // belt
  part(darkMat, 0.14, 0.12, 0.14, 0, 1.4, 0); // neck
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), skinMat);
  head.position.set(0, 1.46, 0);
  head.castShadow = true;
  group.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.05), new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), emissive: new THREE.Color(teamColor), emissiveIntensity: 0.8 }));
  visor.position.set(0, 1.48, 0.14);
  group.add(visor);
  part(darkMat, 0.09, 0.09, 0.5, 0.2, 1.15, -0.25); // gun
  part(darkMat, 0.07, 0.3, 0.09, -0.26, 1.05, 0.05); // left arm
  part(darkMat, 0.07, 0.3, 0.09, 0.26, 1.05, 0.05); // right arm
  return { group, torso, head };
}

export function createBots(scene, world, nav, combat, audio, random) {
  const fighters = [];
  const shootables = world.shootables;
  const noises = [];
  let time = 0;

  // Muzzle flash sprites for bot shots, reused.
  const flashes = [];
  for (let i = 0; i < 6; i += 1) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false }));
    sprite.scale.set(0.5, 0.5, 1);
    scene.add(sprite);
    flashes.push({ sprite, life: 0 });
  }
  let flashIndex = 0;

  function showFlash(position) {
    const flash = flashes[flashIndex];
    flashIndex = (flashIndex + 1) % flashes.length;
    flash.sprite.position.copy(position);
    flash.sprite.material.opacity = 0.95;
    flash.life = 0.06;
  }

  function makeBot(team, index, spawn) {
    const mover = createMover(world.colliders, spawn);
    const visual = buildBotMesh(team);
    scene.add(visual.group);
    const bot = {
      id: `${team}-${index}`,
      name: BOT_NAMES[team][index % BOT_NAMES[team].length],
      team,
      isPlayer: false,
      alive: true,
      health: 100,
      armor: 0,
      body: mover.body,
      mover,
      visual,
      weaponId: 'rifle',
      mag: 30,
      reloadLeft: 0,
      cooldown: 0,
      state: 'advance',
      role: 'mid',
      path: [],
      pathIndex: 0,
      goalNode: null,
      holdUntil: 0,
      scanBase: 0,
      visibleEnemy: null,
      visibleSince: 0,
      reactionAt: 0,
      burstLeft: 0,
      burstPauseUntil: 0,
      isCarrier: false,
      channel: 0, // plant/defuse progress seconds
      fall: 0,
      stepPhase: 0,
      heardAt: 0,
    };
    visual.torso.userData.fighter = bot;
    visual.torso.userData.part = 'torso';
    visual.head.userData.fighter = bot;
    visual.head.userData.part = 'head';
    shootables.push(visual.torso, visual.head);
    fighters.push(bot);
    return bot;
  }

  // Five defenders, four teammates; the player is added by main.js.
  const defenders = [];
  const teammates = [];
  for (let i = 0; i < 5; i += 1) defenders.push(makeBot('ember', i, world.spawns.ember[i]));
  for (let i = 0; i < 4; i += 1) teammates.push(makeBot('vanguard', i, world.spawns.vanguard[i + 1]));

  function resetRound(roundNumber, player) {
    time = 0;
    noises.length = 0;
    const loadout = roundNumber >= 2 ? ['rifle', 'rifle', 'smg', 'rifle', 'sniper'] : ['pistol', 'smg', 'pistol', 'smg', 'pistol'];
    for (const bot of fighters) {
      bot.alive = true;
      bot.health = 100;
      bot.armor = roundNumber >= 2 ? 50 : 0;
      bot.fall = 0;
      bot.channel = 0;
      bot.visibleEnemy = null;
      bot.burstLeft = 0;
      bot.reloadLeft = 0;
      bot.cooldown = 0;
      bot.visual.group.rotation.set(0, 0, 0);
      bot.visual.group.position.y = 0;
      bot.weaponId = loadout[fighters.indexOf(bot) % loadout.length];
      bot.mag = WEAPONS[bot.weaponId].mag;
      const spawn = bot.team === 'ember' ? world.spawns.ember[fighters.indexOf(bot) % 5] : world.spawns.vanguard[(fighters.indexOf(bot) + 1) % 5];
      bot.body.position.copy(spawn);
      bot.body.velocity.set(0, 0, 0);
      bot.body.yaw = bot.team === 'ember' ? Math.PI : 0;
      bot.body.pitch = 0;
      bot.isCarrier = false;
      // Glue the visual to the body now: the buy phase does not step bots, so
      // without this they would stand at the origin until the round starts.
      bot.visual.group.position.copy(bot.body.position);
      bot.visual.group.rotation.y = bot.body.yaw;
    }
    // Roles: defenders hold A, B and mid; attackers split across the sites.
    const defendRoles = ['defend-a', 'defend-a', 'defend-b', 'defend-b', 'mid'];
    defenders.forEach((bot, i) => { bot.role = defendRoles[i]; });
    const attackSites = random() < 0.5 ? ['a', 'a', 'b', 'b'] : ['b', 'b', 'a', 'a'];
    teammates.forEach((bot, i) => { bot.role = `attack-${attackSites[i]}`; });
    // The carrier is a teammate bot; the player takes it if they are alive.
    const carrier = teammates[Math.floor(random() * teammates.length)];
    carrier.isCarrier = true;
    assignGoals(player);
  }

  function siteCenter(siteId) {
    const site = world.sites.find((s) => s.id.toUpperCase() === siteId.toUpperCase());
    return site ? site.center : new THREE.Vector3(0, 0, 0);
  }

  function holdSpot(role) {
    if (role === 'defend-a') return new THREE.Vector3(-19 + range(random, -2, 2), 0, -11 + range(random, -2, 2));
    if (role === 'defend-b') return new THREE.Vector3(19 + range(random, -2, 2), 0, -11 + range(random, -2, 2));
    if (role === 'mid') return new THREE.Vector3(range(random, -4, 4), 0, -3);
    return new THREE.Vector3(0, 0, 0);
  }

  function assignGoals(player) {
    for (const bot of fighters) {
      if (!bot.alive) continue;
      if (bot.role.startsWith('attack-')) {
        const site = siteCenter(bot.role.slice(-1));
        bot.path = nav.path(bot.body.position, site);
        bot.pathIndex = 0;
        bot.state = 'advance';
      } else if (bot.role.startsWith('defend-')) {
        const spot = holdSpot(bot.role);
        bot.path = nav.path(bot.body.position, spot);
        bot.pathIndex = 0;
        bot.state = 'advance';
        bot.goalNode = spot;
      } else {
        const spot = holdSpot('mid');
        bot.path = nav.path(bot.body.position, spot);
        bot.pathIndex = 0;
        bot.state = 'advance';
        bot.goalNode = spot;
      }
    }
  }

  function hearNoise(position, radius) {
    noises.push({ position, radius, at: time });
  }

  function eyePosition(bot) {
    return new THREE.Vector3(bot.body.position.x, bot.body.position.y + bot.body.eye, bot.body.position.z);
  }

  function canSee(bot, target) {
    if (!target.alive) return false;
    const eye = eyePosition(bot);
    const chest = new THREE.Vector3(target.body.position.x, target.body.position.y + 1.1, target.body.position.z);
    const distance = eye.distanceTo(chest);
    if (distance > SEE_DISTANCE) return false;
    // Facing check, waived up close or when the target just fired.
    const forward = new THREE.Vector3(-Math.sin(bot.body.yaw), 0, -Math.cos(bot.body.yaw));
    const toTarget = chest.clone().sub(eye).setY(0).normalize();
    if (distance > 8 && forward.dot(toTarget) < FOV_COS) return false;
    return nav.clearLine(eye, chest);
  }

  function nearestNoise(bot) {
    let best = null;
    let bestDistance = Infinity;
    for (const noise of noises) {
      if (time - noise.at > 6) continue;
      const distance = bot.body.position.distanceTo(noise.position);
      if (distance < noise.radius && distance < bestDistance) {
        best = noise;
        bestDistance = distance;
      }
    }
    return best;
  }

  function moveAlongPath(bot, dt) {
    if (bot.pathIndex >= bot.path.length) return true;
    const target = bot.path[bot.pathIndex];
    const dx = target.x - bot.body.position.x;
    const dz = target.z - bot.body.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.6) {
      bot.pathIndex += 1;
      return bot.pathIndex >= bot.path.length;
    }
    const wishX = dx / distance;
    const wishZ = dz / distance;
    bot.mover.step(dt, wishX, wishZ, false, false);
    bot.body.yaw = Math.atan2(-wishX, -wishZ);
    return false;
  }

  function faceTarget(bot, target, dt) {
    const dx = target.body.position.x - bot.body.position.x;
    const dz = target.body.position.z - bot.body.position.z;
    const desired = Math.atan2(-dx, -dz);
    let diff = desired - bot.body.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.body.yaw += diff * Math.min(1, dt * 10);
    const dy = target.body.position.y + 1.2 - (bot.body.position.y + bot.body.eye);
    const distance = Math.hypot(dx, dz);
    bot.body.pitch = Math.atan2(dy, Math.max(1, distance)) * 0.7;
  }

  function fireAt(bot, target, ctx) {
    const def = WEAPONS[bot.weaponId];
    if (bot.reloadLeft > 0 || bot.cooldown > 0) return;
    if (bot.mag <= 0) {
      bot.reloadLeft = 1.9;
      return;
    }
    if (time < bot.burstPauseUntil) return;
    if (bot.burstLeft <= 0) {
      bot.burstLeft = 3 + Math.floor(random() * 3);
      if (random() < 0.3) bot.burstPauseUntil = time + 0.4 + random() * 0.3;
    }
    bot.burstLeft -= 1;
    if (bot.burstLeft === 0) bot.burstPauseUntil = time + 0.35 + random() * 0.3;
    bot.mag -= 1;
    bot.cooldown = def.fireGap;
    const distance = bot.body.position.distanceTo(target.body.position);
    const targetSpeed = Math.hypot(target.body.velocity.x, target.body.velocity.z);
    const ownSpeed = bot.mover.groundSpeed();
    let error = 0.02 + distance * 0.0009 + targetSpeed * 0.004 + ownSpeed * 0.003;
    if (time - bot.visibleSince > 1) error *= 0.6; // tracking settles the aim
    const aimHead = random() < 0.25;
    const aimPoint = new THREE.Vector3(
      target.body.position.x,
      target.body.position.y + (aimHead ? 1.5 : 1.05),
      target.body.position.z,
    );
    const origin = eyePosition(bot);
    const aim = aimPoint.sub(origin).normalize();
    aim.x += (random() * 2 - 1) * error;
    aim.y += (random() * 2 - 1) * error;
    aim.z += (random() * 2 - 1) * error;
    aim.normalize();
    const result = combat.botShot(bot, ctx.fighters, aim);
    const muzzle = origin.clone().addScaledVector(aim, 0.6);
    showFlash(muzzle);
    ctx.rig.tracerFrom(muzzle, result.point);
    audio.shot(def.kind, bot.body.position.distanceTo(ctx.player.body.position));
    combat.makeNoise(bot.body.position);
    if (result.hit === 'fighter') {
      const damage = combat.falloff(def.damage * (result.part === 'head' ? def.headMult : 1), result.distance);
      const outcome = combat.damage(result.fighter, damage, result.part, bot);
      if (result.fighter.isPlayer) ctx.onPlayerHit(outcome, result.part, bot);
    }
  }

  function stepBot(bot, dt, ctx) {
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      bot.visual.group.rotation.x = -bot.fall * 1.45;
      bot.visual.group.position.y = -bot.fall * 0.08;
      return;
    }
    bot.cooldown = Math.max(0, bot.cooldown - dt);
    if (bot.reloadLeft > 0) {
      bot.reloadLeft = Math.max(0, bot.reloadLeft - dt);
      if (bot.reloadLeft === 0) bot.mag = WEAPONS[bot.weaponId].mag;
    }

    // Scan for a visible enemy.
    let seen = null;
    for (const fighter of ctx.fighters) {
      if (fighter === bot || fighter.team === bot.team || !fighter.alive) continue;
      if (canSee(bot, fighter)) { seen = fighter; break; }
    }
    if (seen) {
      if (bot.visibleEnemy !== seen) {
        bot.visibleEnemy = seen;
        bot.visibleSince = time;
        bot.reactionAt = time + 0.35 + random() * 0.35;
      }
    } else {
      bot.visibleEnemy = null;
    }

    if (bot.visibleEnemy) {
      faceTarget(bot, bot.visibleEnemy, dt);
      if (time >= bot.reactionAt) {
        // Strafe while engaging, but hold still to plant/defuse.
        if (bot.state !== 'plant' && bot.state !== 'defuse') {
          const strafe = Math.sin(time * 1.7 + bot.stepPhase) > 0 ? 1 : -1;
          const forward = new THREE.Vector3(-Math.sin(bot.body.yaw), 0, -Math.cos(bot.body.yaw));
          const right = new THREE.Vector3(-forward.z, 0, forward.x);
          bot.mover.step(dt, right.x * strafe * 0.5, right.z * strafe * 0.5, false, false);
        }
        fireAt(bot, bot.visibleEnemy, ctx);
      }
      bot.state = 'engage';
      return;
    }

    // Bomb logic comes before movement: carrier plants, defenders defuse.
    if (ctx.bomb.planted) {
      if (bot.team === 'ember') {
        const bombPos = ctx.bomb.position;
        const distance = bot.body.position.distanceTo(bombPos);
        if (distance < 1.6) {
          bot.state = 'defuse';
          bot.channel += dt;
          if (bot.channel >= DEFUSE_TIME) ctx.onDefuse(bot);
          return;
        }
        bot.channel = 0;
        if (bot.state !== 'advance' || bot.goalNode !== bombPos) {
          bot.path = nav.path(bot.body.position, bombPos);
          bot.pathIndex = 0;
          bot.goalNode = bombPos;
          bot.state = 'advance';
        }
        moveAlongPath(bot, dt);
        return;
      }
      // Attackers guard the planted bomb: hold near it.
      const guard = new THREE.Vector3(ctx.bomb.position.x + range(random, -4, 4), 0, ctx.bomb.position.z + range(random, -4, 4));
      if (bot.body.position.distanceTo(guard) > 3) {
        if (bot.state !== 'advance') {
          bot.path = nav.path(bot.body.position, guard);
          bot.pathIndex = 0;
          bot.state = 'advance';
        }
        moveAlongPath(bot, dt);
      } else {
        bot.state = 'hold';
        bot.body.yaw += Math.sin(time * 0.5 + bot.stepPhase) * dt * 0.6;
      }
      return;
    }

    if (bot.isCarrier && bot.team === 'vanguard') {
      const site = siteCenter(bot.role.slice(-1));
      if (bot.body.position.x >= site.x - 4 && bot.body.position.x <= site.x + 4
        && bot.body.position.z >= site.z - 4 && bot.body.position.z <= site.z + 4) {
        bot.state = 'plant';
        bot.channel += dt;
        if (bot.channel >= PLANT_TIME) ctx.onPlant(bot, bot.role.slice(-1));
        return;
      }
      bot.channel = 0;
    }

    if (bot.state === 'advance') {
      const arrived = moveAlongPath(bot, dt);
      if (arrived) {
        bot.state = bot.role.startsWith('defend-') || bot.role === 'mid' ? 'hold' : 'advance';
        bot.holdUntil = time + 9999;
        bot.scanBase = bot.body.yaw;
      }
      return;
    }

    if (bot.state === 'hold') {
      // Scan the lane: slow yaw sweep.
      bot.body.yaw = bot.scanBase + Math.sin(time * 0.45 + bot.stepPhase) * 0.9;
      // Investigate nearby gunfire.
      const noise = nearestNoise(bot);
      if (noise && time - bot.heardAt > 4) {
        bot.heardAt = time;
        bot.path = nav.path(bot.body.position, noise.position);
        bot.pathIndex = 0;
        bot.state = 'investigate';
        bot.holdUntil = time + 4;
      }
      return;
    }

    if (bot.state === 'investigate') {
      const arrived = moveAlongPath(bot, dt);
      if (arrived || time > bot.holdUntil) {
        bot.body.yaw += dt * 1.2;
        if (time > bot.holdUntil + 1.5) {
          const spot = bot.role.startsWith('defend-') ? holdSpot(bot.role) : siteCenter(bot.role.slice(-1));
          bot.path = nav.path(bot.body.position, spot);
          bot.pathIndex = 0;
          bot.state = 'advance';
        }
      }
      return;
    }

    // Attackers that finished their route without planting hold the site.
    bot.state = 'hold';
    bot.scanBase = bot.body.yaw;
  }

  function step(dt, ctx) {
    time += dt;
    for (const flash of flashes) {
      if (flash.life > 0) {
        flash.life -= dt;
        flash.sprite.material.opacity = Math.max(0, flash.life / 0.06) * 0.95;
      }
    }
    for (const bot of fighters) {
      stepBot(bot, dt, ctx);
      // Keep the visual glued to the mover.
      bot.visual.group.position.set(bot.body.position.x, bot.body.position.y, bot.body.position.z);
      if (bot.alive) bot.visual.group.rotation.y = bot.body.yaw;
    }
  }

  return { fighters, defenders, teammates, resetRound, assignGoals, hearNoise, step };
}
