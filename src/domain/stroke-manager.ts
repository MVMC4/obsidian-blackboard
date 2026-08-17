import type { DiagramObject, Stroke } from './entities';

export interface Command {
  execute(): void;
  undo(): void;
}

export class StrokeManager {
  strokes: Stroke[] = [];
  objects: DiagramObject[] = [];
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  addStroke(stroke: Stroke): void {
    this.strokes.push(stroke);
    this.undoStack.push({
      execute: () => { this.strokes.push(stroke); },
      undo: () => { const i = this.strokes.findIndex(s => s.id === stroke.id); if (i !== -1) this.strokes.splice(i, 1); },
    });
    this.redoStack.length = 0;
  }

  deleteStroke(id: string): void {
    const index = this.strokes.findIndex(s => s.id === id);
    if (index === -1) return;
    const deleted = this.strokes.splice(index, 1)[0];
    this.undoStack.push({
      execute: () => { const i = this.strokes.findIndex(s => s.id === deleted.id); if (i !== -1) this.strokes.splice(i, 1); },
      undo: () => { this.strokes.splice(index, 0, deleted); },
    });
    this.redoStack.length = 0;
  }

  moveStroke(id: string, dx: number, dy: number): void {
    const stroke = this.strokes.find(s => s.id === id);
    if (!stroke) return;
    for (const point of stroke.points) {
      point[0] += dx;
      point[1] += dy;
    }
    this.undoStack.push({
      execute: () => {
        const s = this.strokes.find(x => x.id === id);
        if (s) for (const p of s.points) { p[0] += dx; p[1] += dy; }
      },
      undo: () => {
        const s = this.strokes.find(x => x.id === id);
        if (s) for (const p of s.points) { p[0] -= dx; p[1] -= dy; }
      },
    });
    this.redoStack.length = 0;
  }

  clearAll(): void {
    const saved = [...this.strokes];
    const savedObjects = [...this.objects];
    this.strokes.length = 0;
    this.objects.length = 0;
    this.undoStack.push({
      execute: () => { this.strokes.length = 0; this.objects.length = 0; },
      undo: () => { this.strokes.push(...saved); this.objects.push(...savedObjects); },
    });
    this.redoStack.length = 0;
  }

  /** Apply a translation without creating an undo entry; used while a selection is dragged. */
  translateSelection(strokeIds: string[], objectIds: string[], dx: number, dy: number): void {
    const strokeSet = new Set(strokeIds);
    for (const stroke of this.strokes) {
      if (!strokeSet.has(stroke.id)) continue;
      for (const point of stroke.points) {
        point[0] += dx;
        point[1] += dy;
      }
    }
    const objectSet = new Set(objectIds);
    for (const object of this.objects) {
      if (!objectSet.has(object.id)) continue;
      object.x += dx;
      object.y += dy;
    }
  }

  /** Record one undoable translation after the pointer drag has finished. */
  moveSelection(strokeIds: string[], objectIds: string[], dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.translateSelection(strokeIds, objectIds, dx, dy);
    this.recordSelectionMove(strokeIds, objectIds, dx, dy);
  }

  /** Record a translation that has already been applied during interactive dragging. */
  recordSelectionMove(strokeIds: string[], objectIds: string[], dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.undoStack.push({
      execute: () => this.translateSelection(strokeIds, objectIds, dx, dy),
      undo: () => this.translateSelection(strokeIds, objectIds, -dx, -dy),
    });
    this.redoStack.length = 0;
  }

  addObject(object: DiagramObject): void {
    this.objects.push(object);
    this.undoStack.push({
      execute: () => { if (!this.objects.some(o => o.id === object.id)) this.objects.push(object); },
      undo: () => { const i = this.objects.findIndex(o => o.id === object.id); if (i !== -1) this.objects.splice(i, 1); },
    });
    this.redoStack.length = 0;
  }

  deleteObject(id: string): void {
    const index = this.objects.findIndex(o => o.id === id);
    if (index === -1) return;
    const deleted = this.objects.splice(index, 1)[0];
    this.undoStack.push({
      execute: () => { const i = this.objects.findIndex(o => o.id === deleted.id); if (i !== -1) this.objects.splice(i, 1); },
      undo: () => { this.objects.splice(index, 0, deleted); },
    });
    this.redoStack.length = 0;
  }

