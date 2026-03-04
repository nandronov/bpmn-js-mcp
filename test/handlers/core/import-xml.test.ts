import { describe, test, expect, beforeEach } from 'vitest';
import { handleImportXml } from '../../../src/handlers';
import { INITIAL_XML } from '../../../src/diagram-manager';
import { parseResult, clearDiagrams } from '../../helpers';

// ── Minimal BPMN fixtures ──────────────────────────────────────────────────

/** Simple linear process: start → task → end (no gateways, no subprocesses). */
const SIMPLE_LINEAR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   id="Definitions_1"
                   targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="Start"/>
    <bpmn:task id="Task_1" name="Do Work"/>
    <bpmn:endEvent id="End_1" name="Done"/>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1"/>
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1"/>
  </bpmn:process>
</bpmn:definitions>`;

/** Process with an exclusive gateway — should always use rebuild. */
const GATEWAY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   id="Definitions_1"
                   targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="Start"/>
    <bpmn:exclusiveGateway id="GW_1" name="Check"/>
    <bpmn:task id="Task_A" name="Path A"/>
    <bpmn:task id="Task_B" name="Path B"/>
    <bpmn:endEvent id="End_1" name="Done"/>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="GW_1"/>
    <bpmn:sequenceFlow id="Flow_2" sourceRef="GW_1" targetRef="Task_A"/>
    <bpmn:sequenceFlow id="Flow_3" sourceRef="GW_1" targetRef="Task_B"/>
    <bpmn:sequenceFlow id="Flow_4" sourceRef="Task_A" targetRef="End_1"/>
    <bpmn:sequenceFlow id="Flow_5" sourceRef="Task_B" targetRef="End_1"/>
  </bpmn:process>
</bpmn:definitions>`;

/** Process with a subprocess — should always use rebuild. */
const SUBPROCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   id="Definitions_1"
                   targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="Start"/>
    <bpmn:subProcess id="Sub_1" name="Sub">
      <bpmn:startEvent id="SubStart_1" name="Sub Start"/>
      <bpmn:endEvent id="SubEnd_1" name="Sub End"/>
      <bpmn:sequenceFlow id="SubFlow_1" sourceRef="SubStart_1" targetRef="SubEnd_1"/>
    </bpmn:subProcess>
    <bpmn:endEvent id="End_1" name="Done"/>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Sub_1"/>
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Sub_1" targetRef="End_1"/>
  </bpmn:process>
</bpmn:definitions>`;

describe('import_bpmn_xml', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('imports valid BPMN XML and returns a new diagramId', async () => {
    const res = parseResult(await handleImportXml({ xml: INITIAL_XML }));
    expect(res.success).toBe(true);
    expect(res.diagramId).toMatch(/^diagram_/);
  });

  // ── Rebuild skip heuristic ───────────────────────────────────────────────

  test('skips rebuild for simple linear processes (no gateways/subprocesses)', async () => {
    const res = parseResult(await handleImportXml({ xml: SIMPLE_LINEAR_XML, autoLayout: true }));
    expect(res.success).toBe(true);
    expect(res.autoLayoutApplied).toBe(true);
    // Simple linear process: rebuild is skipped since bpmn-auto-layout output is clean
    expect(res.rebuildApplied).toBe(false);
  });

  test('uses rebuild for processes with gateways', async () => {
    const res = parseResult(await handleImportXml({ xml: GATEWAY_XML, autoLayout: true }));
    expect(res.success).toBe(true);
    expect(res.autoLayoutApplied).toBe(true);
    // Gateway process: rebuild is always applied for better layout quality
    expect(res.rebuildApplied).toBe(true);
  });

  test('uses rebuild for processes with subprocesses', async () => {
    const res = parseResult(await handleImportXml({ xml: SUBPROCESS_XML, autoLayout: true }));
    expect(res.success).toBe(true);
    expect(res.autoLayoutApplied).toBe(true);
    // Subprocess process: rebuild is always applied
    expect(res.rebuildApplied).toBe(true);
  });

  test('rebuildApplied is false when autoLayout is not applied', async () => {
    // Use INITIAL_XML which already has DI coordinates so autoLayout: false works
    const res = parseResult(await handleImportXml({ xml: INITIAL_XML, autoLayout: false }));
    expect(res.success).toBe(true);
    expect(res.autoLayoutApplied).toBe(false);
    expect(res.rebuildApplied).toBe(false);
  });
});
