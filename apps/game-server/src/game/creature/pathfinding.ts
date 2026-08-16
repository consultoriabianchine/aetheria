import { tileKey } from '@aetheria/shared';
import type { Position } from '@aetheria/types';
import { ALL_DIRECTIONS, DIRECTION_DELTAS, Direction } from './direction';
import { MovementService } from './movement.service';

/** Nó do A*: posição em grade + custos + pai para reconstrução do caminho. */
export interface PathNode {
  x: number;
  y: number;
  z: number;
  g: number;
  h: number;
  f: number;
  parent: PathNode | null;
}

export interface PathRequest {
  start: Position;
  goal: Position;
  /** Entidades que não bloqueiam o agente (ele mesmo + alvo atual). */
  exceptIds?: Iterable<string>;
  /** Proteção contra mapas grandes. */
  maxIterations?: number;
  /** Custo máximo aceitável (distância ~ Chebyshev). */
  maxCost?: number;
}

function heuristic(a: Position, b: Position): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function nodeKey(n: { x: number; y: number; z: number }): string {
  return tileKey(n.x, n.y, n.z);
}

function samePosition(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function reconstruct(node: PathNode): Position[] {
  const path: Position[] = [];
  let cur: PathNode | null = node;
  while (cur) {
    path.push({ x: cur.x, y: cur.y, z: cur.z });
    cur = cur.parent;
  }
  path.reverse();
  return path.slice(1); // exclui o tile de partida
}

const ALL_DIRECTIONS_LIST: Direction[] = ALL_DIRECTIONS;

/**
 * A* sobre a grade x,y,z. Considera paredes, obstáculos, criaturas e jogadores
 * (via occupancy), restrito ao mesmo andar (z fixo). Retorna Position[] ou null.
 */
export function findPath(movement: MovementService, req: PathRequest): Position[] | null {
  const maxIter = req.maxIterations ?? 3000;
  if (!movement.isWalkable(req.start)) return null;
  if (samePosition(req.start, req.goal)) return [];

  const open: PathNode[] = [];
  const closed = new Set<string>();
  const bestIndex = new Map<string, number>();

  const startNode: PathNode = {
    x: req.start.x,
    y: req.start.y,
    z: req.start.z,
    g: 0,
    h: heuristic(req.start, req.goal),
    f: 0,
    parent: null,
  };
  startNode.f = startNode.g + startNode.h;
  open.push(startNode);
  bestIndex.set(nodeKey(startNode), 0);

  while (open.length > 0) {
    if (open.length > maxIter) return null;
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const node = open.splice(bestIdx, 1)[0];
    bestIndex.delete(nodeKey(node));

    if (closed.has(nodeKey(node))) continue;
    if (samePosition(node, req.goal)) return reconstruct(node);
    closed.add(nodeKey(node));

    for (const dir of ALL_DIRECTIONS_LIST) {
      const delta = DIRECTION_DELTAS[dir];
      const next = { x: node.x + delta.dx, y: node.y + delta.dy, z: node.z };
      if (!movement.isWalkable(next)) continue;
      if (!movement.canOccupy(next, req.exceptIds)) continue;
      const nk = nodeKey(next);
      if (closed.has(nk)) continue;
      const g = node.g + (delta.dx !== 0 && delta.dy !== 0 ? 1.414 : 1);
      if (req.maxCost !== undefined && g > req.maxCost) continue;
      const h = heuristic(next, req.goal);
      const f = g + h;
      const existingIdx = bestIndex.get(nk);
      if (existingIdx !== undefined && open[existingIdx]) {
        if (g < open[existingIdx].g) {
          open[existingIdx].g = g;
          open[existingIdx].f = f;
          open[existingIdx].parent = node;
        }
        continue;
      }
      const idx = open.push({ x: next.x, y: next.y, z: next.z, g, h, f, parent: node }) - 1;
      bestIndex.set(nk, idx);
    }
  }
  return null;
}