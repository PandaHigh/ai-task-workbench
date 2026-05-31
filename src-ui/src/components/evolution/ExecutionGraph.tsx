import { useMemo } from "react";
import type { TaskDefinition } from "@ai-workbench/shared";

interface ExecutionGraphProps {
  tasks: TaskDefinition[];
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 50;
const H_GAP = 40;
const V_GAP = 70;
const PADDING = 30;

const STATUS_COLORS: Record<string, string> = {
  pending: "#9CA3AF",
  running: "#3B82F6",
  completed: "#10B981",
  failed: "#EF4444",
  reverted: "#F59E0B",
  scoring: "#8B5CF6",
  cancelled: "#6B7280",
};

function layoutDAG(tasks: TaskDefinition[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const deps = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();

  for (const t of tasks) {
    deps.set(t.id, t.dependsOn || []);
    if (!dependents.has(t.id)) dependents.set(t.id, []);
    for (const dep of t.dependsOn || []) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(t.id);
    }
  }

  // BFS layering
  const layers: string[][] = [];
  const visited = new Set<string>();
  let current = tasks.filter(t => (t.dependsOn || []).length === 0).map(t => t.id);

  while (current.length > 0) {
    layers.push(current);
    for (const id of current) visited.add(id);
    const next: string[] = [];
    for (const id of current) {
      for (const depId of dependents.get(id) || []) {
        if (!visited.has(depId) && (deps.get(depId) || []).every(d => visited.has(d))) {
          next.push(depId);
        }
      }
    }
    // Add remaining tasks not yet visited (orphan or no-dep)
    for (const t of tasks) {
      if (!visited.has(t.id) && !next.includes(t.id)) {
        next.push(t.id);
      }
    }
    current = [...new Set(next)];
  }

  // Position nodes
  let maxLayerWidth = 0;
  for (const layer of layers) {
    maxLayerWidth = Math.max(maxLayerWidth, layer.length);
  }

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const totalWidth = layer.length * NODE_WIDTH + (layer.length - 1) * H_GAP;
    const startX = (maxLayerWidth * NODE_WIDTH + (maxLayerWidth - 1) * H_GAP - totalWidth) / 2 + PADDING;
    for (let ni = 0; ni < layer.length; ni++) {
      positions.set(layer[ni], {
        x: startX + ni * (NODE_WIDTH + H_GAP),
        y: PADDING + li * (NODE_HEIGHT + V_GAP),
      });
    }
  }

  return positions;
}

export function ExecutionGraph({ tasks }: ExecutionGraphProps) {
  const positions = useMemo(() => layoutDAG(tasks), [tasks]);

  if (tasks.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        暂无任务
      </div>
    );
  }

  const maxX = Math.max(...[...positions.values()].map(p => p.x)) + NODE_WIDTH + PADDING;
  const maxY = Math.max(...[...positions.values()].map(p => p.y)) + NODE_HEIGHT + PADDING;

  const edges: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (const task of tasks) {
    const target = positions.get(task.id);
    if (!target) continue;
    for (const depId of task.dependsOn || []) {
      const source = positions.get(depId);
      if (source) {
        edges.push({
          x1: source.x + NODE_WIDTH / 2,
          y1: source.y + NODE_HEIGHT,
          x2: target.x + NODE_WIDTH / 2,
          y2: target.y,
        });
      }
    }
  }

  return (
    <div className="overflow-auto p-4">
      <svg width={maxX} height={maxY} className="mx-auto">
        {/* Edges */}
        {edges.map((e, i) => (
          <line
            key={i}
            x1={e.x1} y1={e.y1}
            x2={e.x2} y2={e.y2}
            stroke="#4B5563"
            strokeWidth={1.5}
            markerEnd="url(#arrowhead)"
          />
        ))}

        {/* Arrow marker */}
        <defs>
          <marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5"
            markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#4B5563" />
          </marker>
        </defs>

        {/* Nodes */}
        {tasks.map((task) => {
          const pos = positions.get(task.id);
          if (!pos) return null;
          const color = STATUS_COLORS[task.status] || STATUS_COLORS.pending;
          const label = task.content.length > 20 ? task.content.substring(0, 17) + "..." : task.content;

          return (
            <g key={task.id}>
              <rect
                x={pos.x} y={pos.y}
                width={NODE_WIDTH} height={NODE_HEIGHT}
                rx={8} ry={8}
                fill={color}
                fillOpacity={0.15}
                stroke={color}
                strokeWidth={2}
              />
              <text
                x={pos.x + NODE_WIDTH / 2}
                y={pos.y + 20}
                textAnchor="middle"
                className="text-xs fill-current text-gray-200"
                fontSize={11}
              >
                {label}
              </text>
              <text
                x={pos.x + NODE_WIDTH / 2}
                y={pos.y + 38}
                textAnchor="middle"
                className="fill-current text-gray-400"
                fontSize={9}
              >
                {task.status} {task.score !== undefined ? `(${(task.score * 100).toFixed(0)}%)` : ""}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
