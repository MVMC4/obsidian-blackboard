import type { DiagramObject, Stroke } from '../domain/entities';
import { distToSegment } from '../domain/geometry';
import { StrokeManager } from '../domain/stroke-manager';

export function findStrokesAtPoint(
  strokes: Stroke[],
  worldX: number,
  worldY: number,
  eraserSize: number,
): string[] {
  const toDelete: string[] = [];
  for (const stroke of strokes) {
    let hit = false;
    for (let pi = 0; pi < stroke.points.length; pi++) {
      const sp = stroke.points[pi];
      const dx = sp[0] - worldX;
      const dy = sp[1] - worldY;
      if (dx * dx + dy * dy < eraserSize * eraserSize) { hit = true; break; }
      if (pi > 0) {
        const prev = stroke.points[pi - 1];
        if (distToSegment(worldX, worldY, prev[0], prev[1], sp[0], sp[1]) < eraserSize) { hit = true; break; }
      }
    }
    if (hit) toDelete.push(stroke.id);
  }
  return toDelete;
}

export function eraseAtPoint(
  strokeManager: StrokeManager,
  worldX: number,
  worldY: number,
  eraserSize: number,
): boolean {
  const effectiveSize = Math.max(eraserSize, 15);
  const toDelete = findStrokesAtPoint(strokeManager.strokes, worldX, worldY, effectiveSize);
  for (const id of toDelete) strokeManager.deleteStroke(id);
  const objectsToDelete = findObjectsAtPoint(strokeManager.objects ?? [], worldX, worldY, effectiveSize);
  for (const id of objectsToDelete) strokeManager.deleteObject(id);
  return toDelete.length > 0 || objectsToDelete.length > 0;
}

/** Hit-test diagram objects using their visible geometry plus a forgiving stylus tolerance. */
export function findObjectsAtPoint(
  objects: DiagramObject[],
  worldX: number,
  worldY: number,
  eraserSize: number,
): string[] {
  const toDelete: string[] = [];
  for (const object of objects) {
    const x2 = object.x + object.width;
    const y2 = object.y + object.height;
    const left = Math.min(object.x, x2) - eraserSize;
    const right = Math.max(object.x, x2) + eraserSize;
    const top = Math.min(object.y, y2) - eraserSize;
    const bottom = Math.max(object.y, y2) + eraserSize;
    if (worldX < left || worldX > right || worldY < top || worldY > bottom) continue;

    let hit = false;
    if (object.kind === 'line' || object.kind === 'arrow') {
      hit = distToSegment(worldX, worldY, object.x, object.y, x2, y2) <= eraserSize + object.size;
    } else if (object.kind === 'ellipse') {
      const cx = (object.x + x2) / 2;
      const cy = (object.y + y2) / 2;
      const rx = Math.max(1, Math.abs(object.width) / 2);
      const ry = Math.max(1, Math.abs(object.height) / 2);
      const normalized = Math.hypot((worldX - cx) / rx, (worldY - cy) / ry);
      const tolerance = (eraserSize + object.size) / Math.max(rx, ry);
      hit = Math.abs(normalized - 1) <= tolerance;
    } else {
      const tolerance = eraserSize + object.size;
      const top = distToSegment(worldX, worldY, object.x, object.y, x2, object.y);
      const bottom = distToSegment(worldX, worldY, object.x, y2, x2, y2);
      const leftEdge = distToSegment(worldX, worldY, object.x, object.y, object.x, y2);
      const rightEdge = distToSegment(worldX, worldY, x2, object.y, x2, y2);
      hit = Math.min(top, bottom, leftEdge, rightEdge) <= tolerance;
    }
    if (hit) toDelete.push(object.id);
  }
  return toDelete;
}
