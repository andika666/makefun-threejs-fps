// The frag grenade: thrown on an arc, bounces off the map, and bursts after a
// short fuse. Damage falls off with distance and is blocked by walls between the
// burst and the fighter (the nav graph's line test, at chest height). One live
// grenade per fighter at a time; the mesh is a small dark sphere with a blinking
// light while the fuse runs.
import * as THREE from 'three';

const FUSE = 1.6;
const BLAST_RADIUS = 6;
const MAX_DAMAGE = 120;
const MIN_DAMAGE = 20;
const GRAVITY = 12;

export function createGrenades(scene, world, nav, combat, audio) {
  const live = [];
  const geometry = new THREE.SphereGeometry(0.09, 10, 8);
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color('#20242a'), roughness: 0.5, metalness: 0.5 });
  const blinkMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color('#e5484d') });

  function throwGrenade(origin, direction, speed = 13) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(origin);
    scene.add(mesh);
    const blink = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), blinkMaterial);
    blink.position.y = 0.08;
    mesh.add(blink);
    live.push({
      mesh,
      velocity: direction.clone().multiplyScalar(speed).add(new THREE.Vector3(0, 4.5, 0)),
      fuse: FUSE,
      blinkAt: 0,
    });
    audio.bounce();
  }

  function collide(position, velocity) {
    // Cheap bounce: sample the next position against collider boxes; reflect the
    // axis that hit. Good enough for a 9 cm sphere in a box world.
    const next = position.clone().addScaledVector(velocity, 1 / 60);
    for (const box of world.colliders) {
      if (next.x > box.min.x - 0.09 && next.x < box.max.x + 0.09
        && next.y > box.min.y - 0.09 && next.y < box.max.y + 0.09
        && next.z > box.min.z - 0.09 && next.z < box.max.z + 0.09) {
        const dxMin = Math.abs(next.x - (box.min.x - 0.09));
        const dxMax = Math.abs(next.x - (box.max.x + 0.09));
        const dzMin = Math.abs(next.z - (box.min.z - 0.09));
        const dzMax = Math.abs(next.z - (box.max.z + 0.09));
        const dyMin = Math.abs(next.y - (box.min.y - 0.09));
        const dyMax = Math.abs(next.y - (box.max.y + 0.09));
        const smallest = Math.min(dxMin, dxMax, dzMin, dzMax, dyMin, dyMax);
        if (smallest === dxMin || smallest === dxMax) velocity.x *= -0.45;
        else if (smallest === dzMin || smallest === dzMax) velocity.z *= -0.45;
        else velocity.y *= -0.45;
        audio.bounce();
        return;
      }
    }
  }

  function explode(grenade, fighters, onPlayerHit) {
    const point = grenade.mesh.position;
    audio.explosion();
    combat.makeNoise(point);
    for (const fighter of fighters) {
      if (!fighter.alive) continue;
      const chest = new THREE.Vector3(fighter.body.position.x, fighter.body.position.y + 1.1, fighter.body.position.z);
      const distance = point.distanceTo(chest);
      if (distance > BLAST_RADIUS) continue;
      const from = new THREE.Vector3(point.x, point.y + 0.3, point.z);
      if (!nav.clearLine(from, chest)) continue;
      const damage = MAX_DAMAGE - (MAX_DAMAGE - MIN_DAMAGE) * (distance / BLAST_RADIUS);
      const outcome = combat.damage(fighter, damage, 'torso', null);
      if (fighter.isPlayer && onPlayerHit) onPlayerHit(outcome, 'torso', null);
    }
  }

  function step(dt, fighters, onPlayerHit) {
    for (let i = live.length - 1; i >= 0; i -= 1) {
      const grenade = live[i];
      grenade.fuse -= dt;
      grenade.velocity.y -= GRAVITY * dt;
      collide(grenade.mesh.position, grenade.velocity);
      grenade.mesh.position.addScaledVector(grenade.velocity, dt);
      if (grenade.mesh.position.y < 0.09) {
        grenade.mesh.position.y = 0.09;
        grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.4;
        grenade.velocity.x *= 0.7;
        grenade.velocity.z *= 0.7;
      }
      grenade.blinkAt += dt;
      grenade.mesh.children[0].visible = grenade.blinkAt % 0.25 < 0.12;
      if (grenade.fuse <= 0) {
        explode(grenade, fighters, onPlayerHit);
        scene.remove(grenade.mesh);
        live.splice(i, 1);
      }
    }
  }

  return { throwGrenade, step, count: () => live.length };
}