  /** Delete a mixed group as one undoable operation. */
  deleteMany(strokeIds: string[], objectIds: string[]): void {
    const strokeSet = new Set(strokeIds);
    const objectSet = new Set(objectIds);
    const deletedStrokes = this.strokes
      .map((stroke, index) => ({ stroke, index }))
      .filter(({ stroke }) => strokeSet.has(stroke.id));
    const deletedObjects = this.objects
      .map((object, index) => ({ object, index }))
      .filter(({ object }) => objectSet.has(object.id));
    if (deletedStrokes.length === 0 && deletedObjects.length === 0) return;
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      if (strokeSet.has(this.strokes[i].id)) this.strokes.splice(i, 1);
    }
    for (let i = this.objects.length - 1; i >= 0; i--) {
      if (objectSet.has(this.objects[i].id)) this.objects.splice(i, 1);
    }
    this.undoStack.push({
      execute: () => {
        for (const { stroke } of deletedStrokes) {
          if (!this.strokes.some((current) => current.id === stroke.id)) this.strokes.push(stroke);
        }
        for (const { object } of deletedObjects) {
          if (!this.objects.some((current) => current.id === object.id)) this.objects.push(object);
        }
      },
      undo: () => {
        for (let i = this.strokes.length - 1; i >= 0; i--) {
          if (strokeSet.has(this.strokes[i].id)) this.strokes.splice(i, 1);
        }
        for (let i = this.objects.length - 1; i >= 0; i--) {
          if (objectSet.has(this.objects[i].id)) this.objects.splice(i, 1);
        }
        for (const { stroke, index } of deletedStrokes) this.strokes.splice(Math.min(index, this.strokes.length), 0, stroke);
        for (const { object, index } of deletedObjects) this.objects.splice(Math.min(index, this.objects.length), 0, object);
      },
    });
    this.redoStack.length = 0;
  }

  recordObjectResize(id: string, before: DiagramObject, after: DiagramObject): void {
    const current = this.objects.find((object) => object.id === id);
    if (!current) return;
    this.undoStack.push({
      execute: () => {
        const object = this.objects.find((candidate) => candidate.id === id);
        if (object) Object.assign(object, after);
      },
      undo: () => {
        const object = this.objects.find((candidate) => candidate.id === id);
        if (object) Object.assign(object, before);
      },
    });
    this.redoStack.length = 0;
  }

  updateColor(strokeIds: string[], objectIds: string[], color: string): boolean {
    const strokeSet = new Set(strokeIds);
    const objectSet = new Set(objectIds);
    const strokes = this.strokes.filter((stroke) => strokeSet.has(stroke.id));
    const objects = this.objects.filter((object) => objectSet.has(object.id));
    if (strokes.length === 0 && objects.length === 0) return false;
    const beforeStrokes = strokes.map((stroke) => ({ id: stroke.id, color: stroke.color }));
    const beforeObjects = objects.map((object) => ({ id: object.id, color: object.color }));
    for (const stroke of strokes) stroke.color = color;
    for (const object of objects) object.color = color;
    this.undoStack.push({
      execute: () => {
        for (const item of beforeStrokes) {
          const stroke = this.strokes.find((candidate) => candidate.id === item.id);
          if (stroke) stroke.color = color;
        }
        for (const item of beforeObjects) {
          const object = this.objects.find((candidate) => candidate.id === item.id);
          if (object) object.color = color;
        }
      },
      undo: () => {
        for (const item of beforeStrokes) {
          const stroke = this.strokes.find((candidate) => candidate.id === item.id);
          if (stroke) stroke.color = item.color;
        }
        for (const item of beforeObjects) {
          const object = this.objects.find((candidate) => candidate.id === item.id);
          if (object) object.color = item.color;
        }
      },
    });
    this.redoStack.length = 0;
    return true;
  }

  updateLineStyle(objectIds: string[], lineStyle: DiagramObject['lineStyle']): boolean {
    const objectSet = new Set(objectIds);
    const objects = this.objects.filter((object) => objectSet.has(object.id));
    if (objects.length === 0) return false;
    if (objects.every((object) => (object.lineStyle ?? 'solid') === lineStyle)) return false;
    const before = objects.map((object) => ({ id: object.id, lineStyle: object.lineStyle }));
    for (const object of objects) object.lineStyle = lineStyle;
    this.undoStack.push({
      execute: () => {
        for (const item of before) {
          const object = this.objects.find((candidate) => candidate.id === item.id);
          if (object) object.lineStyle = lineStyle;
        }
      },
      undo: () => {
        for (const item of before) {
          const object = this.objects.find((candidate) => candidate.id === item.id);
          if (object) object.lineStyle = item.lineStyle;
        }
      },
    });
    this.redoStack.length = 0;
    return true;
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.execute();
    this.undoStack.push(cmd);
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  reset(): void {
    this.strokes.length = 0;
    this.objects.length = 0;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
