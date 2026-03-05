/**
 * Tests for gridSnap integration into RebuildOptions.
 *
 * Verifies that `layout_bpmn_diagram` passes the `gridSnap` option into the
 * rebuild engine so element positions are grid-aligned during the forward pass,
 * not only as a post-processing step.
 *
 * The observable contract: when `gridSnap: N` is passed to the layout handler,
 * element top-left coordinates (x, y) must be multiples of N — even without
 * running the post-processing `applyPixelGridSnap` step separately.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { rebuildLayout } from '../../../src/rebuild';
import { getDiagram } from '../../../src/diagram-manager';
import { handleLayoutDiagram } from '../../../src/handlers';
import {
  createDiagram,
  addElement,
  connect,
  clearDiagrams,
  createSimpleProcess,
} from '../../helpers';

describe('gridSnap in RebuildOptions', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('RebuildOptions accepts gridSnap without typescript error', () => {
    // Type-level check: { gridSnap: 20 } should be assignable to RebuildOptions
    // This test will fail if the property does not exist on the type.
    const opts: Parameters<typeof rebuildLayout>[1] = { gridSnap: 20 };
    expect(opts.gridSnap).toBe(20);
  });

  test('rebuildLayout with gridSnap: 10 snaps element left edges to 10px grid', async () => {
    const diagramId = await createDiagram('Grid 10 test');
    await createSimpleProcess(diagramId);

    const state = getDiagram(diagramId)!;
    rebuildLayout(state, { gridSnap: 10 });

    // snapLeft() aligns LEFT EDGES (x = top-left) to the grid.
    // Y positions are set from origin/branchSpacing; full Y snapping
    // requires applyPixelGridSnap() post-processing (via handleLayoutDiagram).
    const registry = state.modeler.get('elementRegistry') as any;
    const shapes = registry.filter(
      (el: any) =>
        el.type !== 'label' && !el.type.includes('Flow') && el.x !== undefined && el.y !== undefined
    );
    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) {
      expect(shape.x % 10, `x=${shape.x} for ${shape.type}`).toBe(0);
    }
  });

  test('rebuildLayout with gridSnap: 20 snaps element left edges to 20px grid', async () => {
    const diagramId = await createDiagram('Grid 20 test');
    await createSimpleProcess(diagramId);

    const state = getDiagram(diagramId)!;
    rebuildLayout(state, { gridSnap: 20 });

    // Without gridSnap:20 in RebuildOptions, the engine uses the default 10px
    // grid inside snapLeft(). With it, left edges should be 20px-aligned.
    const registry = state.modeler.get('elementRegistry') as any;
    const shapes = registry.filter(
      (el: any) =>
        el.type !== 'label' && !el.type.includes('Flow') && el.x !== undefined && el.y !== undefined
    );
    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) {
      expect(shape.x % 20, `x=${shape.x} for ${shape.type}`).toBe(0);
    }
  });

  test('layout_bpmn_diagram passes gridSnap to rebuild engine', async () => {
    const diagramId = await createDiagram('Integration grid snap test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task A' });
    const task2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Task B' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, task1);
    await connect(diagramId, task1, task2);
    await connect(diagramId, task2, end);

    const res = JSON.parse(
      (await handleLayoutDiagram({ diagramId, gridSnap: 20 } as any)).content[0].text
    );
    expect(res.success).toBe(true);

    // Verify all non-flow elements are on the 20px grid
    const state = getDiagram(diagramId)!;
    const registry = state.modeler.get('elementRegistry') as any;
    const shapes = registry.filter(
      (el: any) =>
        el.type !== 'label' && !el.type.includes('Flow') && el.x !== undefined && el.y !== undefined
    );
    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) {
      expect(shape.x % 20, `x=${shape.x} for ${shape.type}`).toBe(0);
      expect(shape.y % 20, `y=${shape.y} for ${shape.type}`).toBe(0);
    }
  });

  test('rebuildLayout with no gridSnap aligns left edges to default 10px grid', async () => {
    const diagramId = await createDiagram('Default grid test');
    await createSimpleProcess(diagramId);

    const state = getDiagram(diagramId)!;
    rebuildLayout(state);

    // The default behavior (POSITION_GRID = 10) snaps left edges to 10px.
    const registry = state.modeler.get('elementRegistry') as any;
    const shapes = registry.filter(
      (el: any) =>
        el.type !== 'label' && !el.type.includes('Flow') && el.x !== undefined && el.y !== undefined
    );
    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) {
      expect(shape.x % 10, `x=${shape.x} for ${shape.type}`).toBe(0);
    }
  });
});
