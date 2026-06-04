import { tool } from '../tools/mcp-compat.js';
import { z } from 'zod';
import { getDb } from '../db.js';
import {
  createPlanFromIdea,
  type Plan,
  type PlanType,
} from '../tools/plans.js';

export type IdeaLane = 'now' | 'next' | 'later' | 'done';

export type Idea = {
  id: string;
  title: string;
  description?: string;
  lane: IdeaLane;
  impact?: string;
  effort?: string;
  problem?: string;
  outcome?: string;
  audience?: string;
  risks?: string;
  notes?: string;
  tags?: string[];
  linkedPlanIds: string[];
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
};

export type IdeasState = {
  items: Idea[];
  version: number;
};

function parseIdeaRow(raw: string): Idea {
  const item = JSON.parse(raw) as Idea;
  return {
    ...item,
    linkedPlanIds: Array.isArray(item.linkedPlanIds) ? item.linkedPlanIds : [],
    lane: item.lane || 'next',
    sortOrder: Number.isFinite(item.sortOrder) ? item.sortOrder : 0,
  };
}

function nextId(items: Idea[]): string {
  const ids = items
    .map((i) => Number.parseInt(i.id, 10))
    .filter((n) => Number.isFinite(n));
  return String((ids.length ? Math.max(...ids) : 0) + 1);
}

function nextSortOrder(items: Idea[], lane: IdeaLane): number {
  const laneItems = items.filter((item) => item.lane === lane);
  if (!laneItems.length) return 1;
  return Math.max(...laneItems.map((item) => item.sortOrder || 0)) + 1;
}

export function loadIdeas(): IdeasState {
  const db = getDb();
  const rows = db.prepare('SELECT data FROM ideas').all() as { data: string }[];
  const items = rows.map((row) => parseIdeaRow(row.data));
  const versionRow = db.prepare("SELECT value FROM ideas_meta WHERE key = 'version'").get() as { value: string } | undefined;
  return {
    items,
    version: versionRow ? Number.parseInt(versionRow.value, 10) : 1,
  };
}

export function saveIdeas(state: IdeasState): void {
  const db = getDb();
  state.version = (state.version || 0) + 1;

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM ideas').run();
    const insert = db.prepare('INSERT INTO ideas (id, data) VALUES (?, ?)');
    for (const item of state.items) {
      insert.run(item.id, JSON.stringify(item));
    }
    db.prepare("INSERT OR REPLACE INTO ideas_meta (key, value) VALUES ('version', ?)").run(String(state.version));
  });

  tx();
}

function ideaSummary(item: Idea): string {
  const outcome = item.outcome ? ` -> ${item.outcome}` : '';
  return `#${item.id} [${item.lane}] ${item.title}${outcome}`;
}

