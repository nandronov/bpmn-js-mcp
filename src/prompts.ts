/**
 * MCP Prompts — modeling style toggles.
 *
 * Three prompts that set the modeling context for the agent session.
 * Each instructs the agent on which BPMN structure to use, which tools
 * to call, and reminds it to export the final diagram via export_bpmn.
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { type PromptDefinition, ADDITIONAL_PROMPTS } from './prompt-definitions';

// ── Shared export reminder ─────────────────────────────────────────────────

const EXPORT_REMINDER =
  `\n\n**Export:** When the diagram is complete, always run ` +
  `\`export_bpmn\` with \`format: "both"\` and a \`filePath\` argument to ` +
  `save the BPMN XML to disk. This ensures the work is persisted.\n` +
  `Example: \`export_bpmn({ diagramId, format: "both", filePath: "output/my-process.bpmn" })\``;

// ── Prompt definitions ─────────────────────────────────────────────────────

const PROMPTS: PromptDefinition[] = [
  {
    name: 'executable',
    title: 'Executable BPMN process (no pool)',
    description:
      'Model an executable Operaton / Camunda 7 process as a flat process without ' +
      'a participant pool. Suitable for simple deployable workflows.',
    arguments: [],
    getMessages: () => [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `You are now modeling an **executable BPMN process without a pool** ` +
            `for Operaton / Camunda 7.\n\n` +
            `**Structure rules:**\n` +
            `- Do NOT create any participant pools — model a flat process.\n` +
            `- The process must be executable: set \`isExecutable: true\` on the process ` +
            `(this is the default for \`create_bpmn_diagram\`).\n` +
            `- Use \`create_bpmn_diagram\` to start, then \`add_bpmn_element\` / ` +
            `\`add_bpmn_element_chain\` / \`connect_bpmn_elements\` to build the flow.\n\n` +
            `**Task configuration (make it deployable):**\n` +
            `- UserTasks: set \`camunda:assignee\` or \`camunda:candidateGroups\`. ` +
            `Add form fields with \`set_bpmn_form_data\` or set \`camunda:formRef\`.\n` +
            `- ServiceTasks: set \`camunda:type\` to "external" and \`camunda:topic\` ` +
            `for external task workers.\n` +
            `- BusinessRuleTasks: set \`camunda:decisionRef\` to a DMN decision table ID.\n` +
            `- Gateways: always set condition expressions on outgoing flows and mark ` +
            `one flow as the default with \`isDefault: true\`.\n\n` +
            `**Workflow:**\n` +
            `1. \`create_bpmn_diagram\` → build flow → configure tasks\n` +
            `2. \`layout_bpmn_diagram\` to arrange elements\n` +
            `3. \`validate_bpmn_diagram\` to check for issues\n` +
            `4. Fix any reported issues\n` +
            `5. \`export_bpmn\` with \`filePath\` to save` +
            EXPORT_REMINDER,
        },
      },
    ],
  },
  {
    name: 'executable-pool',
    title: 'Executable BPMN process with pool',
    description:
      'Model an executable Operaton / Camunda 7 process wrapped in a participant ' +
      'pool, optionally with swim lanes for role separation and collapsed partner ' +
      'pools for external system documentation.',
    arguments: [],
    getMessages: () => [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `You are now modeling an **executable BPMN process with a participant pool** ` +
            `for Operaton / Camunda 7.\n\n` +
            `**Structure rules:**\n` +
            `- Create ONE expanded participant pool for the executable process using ` +
            `\`create_bpmn_participant\`.\n` +
            `- Optionally add **lanes** for role separation: pass a \`lanes\` array to ` +
            `\`create_bpmn_participant\` (e.g. \`lanes: [{ name: "Manager" }, { name: "Clerk" }]\`).\n` +
            `- When placing elements, always specify \`participantId\` (and \`laneId\` if ` +
            `using lanes) in \`add_bpmn_element\` / \`add_bpmn_element_chain\`.\n` +
            `- Optionally add **collapsed partner pools** for external systems: use ` +
            `\`create_bpmn_participant\` with \`participants\` array where partner entries ` +
            `have \`collapsed: true\`. Connect via \`connect_bpmn_elements\` (auto-creates ` +
            `message flows across pools).\n` +
            `- **Only ONE pool is executable** in Camunda 7 — partner pools are for ` +
            `documentation only.\n\n` +
            `**Task configuration (make it deployable):**\n` +
            `- UserTasks: set \`camunda:assignee\` or \`camunda:candidateGroups\`. ` +
            `Match the lane role (e.g. lane "Manager" → candidateGroups: "managers").\n` +
            `- ServiceTasks: set \`camunda:type\` to "external" and \`camunda:topic\`.\n` +
            `- Gateways: always set condition expressions and a default flow.\n\n` +
            `**Workflow:**\n` +
            `1. \`create_bpmn_diagram\` → \`create_bpmn_participant\` (with optional lanes)\n` +
            `2. Build flow with \`add_bpmn_element\` (specify participantId/laneId)\n` +
            `3. \`layout_bpmn_diagram\` → \`autosize_bpmn_pools_and_lanes\`\n` +
            `4. \`validate_bpmn_diagram\` → fix issues\n` +
            `5. \`export_bpmn\` with \`filePath\` to save` +
            EXPORT_REMINDER,
        },
      },
    ],
  },
  {
    name: 'collaboration',
    title: 'Collaboration diagram (documentation)',
    description:
      'Model a non-executable collaboration diagram for documentation purposes. ' +
      'Multiple expanded pools show how different organisations or systems interact ' +
      'via message flows. Not intended for engine deployment.',
    arguments: [],
    getMessages: () => [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `You are now modeling a **collaboration diagram for documentation**. ` +
            `This diagram is NOT intended for execution — it documents how multiple ` +
            `organisations or systems interact.\n\n` +
            `**Structure rules:**\n` +
            `- Create **multiple expanded participant pools** using ` +
            `\`create_bpmn_participant\` with a \`participants\` array (each with ` +
            `\`collapsed: false\`).\n` +
            `- Each pool represents a separate organisation, department, or system.\n` +
            `- Use **sequence flows** within a pool and **message flows** between pools.\n` +
            `- Message flows are auto-detected by \`connect_bpmn_elements\` when source ` +
            `and target are in different pools.\n` +
            `- Pools may have **lanes** for internal role separation.\n\n` +
            `**Modeling guidelines (documentation focus):**\n` +
            `- Use descriptive names: verb-object for tasks ("Send Invoice"), ` +
            `questions for gateways ("Payment received?").\n` +
            `- Camunda-specific properties (assignee, topic, forms) are optional — ` +
            `this is for human-readable documentation.\n` +
            `- Use \`manage_bpmn_root_elements\` to define shared bpmn:Message elements ` +
            `for cross-pool communication.\n` +
            `- Add text annotations (\`bpmn:TextAnnotation\`) to clarify non-obvious ` +
            `interactions.\n` +
            `- Use SendTask/ReceiveTask or message throw/catch events to make ` +
            `cross-pool communication explicit.\n\n` +
            `**Workflow:**\n` +
            `1. \`create_bpmn_diagram\` with \`workflowContext: "multi-organization"\`\n` +
            `2. \`create_bpmn_participant\` with multiple expanded pools\n` +
            `3. Build each pool's internal flow independently\n` +
            `4. \`connect_bpmn_elements\` for message flows between pools\n` +
            `5. \`layout_bpmn_diagram\` → \`autosize_bpmn_pools_and_lanes\`\n` +
            `6. \`export_bpmn\` with \`filePath\` and \`skipLint: true\` to save ` +
            `(non-executable diagrams may trigger lint warnings)` +
            EXPORT_REMINDER,
        },
      },
    ],
  },
  ...ADDITIONAL_PROMPTS,
];

/** List all available prompts. */
export function listPrompts(): Array<{
  name: string;
  title: string;
  description: string;
  arguments?: Array<{ name: string; description: string; required?: boolean }>;
}> {
  return PROMPTS.map((p) => ({
    name: p.name,
    title: p.title,
    description: p.description,
    arguments: p.arguments,
  }));
}

/** Get a specific prompt by name, with argument substitution. */
export function getPrompt(
  name: string,
  args: Record<string, string> = {}
): {
  description: string;
  messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }>;
} {
  const prompt = PROMPTS.find((p) => p.name === name);
  if (!prompt) {
    throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${name}`);
  }
  return {
    description: prompt.description,
    messages: prompt.getMessages(args),
  };
}
