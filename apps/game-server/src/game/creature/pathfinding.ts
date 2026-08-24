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

  const open = new Map<string, PathNode>();
  const closed = new Set<string>();

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
  open.set(nodeKey(startNode), startNode);

  while (open.size > 0) {
    if (open.size > maxIter) return null;
    let best: PathNode | null = null;
    for (const node of open.values()) {
      if (!best || node.f < best.f) best = node;
    }
    const node = best as PathNode;
    open.delete(nodeKey(node));

    if (closed.has(nodeKey(node))) continue;
    if (samePosition(node, req.goal)) return reconstruct(node);
    closed.add(nodeKey(node));

    for (const dir of ALL_DIRECTIONS_LIST) {
      const delta = DIRECTION_DELTAS[dir];
      const next = { x: node.x + delta.dx, y: node.y + delta.dy, z: node.z };
      if (!movement.isWalkable(next)) continue;
      if (!movement.canOccupy(next, req.exceptIds)) continue;
      if (delta.dx !== 0 && delta.dy !== 0) {
        const sideA = { x: node.x + delta.dx, y: node.y, z: node.z };
        const sideB = { x: node.x, y: node.y + delta.dy, z: node.z };
        if (!movement.isWalkable(sideA) || !movement.isWalkable(sideB)) continue;
      }
      const nk = nodeKey(next);
      if (closed.has(nk)) continue;
      const g = node.g + (delta.dx !== 0 && delta.dy !== 0 ? 1.414 : 1);
      if (req.maxCost !== undefined && g > req.maxCost) continue;
      const h = heuristic(next, req.goal);
      const f = g + h;
      const existing = open.get(nk);
      if (existing) {
        if (g < existing.g) {
          existing.g = g;
          existing.f = f;
          existing.parent = node;
        }
        continue;
      }
      open.set(nk, { x: next.x, y: next.y, z: next.z, g, h, f, parent: node });
    }
  }
  return null;
}