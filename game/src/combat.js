// Combat: hitscan resolution shared by the player and the bots. A shot is a
// segment from a muzzle to a far point. The world can stop it (raycast against
// the map), a fighter's head sphere or torso box can catch it, and armor takes
// half the damage. One damage function, one kill path, one noise event per shot
// (the bots hear gunfire and investigate). Impact sparks are a reused point pool.
import * as THREE from 'three';

const RANGE = 90;
const NOISE_RADIUS = 28;

function segmentHitsSphere(origin, direction, maxDistance, center, radius) {
  const ox = center.x - origin.x;
  const oy = center.y - origin.y;
  const oz = center.z - origin.z;
  const t = ox * direction.x + oy * direction.y + oz * direction.z;
  if (t < 0 || t > maxDistance) return -1;
  const closestSq = ox * ox + oy * oy + oz * oz - t * t;
  if (closestSq > radius * radius) return -1;
  return t - Math.sqrt(radius * radius - closestSq);
}

function segmentHitsBox(origin, direction, maxDistance, center, half) {
  let tmin = 0;
  let tmax = maxDistance;
  const axes = ['x', 'y', 'z'];
  for (let i = 0; i < 3; i += 1) {
    const axis = axes[i];
    const d = direction[axis];
    const min = center[axis] - half[axis];
    const max = center[axis] + half[axis];
    if (Math.abs(d) < 1e-9) {
      if (origin[axis] < min || origin[axis] > max) return -1;
    } else {
      let t1 = (min - origin[axis]) / d;
      let t2 = (max - origin[axis]) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

// Hit volumes of a fighter, from its mover body. Head sits at the eye line,
// torso is a box around the chest.
export function hitVolumes(body) {
  const px = body.position.x;
  const py = body.position.y;
  const pz = body.position.z;
  return {
    head: { center: new THREE.Vector3(px, py + body.eye - 0.14, pz), radius: 0.17 },
    torso: { center: new THREE.Vector3(px, py + 0.95, pz), half: new THREE.Vector3(0.3, 0.55, 0.2) },
  };
}

export function createCombat(scene, worldShootables, onNoise, onKill) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = RANGE;
  const direction = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const endPoint = new THREE.Vector3();

  // Impact sparks: one Points cloud, 48 particles, reused.
  const SPARKS = 48;
  const sparkPositions = new Float32Array(SPARKS * 3);
  const sparkVelocities = [];
  for (let i = 0; i < SPARKS; i += 1) sparkVelocities.push(new THREE.Vector3());
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  const sparkMaterial = new THREE.PointsMaterial({ color: 0xf5a623, size: 0.09, transparent: true, opacity: 0.95, depthWrite: false });
  const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
  sparks.frustumCulled = false;
  scene.add(sparks);
  const sparkLife = new Float32Array(SPARKS);
  let sparkIndex = 0;

  function burst(point, count) {
    for (let i = 0; i < count; i += 1) {
      const index = sparkIndex;
      sparkIndex = (sparkIndex + 1) % SPARKS;
      sparkPositions[index * 3] = point.x;
      sparkPositions[index * 3 + 1] = point.y;
      sparkPositions[index * 3 + 2] = point.z;
      sparkVelocities[index].set((Math.random() - 0.5) * 3, Math.random() * 2.5 + 0.5, (Math.random() - 0.5) * 3);
      sparkLife[index] = 0.35;
    }
    sparkGeometry.attributes.position.needsUpdate = true;
  }

  function step(dt) {
    let any = false;
    for (let i = 0; i < SPARKS; i += 1) {
      if (sparkLife[i] <= 0) continue;
      any = true;
      sparkLife[i] -= dt;
      sparkVelocities[i].y -= 9 * dt;
      sparkPositions[i * 3] += sparkVelocities[i].x * dt;
      sparkPositions[i * 3 + 1] += sparkVelocities[i].y * dt;
      sparkPositions[i * 3 + 2] += sparkVelocities[i].z * dt;
      if (sparkPositions[i * 3 + 1] < 0.02) { sparkPositions[i * 3 + 1] = 0.02; sparkVelocities[i].y = 0; }
    }
    if (any) sparkGeometry.attributes.position.needsUpdate = true;
    sparkMaterial.opacity = 0.95;
  }

  function falloff(damage, distance) {
    if (distance <= 25) return damage;
    return damage * Math.max(0.7, 1 - 0.3 * (distance - 25) / 40);
  }

  // Apply damage to a fighter. Returns { killed, damage }.
  function damage(target, amount, part, attacker) {
    if (!target.alive) return { killed: false, damage: 0 };
    let dealt = amount;
    if (target.armor > 0) {
      const absorbed = Math.min(target.armor, dealt * 0.5);
      target.armor -= absorbed;
      dealt -= absorbed;
    }
    target.health -= dealt;
    if (target.health <= 0) {
      target.health = 0;
      target.alive = false;
      if (onKill) onKill(attacker, target, part);
      return { killed: true, damage: dealt };
    }
    return { killed: false, damage: dealt };
  }

  // The player's shot: raycast against the world and the bots' hit meshes.
  // shootables are world meshes plus bot head/torso meshes (userData.fighter).
  // Returns { hit: 'world'|'fighter'|'none', fighter, part, point, distance }.
  function playerShot(camera, shootables, spread, random, attacker, self) {
    camera.getWorldDirection(direction);
    direction.x += (random() * 2 - 1) * spread;
    direction.y += (random() * 2 - 1) * spread;
    direction.z += (random() * 2 - 1) * spread;
    direction.normalize();
    origin.copy(camera.position);
    raycaster.set(origin, direction);
    const hits = raycaster.intersectObjects(shootables, false);
    const end = endPoint.copy(origin).addScaledVector(direction, RANGE);
    if (hits.length === 0) return { hit: 'none', point: end, distance: RANGE };
    const hit = hits[0];
    const point = hit.point;
    const distance = hit.distance;
    if (hit.object.userData.fighter) {
      const target = hit.object.userData.fighter;
      if (!target.alive || target === self || target.team === attacker.team) {
        return { hit: 'world', point, distance, blocked: true };
      }
      const part = hit.object.userData.part || 'torso';
      return { hit: 'fighter', fighter: target, part, point, distance };
    }
    burst(point, 5);
    return { hit: 'world', point, distance };
  }

  // A bot's shot: analytic segment tests against every fighter's volumes, with
  // the world as occlusion. Returns the same shape as playerShot.
  function botShot(shooter, fighters, aimDirection, maxDistance = RANGE) {
    origin.copy(shooter.body.position);
    origin.y += shooter.body.eye - 0.1;
    direction.copy(aimDirection).normalize();
    raycaster.set(origin, direction);
    const worldHits = raycaster.intersectObjects(worldShootables, false);
    const wallDistance = worldHits.length > 0 ? worldHits[0].distance : maxDistance;
    let best = null;
    let bestDistance = Math.min(wallDistance, maxDistance);
    for (const target of fighters) {
      if (target === shooter || !target.alive) continue;
      const volumes = hitVolumes(target.body);
      const headT = segmentHitsSphere(origin, direction, bestDistance, volumes.head.center, volumes.head.radius);
      if (headT >= 0) {
        best = { hit: 'fighter', fighter: target, part: 'head', distance: headT };
        bestDistance = headT;
        continue;
      }
      const torsoT = segmentHitsBox(origin, direction, bestDistance, volumes.torso.center, volumes.torso.half);
      if (torsoT >= 0) {
        best = { hit: 'fighter', fighter: target, part: 'torso', distance: torsoT };
        bestDistance = torsoT;
      }
    }
    const end = endPoint.copy(origin).addScaledVector(direction, best ? bestDistance : wallDistance);
    if (best) {
      best.point = end.clone();
      return best;
    }
    if (worldHits.length > 0) {
      burst(worldHits[0].point, 4);
      return { hit: 'world', point: worldHits[0].point, distance: worldHits[0].distance };
    }
    return { hit: 'none', point: end, distance: wallDistance };
  }

  function makeNoise(position) {
    if (onNoise) onNoise(position.clone(), NOISE_RADIUS);
  }

  return { step, damage, falloff, playerShot, botShot, makeNoise, hitVolumes };
}
