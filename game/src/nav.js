// Bot navigation: a waypoint graph over the map's open lanes. Edges are built at
// load by testing each pair of nearby nodes for a clear straight line (segment vs
// collider boxes, with a clearance margin), so the graph can never route a bot
// through a wall. Paths are plain BFS — the graph is small and the routes are
// short — and bots re-path when their goal changes.
import * as THREE from 'three';
import { NAV_NODES } from './world.js';

const LINK_DISTANCE = 13;
const CLEARANCE = 0.55;

function segmentHitsBox(a, b, box) {
  // Slab test on the segment, with the box grown by the clearance margin.
  const min = new THREE.Vector3(box.min.x - CLEARANCE, box.min.y, box.min.z - CLEARANCE);
  const max = new THREE.Vector3(box.max.x + CLEARANCE, box.max.y, box.max.z + CLEARANCE);
  let tmin = 0;
  let tmax = 1;
  for (const axis of ['x', 'y', 'z']) {
    const d = b[axis] - a[axis];
    if (Math.abs(d) < 1e-9) {
      if (a[axis] < min[axis] || a[axis] > max[axis]) return false;
    } else {
      let t1 = (min[axis] - a[axis]) / d;
      let t2 = (max[axis] - a[axis]) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

export function createNav(colliders) {
  const nodes = NAV_NODES.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const edges = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      if (a.distanceTo(b) > LINK_DISTANCE) continue;
      let blocked = false;
      for (const box of colliders) {
        // Only boxes that reach above knee height can block a walking line.
        if (box.max.y < 0.6) continue;
        if (segmentHitsBox(a, b, box)) { blocked = true; break; }
      }
      if (!blocked) {
        edges[i].push(j);
        edges[j].push(i);
      }
    }
  }

  function nearestNode(position) {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      const d = nodes[i].distanceToSquared(position);
      if (d < bestDistance) { bestDistance = d; best = i; }
    }
    return best;
  }

  function path(fromPosition, toPosition) {
    const start = nearestNode(fromPosition);
    const goal = nearestNode(toPosition);
    if (start === goal) return [nodes[goal].clone()];
    const previous = new Array(nodes.length).fill(-1);
    const queue = [start];
    previous[start] = start;
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === goal) break;
      for (const next of edges[current]) {
        if (previous[next] === -1) {
          previous[next] = current;
          queue.push(next);
        }
      }
    }
    if (previous[goal] === -1) return [nodes[goal].clone()];
    const waypoints = [];
    let node = goal;
    while (node !== start) {
      waypoints.push(nodes[node].clone());
      node = previous[node];
    }
    waypoints.reverse();
    return waypoints;
  }

  // A straight, unblocked line between two points (for peeking and LOS checks).
  function clearLine(a, b) {
    for (const box of colliders) {
      if (box.max.y < 0.6) continue;
      if (segmentHitsBox(a, b, box)) return false;
    }
    return true;
  }

  return { nodes, edges, nearestNode, path, clearLine };
}