export const ideasViewTool = tool(
  'ideas_view',
  'View ideas organized by lane (now/next/later/done).',
  {
    lane: z.enum(['all', 'now', 'next', 'later', 'done']).optional(),
    id: z.string().optional(),
  },
  async (args) => {
    const state = loadIdeas();

    if (args.id) {
      const item = state.items.find((r) => r.id === args.id);
      if (!item) {
        return { content: [{ type: 'text', text: `Idea #${args.id} not found` }], isError: true };
      }

      const lines = [
        ideaSummary(item),
        item.description ? `Description: ${item.description}` : '',
        item.problem ? `Problem: ${item.problem}` : '',
        item.outcome ? `Outcome: ${item.outcome}` : '',
        item.audience ? `Audience: ${item.audience}` : '',
        item.impact ? `Impact: ${item.impact}` : '',
        item.effort ? `Effort: ${item.effort}` : '',
        item.tags?.length ? `Tags: ${item.tags.join(', ')}` : '',
        item.linkedPlanIds.length ? `Linked plans: ${item.linkedPlanIds.join(', ')}` : 'Linked plans: none',
      ].filter(Boolean);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    const lane = args.lane || 'all';
    const items = lane === 'all'
      ? state.items
      : state.items.filter((item) => item.lane === lane);

    if (!items.length) {
      return { content: [{ type: 'text', text: lane === 'all' ? 'No ideas.' : `No ideas in lane: ${lane}` }] };
    }

    const sorted = [...items].sort((a, b) => {
      if (a.lane !== b.lane) return a.lane.localeCompare(b.lane);
      return (a.sortOrder || 0) - (b.sortOrder || 0);
    });

    const lines = sorted.map((item) => ideaSummary(item));
    return { content: [{ type: 'text', text: `Ideas (${lines.length}):\n\n${lines.join('\n')}` }] };
  },
);

export const ideasAddTool = tool(
  'ideas_add',
  'Add an idea to the ideas board.',
  {
    title: z.string(),
    description: z.string().optional(),
    lane: z.enum(['now', 'next', 'later']).optional(),
    impact: z.string().optional(),
    effort: z.string().optional(),
    problem: z.string().optional(),
    outcome: z.string().optional(),
    audience: z.string().optional(),
    risks: z.string().optional(),
    notes: z.string().optional(),
    tags: z.array(z.string()).optional(),
  },
  async (args) => {
    const state = loadIdeas();
    const now = new Date().toISOString();
    const lane = args.lane || 'next';

    const item: Idea = {
      id: nextId(state.items),
      title: args.title,
      description: args.description,
      lane,
      impact: args.impact,
      effort: args.effort,
      problem: args.problem,
      outcome: args.outcome,
      audience: args.audience,
      risks: args.risks,
      notes: args.notes,
      tags: args.tags,
      linkedPlanIds: [],
      createdAt: now,
      updatedAt: now,
      sortOrder: nextSortOrder(state.items, lane),
    };

    state.items.push(item);
    saveIdeas(state);
    return { content: [{ type: 'text', text: `Idea #${item.id} added to ${item.lane}: ${item.title}` }] };
  },
);

export const ideasUpdateTool = tool(
  'ideas_update',
  'Update an idea\'s fields and lane position.',
  {
    id: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    lane: z.enum(['now', 'next', 'later', 'done']).optional(),
    impact: z.string().optional(),
    effort: z.string().optional(),
    problem: z.string().optional(),
    outcome: z.string().optional(),
    audience: z.string().optional(),
    risks: z.string().optional(),
    notes: z.string().optional(),
    tags: z.array(z.string()).optional(),
    sortOrder: z.number().optional(),
    linkedPlanIds: z.array(z.string()).optional(),
  },
  async (args) => {
    const state = loadIdeas();
    const item = state.items.find((r) => r.id === args.id);
    if (!item) {
      return { content: [{ type: 'text', text: `Idea #${args.id} not found` }], isError: true };
    }

    if (args.title !== undefined) item.title = args.title;
    if (args.description !== undefined) item.description = args.description;
    if (args.impact !== undefined) item.impact = args.impact;
    if (args.effort !== undefined) item.effort = args.effort;
    if (args.problem !== undefined) item.problem = args.problem;
    if (args.outcome !== undefined) item.outcome = args.outcome;
    if (args.audience !== undefined) item.audience = args.audience;
    if (args.risks !== undefined) item.risks = args.risks;
    if (args.notes !== undefined) item.notes = args.notes;
    if (args.tags !== undefined) item.tags = args.tags;
    if (args.linkedPlanIds !== undefined) item.linkedPlanIds = args.linkedPlanIds;
    if (args.lane !== undefined && args.lane !== item.lane) {
      item.lane = args.lane;
      item.sortOrder = nextSortOrder(state.items.filter((r) => r.id !== item.id), item.lane);
    }
    if (args.sortOrder !== undefined) item.sortOrder = args.sortOrder;
    item.updatedAt = new Date().toISOString();
    saveIdeas(state);

    return { content: [{ type: 'text', text: `Idea #${item.id} updated` }] };
  },
);

export const ideasDeleteTool = tool(
  'ideas_delete',
  'Delete an idea from the board.',
  {
    id: z.string(),
  },
  async (args) => {
    const state = loadIdeas();
    const before = state.items.length;
    state.items = state.items.filter((i) => i.id !== args.id);
    if (state.items.length === before) {
      return { content: [{ type: 'text', text: `Idea #${args.id} not found` }], isError: true };
    }
    saveIdeas(state);
    return { content: [{ type: 'text', text: `Idea #${args.id} deleted` }] };
  },
);

export const ideasCreatePlanTool = tool(
  'ideas_create_plan',
  'Create a plan from an idea and link it back.',
  {
    ideaId: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    type: z.enum(['feature', 'bug', 'chore']).optional(),
    tags: z.array(z.string()).optional(),
  },
  async (args) => {
    const state = loadIdeas();
    const item = state.items.find((r) => r.id === args.ideaId);
    if (!item) {
      return { content: [{ type: 'text', text: `Idea #${args.ideaId} not found` }], isError: true };
    }

    const plan = createPlanFromIdea({
      ideaId: item.id,
      title: args.title || item.title,
      description: args.description || item.description || item.outcome || item.problem,
      type: args.type || inferPlanType(item),
      tags: args.tags || item.tags,
    });

    if (!item.linkedPlanIds.includes(plan.id)) {
      item.linkedPlanIds.push(plan.id);
      item.updatedAt = new Date().toISOString();
      saveIdeas(state);
    }

    return { content: [{ type: 'text', text: `Created Plan #${plan.id} from Idea #${item.id}` }] };
  },
);

function inferPlanType(item: Idea): PlanType {
  const text = `${item.title} ${item.problem || ''} ${item.outcome || ''}`.toLowerCase();
  if (text.includes('bug') || text.includes('fix') || text.includes('error')) return 'bug';
  if (text.includes('cleanup') || text.includes('refactor') || text.includes('maintenance')) return 'chore';
  return 'feature';
}

export const ideasTools = [
  ideasViewTool,
  ideasAddTool,
  ideasUpdateTool,
  ideasDeleteTool,
  ideasCreatePlanTool,
];
