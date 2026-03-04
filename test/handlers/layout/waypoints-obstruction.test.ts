/**
 * Tests for obstruction-aware L-shape waypoint routing.
 *
 * When the intermediate segment of an L-shape path crosses through another
 * element, `resetStaleWaypoints` should route via a U-shape detour that
 * avoids the obstruction rather than cutting through it.
 *
 * See TODO: "Add obstruction-aware connection routing".
 */

import { describe, test, expect } from 'vitest';
import { resetStaleWaypoints } from '../../../src/rebuild/waypoints';
import { segmentIntersectsRect } from '../../../src/geometry';

// ── Helpers ────────────────────────────────────────────────────────────────

interface BpmnBox {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parent?: { children: BpmnBox[] };
}

/**
 * Check whether any segment of a waypoint path intersects an element bounding box.
 * Shrinks the rect by 1px on all sides to avoid false positives at endpoints.
 */
function pathIntersectsElement(
  waypoints: Array<{ x: number; y: number }>,
  el: { x: number; y: number; width: number; height: number }
): boolean {
  const rect = { x: el.x + 1, y: el.y + 1, width: el.width - 2, height: el.height - 2 };
  for (let i = 0; i < waypoints.length - 1; i++) {
    if (segmentIntersectsRect(waypoints[i], waypoints[i + 1], rect)) return true;
  }
  return false;
}

/**
 * Build a mock connection between two tasks where the L-shape path would
 * cross through an obstructing sibling element.
 *
 * Layout:
 *  Source:     (100, 150, 100×80) — right=200, midY=190
 *  Obstructor: (300, 150, 100×100) — spans x=300-400, y=150-250
 *              L-shape midX=350 passes vertically through this element.
 *  Target:     (500, 330, 100×80) — left=500, midY=370
 *
 * L-shape (naive) waypoints:
 *   (200,190) → (350,190) → (350,370) → (500,370)
 * Vertical segment (350,190→370): x=350 is inside obstructor [300-400]. ✗
 */
function makeObstructedConn(): {
  source: BpmnBox;
  target: BpmnBox;
  obstructor: BpmnBox;
  waypoints: Array<{ x: number; y: number }>;
} {
  const obstructor: BpmnBox = {
    id: 'obstructor',
    type: 'bpmn:Task',
    x: 300,
    y: 150,
    width: 100,
    height: 100,
  };

  const source: BpmnBox = {
    id: 'source',
    type: 'bpmn:Task',
    x: 100,
    y: 150,
    width: 100,
    height: 80,
  };

  const target: BpmnBox = {
    id: 'target',
    type: 'bpmn:Task',
    x: 500,
    y: 330,
    width: 100,
    height: 80,
  };

  // All three share a parent container
  const parent = { children: [source, obstructor, target] as BpmnBox[] };
  source.parent = parent;
  target.parent = parent;
  obstructor.parent = parent;

  // Stale waypoints: exiting from source center X (triggers stale check 4)
  const sourceCenterX = source.x + source.width / 2; // 150
  return {
    source,
    target,
    obstructor,
    waypoints: [
      { x: sourceCenterX, y: source.y + source.height / 2 }, // stale: center X = 150
      { x: target.x + target.width / 2, y: target.y + target.height / 2 },
    ],
  };
}

/**
 * Build a connection where the L-shape path is NOT blocked — obstructor is
 * far below the path (y=600, out of the connection's Y range).
 */
function makeUnobstructedConn(): {
  source: BpmnBox;
  target: BpmnBox;
  waypoints: Array<{ x: number; y: number }>;
} {
  const source: BpmnBox = {
    id: 'source',
    type: 'bpmn:Task',
    x: 100,
    y: 150,
    width: 100,
    height: 80,
  };
  const obstructor: BpmnBox = {
    id: 'obstructor',
    type: 'bpmn:Task',
    x: 250,
    y: 600,
    width: 100,
    height: 80,
  };
  const target: BpmnBox = {
    id: 'target',
    type: 'bpmn:Task',
    x: 500,
    y: 150,
    width: 100,
    height: 80,
  };
  const parent = { children: [source, obstructor, target] as BpmnBox[] };
  source.parent = parent;
  target.parent = parent;
  obstructor.parent = parent;

  const sourceCenterX = source.x + source.width / 2;
  return {
    source,
    target,
    waypoints: [
      { x: sourceCenterX, y: source.y + source.height / 2 },
      { x: target.x + target.width / 2, y: target.y + target.height / 2 },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Obstruction-aware waypoint routing
// ═══════════════════════════════════════════════════════════════════════════

describe('obstruction-aware L-shape routing', () => {
  test('resulting path does NOT pass through the obstructing element', () => {
    const { source, target, obstructor, waypoints } = makeObstructedConn();
    const conn = { source, target, waypoints } as any;

    resetStaleWaypoints(conn);

    // After routing, none of the connection segments should cross through
    // the obstructing element's bounding box.
    expect(pathIntersectsElement(conn.waypoints, obstructor)).toBe(false);
  });

  test('result path has valid start and end waypoints', () => {
    const { source, target, waypoints } = makeObstructedConn();
    const conn = { source, target, waypoints } as any;

    resetStaleWaypoints(conn);

    expect(conn.waypoints.length).toBeGreaterThanOrEqual(2);

    // First waypoint must be at the right edge of source
    const first = conn.waypoints[0];
    const sourceRight = source.x + source.width;
    expect(Math.abs(first.x - sourceRight)).toBeLessThanOrEqual(2);

    // Last waypoint must be at the left edge of target
    const last = conn.waypoints[conn.waypoints.length - 1];
    const targetLeft = target.x;
    expect(Math.abs(last.x - targetLeft)).toBeLessThanOrEqual(2);
  });

  test('unobstructed path uses standard L-shape routing', () => {
    const { source, target, waypoints } = makeUnobstructedConn();
    const conn = { source, target, waypoints } as any;

    resetStaleWaypoints(conn);

    // For an unobstructed same-Y connection, a 2-point straight path is used.
    expect(conn.waypoints.length).toBeGreaterThanOrEqual(2);

    const first = conn.waypoints[0];
    const last = conn.waypoints[conn.waypoints.length - 1];
    expect(Math.abs(first.x - (source.x + source.width))).toBeLessThanOrEqual(2);
    expect(Math.abs(last.x - target.x)).toBeLessThanOrEqual(2);
  });

  test('connection with no parent or siblings falls back to L-shape', () => {
    // No parent → getSiblingBounds returns [] → no obstruction check
    const source = { type: 'bpmn:Task', x: 100, y: 150, width: 100, height: 80 };
    const target = { type: 'bpmn:Task', x: 400, y: 300, width: 100, height: 80 };
    const conn = {
      source,
      target,
      waypoints: [
        { x: 150, y: 190 }, // stale: center X
        { x: 450, y: 340 },
      ],
    } as any;

    resetStaleWaypoints(conn);

    // Should still produce valid waypoints via L-shape
    expect(conn.waypoints.length).toBeGreaterThanOrEqual(2);
    const first = conn.waypoints[0];
    const last = conn.waypoints[conn.waypoints.length - 1];
    expect(Math.abs(first.x - (source.x + source.width))).toBeLessThanOrEqual(2);
    expect(Math.abs(last.x - target.x)).toBeLessThanOrEqual(2);
  });
});
