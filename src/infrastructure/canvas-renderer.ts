import { getStroke } from 'perfect-freehand';
import { INK_PROFILES } from '../domain/entities';
import type { Background, DiagramObject, DiagramObjectKind, InkProfile, Point, Stroke } from '../domain/entities';
import { StrokeManager } from '../domain/stroke-manager';
import { ToolManager } from '../domain/tool-manager';
import { distToSegment, fitContentToBox, screenToContent, centerContentInBox, type ViewTransform } from '../domain/geometry';
import { readableInkColor } from '../domain/ink-color';

/** View-scale clamp shared by the presentation-facing transform mutators. */
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

export class DrawingEngine {
  readonly: boolean = false;
  warnings: string[] = [];
  strokeManager: StrokeManager;
  toolManager: ToolManager;

  private container: HTMLElement;
  private staticCanvas: HTMLCanvasElement;
  private activeCanvas: HTMLCanvasElement;
  private staticCtx: CanvasRenderingContext2D;
  private activeCtx: CanvasRenderingContext2D;
  private activePoints: Point[] = [];
  private activeObject: DiagramObject | null = null;
  private eraserCursor: { x: number; y: number; radius: number } | null = null;
  private activePointerType: string = '';
  private isDrawing: boolean = false;
  staticDirty: boolean = true;
  private activeDirty: boolean = false;
  private rafId: number = 0;
  drawingWidth: number;
  drawingHeight: number;
  private displayWidth = 0;
  private displayHeight = 0;
  private contentBounds: { x: number; y: number; width: number; height: number } | null = null;
  private view: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };
  private page: Background = { type: 'blank', color: 'transparent', grid: false, gridSize: 24, gridColor: '#9aa4b2' };
  private inkProfile: InkProfile = { ...INK_PROFILES.raw };
  private selectedStrokeIds = new Set<string>();
  private selectedObjectIds = new Set<string>();
  private selectionDrag: {
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    mode: 'pending' | 'move' | 'lasso' | 'resize';
    resizeObjectId?: string;
    resizeBefore?: DiagramObject;
  } | null = null;

  constructor(container: HTMLElement, width?: number, height?: number, toolManager?: ToolManager) {
    this.container = container;
    this.strokeManager = new StrokeManager();
    // Tool state is global: when the plugin injects a shared ToolManager, every surface
    // reads and drives the same selection (fix-tool-state-isolation). Falls back to a
    // private manager for back-compat (standalone construction / tests).
    this.toolManager = toolManager ?? new ToolManager();

    this.drawingWidth = width ?? (container.clientWidth || 800);
    this.drawingHeight = height ?? (container.clientHeight || 600);

    // Layout (absolute overlay filling the container) comes from the
    // .blackboard-static/.blackboard-active rules in styles.css.
    this.staticCanvas = createEl('canvas');
    this.staticCanvas.className = 'blackboard-static';

    this.activeCanvas = createEl('canvas');
    this.activeCanvas.className = 'blackboard-active';

    container.appendChild(this.staticCanvas);
    container.appendChild(this.activeCanvas);

    // desynchronized lowers input-to-paint latency for stylus drawing in WebKit.
    this.staticCtx = this.staticCanvas.getContext('2d', { desynchronized: true })!;
    this.activeCtx = this.activeCanvas.getContext('2d', { desynchronized: true })!;

    this.setCanvasSize(this.drawingWidth, this.drawingHeight);
  }

  loadStrokes(strokes: Stroke[]): void {
    this.strokeManager.reset();
    this.clearSelection();
    for (const stroke of strokes) {
      this.strokeManager.strokes.push(JSON.parse(JSON.stringify(stroke)) as Stroke);
    }
    this.staticDirty = true;
  }

  loadObjects(objects: DiagramObject[]): void {
    this.strokeManager.objects.length = 0;
    this.strokeManager.objects.push(...objects.map((object) => JSON.parse(JSON.stringify(object)) as DiagramObject));
    this.clearSelection();
    this.staticDirty = true;
  }

  /** Undo the latest content mutation and repaint immediately. Returns false when the
   * history is already empty so toolbar actions are harmless no-ops. */
  undo(): boolean {
    if (!this.strokeManager.canUndo()) return false;
    this.strokeManager.undo();
    this.clearSelection();
    this.staticDirty = true;
    this.activeDirty = true;
    this.requestRender();
    return true;
  }

  /** Redo the latest undone content mutation and repaint immediately. */
  redo(): boolean {
    if (!this.strokeManager.canRedo()) return false;
    this.strokeManager.redo();
    this.clearSelection();
    this.staticDirty = true;
    this.activeDirty = true;
    this.requestRender();
    return true;
  }

  setPage(page: Background | undefined): void {
    this.page = page ? { ...this.page, ...page } : { type: 'blank', color: 'transparent', grid: false, gridSize: 24, gridColor: '#9aa4b2' };
    this.staticDirty = true;
    this.requestRender();
  }

  getPage(): Background {
    return { ...this.page };
  }

  setInkProfile(profile: InkProfile | undefined): void {
    const fallback = INK_PROFILES.raw;
    this.inkProfile = profile ? { ...fallback, ...profile } : { ...fallback };
    this.staticDirty = true;
    this.activeDirty = true;
    this.requestRender();
  }

  getInkProfile(): InkProfile {
    return { ...this.inkProfile };
  }

  setEraserCursor(x: number, y: number): void {
    this.eraserCursor = { x, y, radius: Math.max(15, this.toolManager.activeSize) };
    this.activeDirty = true;
    this.requestRender();
  }

  clearEraserCursor(): void {
    if (!this.eraserCursor) return;
    this.eraserCursor = null;
    this.activeDirty = true;
    this.requestRender();
  }

  beginStroke(pointerType: string): void {
    this.isDrawing = true;
    this.activePointerType = pointerType;
    this.activePoints = [];
  }

  addPoint(point: Point): void {
    if (!this.isDrawing) return;
    // Skip zero-length segments (e.g. the pointerup point landing on the last move
    // position) so capturing the release point doesn't add a duplicate.
    const last = this.activePoints[this.activePoints.length - 1];
    if (last && last[0] === point[0] && last[1] === point[1]) return;
    this.activePoints.push(point);
    this.activeDirty = true;
    this.requestRender();
  }

  endStroke(): void {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    if (this.activePoints.length >= 1) {
      const tool = this.toolManager.activeTool === 'highlighter' ? 'highlighter' : 'pen';
      const stroke: Stroke = {
        id: crypto.randomUUID(),
        tool,
        color: this.toolManager.activeColor,
        size: this.toolManager.activeSize,
        opacity: this.toolManager.activeOpacity,
        points: [...this.activePoints],
        hasPressure: this.activePoints.some(p => p[2] !== 0.5),
        timestamp: Date.now(),
      };
      this.strokeManager.addStroke(stroke);
      this.staticDirty = true;
    }

    this.activePoints = [];
    this.activeDirty = true;
    this.requestRender();
  }

  beginShape(kind: DiagramObjectKind, x: number, y: number): void {
    this.isDrawing = true;
    this.activeObject = {
      id: crypto.randomUUID(),
      kind,
      x,
      y,
      width: 0,
      height: 0,
      color: this.toolManager.activeColor,
      size: this.toolManager.activeSize,
      opacity: this.toolManager.activeOpacity,
      fill: 'transparent',
      fillOpacity: 0,
      lineStyle: 'solid',
      timestamp: Date.now(),
    };
    this.activeDirty = true;
    this.requestRender();
  }

  updateShape(x: number, y: number): void {
    if (!this.isDrawing || !this.activeObject) return;
    this.activeObject.width = x - this.activeObject.x;
    this.activeObject.height = y - this.activeObject.y;
    this.activeDirty = true;
    this.requestRender();
  }

  endShape(): void {
    if (!this.isDrawing || !this.activeObject) return;
    const object = this.activeObject;
    this.isDrawing = false;
    this.activeObject = null;
    if (Math.abs(object.width) >= 2 || Math.abs(object.height) >= 2) {
      this.strokeManager.addObject(object);
      this.staticDirty = true;
    }
    this.activeDirty = true;
    this.requestRender();
  }

  getSelection(): { strokeIds: string[]; objectIds: string[] } {
    return {
      strokeIds: [...this.selectedStrokeIds],
      objectIds: [...this.selectedObjectIds],
    };
  }

  getExportData(selectionOnly = false): { strokes: Stroke[]; objects: DiagramObject[] } {
    if (!selectionOnly) {
      return {
        strokes: JSON.parse(JSON.stringify(this.strokeManager.strokes)) as Stroke[],
        objects: JSON.parse(JSON.stringify(this.strokeManager.objects)) as DiagramObject[],
      };
    }
    const strokes = this.strokeManager.strokes.filter((stroke) => this.selectedStrokeIds.has(stroke.id));
    const objects = this.strokeManager.objects.filter((object) => this.selectedObjectIds.has(object.id));
    return {
      strokes: JSON.parse(JSON.stringify(strokes)) as Stroke[],
      objects: JSON.parse(JSON.stringify(objects)) as DiagramObject[],
    };
  }

  getSelectedLineStyle(): 'solid' | 'dashed' | 'dotted' | null {
    const selected = this.strokeManager.objects.filter((object) => this.selectedObjectIds.has(object.id));
    if (selected.length === 0) return null;
    const first = selected[0].lineStyle ?? 'solid';
    return selected.every((object) => (object.lineStyle ?? 'solid') === first) ? first : null;
  }

  setSelectionLineStyle(style: 'solid' | 'dashed' | 'dotted'): boolean {
    if (this.selectedObjectIds.size === 0) return false;
    const changed = this.strokeManager.updateLineStyle([...this.selectedObjectIds], style);
    if (changed) {
      this.staticDirty = true;
      this.requestRender();
    }
    return changed;
  }

  setSelectionColor(color: string): boolean {
    if (!this.hasSelection()) return false;
    const changed = this.strokeManager.updateColor([...this.selectedStrokeIds], [...this.selectedObjectIds], color);
    if (changed) {
      this.staticDirty = true;
      this.requestRender();
    }
    return changed;
  }

  hasSelection(): boolean {
    return this.selectedStrokeIds.size > 0 || this.selectedObjectIds.size > 0;
  }

  clearSelection(): void {
    this.selectedStrokeIds.clear();
    this.selectedObjectIds.clear();
    this.selectionDrag = null;
    this.staticDirty = true;
  }

  beginSelection(x: number, y: number): void {
    const resizeTarget = this.resizeHandleHit(x, y);
    if (resizeTarget) {
      const object = this.strokeManager.objects.find((candidate) => candidate.id === resizeTarget);
      if (object) {
        this.selectionDrag = {
          startX: x,
          startY: y,
          lastX: x,
          lastY: y,
          mode: 'resize',
          resizeObjectId: object.id,
          resizeBefore: JSON.parse(JSON.stringify(object)) as DiagramObject,
        };
        this.activeDirty = true;
        this.requestRender();
        return;
      }
    }
    const hit = this.hitTest(x, y);
    if (hit && !this.isSelected(hit)) {
      this.selectedStrokeIds.clear();
      this.selectedObjectIds.clear();
      if (hit.kind === 'stroke') this.selectedStrokeIds.add(hit.id);
      else this.selectedObjectIds.add(hit.id);
      this.staticDirty = true;
    } else if (!hit && !this.pointInsideSelectionBounds(x, y)) {
      this.selectedStrokeIds.clear();
      this.selectedObjectIds.clear();
      this.staticDirty = true;
    }
    this.selectionDrag = { startX: x, startY: y, lastX: x, lastY: y, mode: 'pending' };
    this.activeDirty = true;
    this.requestRender();
  }

  updateSelection(x: number, y: number): void {
    const drag = this.selectionDrag;
    if (!drag) return;
    const dxFromStart = x - drag.startX;
    const dyFromStart = y - drag.startY;
    if (drag.mode === 'pending' && Math.hypot(dxFromStart, dyFromStart) >= 3) {
      drag.mode = this.hasSelection() ? 'move' : 'lasso';
    }
    if (drag.mode === 'move') {
      const dx = x - drag.lastX;
      const dy = y - drag.lastY;
      if (dx || dy) {
        this.strokeManager.translateSelection([...this.selectedStrokeIds], [...this.selectedObjectIds], dx, dy);
        this.staticDirty = true;
      }
    } else if (drag.mode === 'resize' && drag.resizeObjectId) {
      const object = this.strokeManager.objects.find((candidate) => candidate.id === drag.resizeObjectId);
      if (object && drag.resizeBefore) {
        const anchorX = Math.min(drag.resizeBefore.x, drag.resizeBefore.x + drag.resizeBefore.width);
        const anchorY = Math.min(drag.resizeBefore.y, drag.resizeBefore.y + drag.resizeBefore.height);
        object.x = anchorX;
        object.y = anchorY;
        object.width = Math.max(2, x - anchorX);
        object.height = Math.max(2, y - anchorY);
        this.staticDirty = true;
      }
    }
    drag.lastX = x;
    drag.lastY = y;
    this.activeDirty = true;
    this.requestRender();
  }

  /** Finish a selection gesture. Returns true only when content was moved. */
  endSelection(): boolean {
    const drag = this.selectionDrag;
    if (!drag) return false;
    let moved = false;
    let selectionChanged = false;
    if (drag.mode === 'lasso') {
      const previousStrokeIds = [...this.selectedStrokeIds].sort().join('|');
      const previousObjectIds = [...this.selectedObjectIds].sort().join('|');
      const left = Math.min(drag.startX, drag.lastX);
      const right = Math.max(drag.startX, drag.lastX);
      const top = Math.min(drag.startY, drag.lastY);
      const bottom = Math.max(drag.startY, drag.lastY);
      this.selectedStrokeIds.clear();
      this.selectedObjectIds.clear();
      for (const stroke of this.strokeManager.strokes) {
        if (this.strokeContainedByRect(stroke, left, top, right, bottom)) this.selectedStrokeIds.add(stroke.id);
      }
      for (const object of this.strokeManager.objects) {
        if (this.objectContainedByRect(object, left, top, right, bottom)) this.selectedObjectIds.add(object.id);
      }
      selectionChanged = previousStrokeIds !== [...this.selectedStrokeIds].sort().join('|') ||
        previousObjectIds !== [...this.selectedObjectIds].sort().join('|');
      this.staticDirty = true;
    } else if (drag.mode === 'move') {
      const dx = drag.lastX - drag.startX;
      const dy = drag.lastY - drag.startY;
      if (dx || dy) {
        this.strokeManager.recordSelectionMove([...this.selectedStrokeIds], [...this.selectedObjectIds], dx, dy);
        moved = true;
      }
    } else if (drag.mode === 'resize' && drag.resizeObjectId && drag.resizeBefore) {
      const object = this.strokeManager.objects.find((candidate) => candidate.id === drag.resizeObjectId);
      if (object) {
        const before = drag.resizeBefore;
        if (before.x !== object.x || before.y !== object.y || before.width !== object.width || before.height !== object.height) {
          this.strokeManager.recordObjectResize(object.id, before, JSON.parse(JSON.stringify(object)) as DiagramObject);
          moved = true;
        }
      }
    }
    this.selectionDrag = null;
    this.activeDirty = true;
    this.staticDirty = true;
    this.requestRender();
    return moved || selectionChanged;
  }

  deleteSelection(): boolean {
    if (!this.hasSelection()) return false;
    this.strokeManager.deleteMany([...this.selectedStrokeIds], [...this.selectedObjectIds]);
    this.clearSelection();
    this.staticDirty = true;
    this.requestRender();
    return true;
  }

  private isSelected(hit: { kind: 'stroke' | 'object'; id: string }): boolean {
    return hit.kind === 'stroke' ? this.selectedStrokeIds.has(hit.id) : this.selectedObjectIds.has(hit.id);
  }

  private hitTest(x: number, y: number): { kind: 'stroke' | 'object'; id: string } | null {
    for (let i = this.strokeManager.strokes.length - 1; i >= 0; i--) {
      const stroke = this.strokeManager.strokes[i];
      const tolerance = Math.max(8, stroke.size / 2 + 4);
      for (let p = 0; p < stroke.points.length; p++) {
        const point = stroke.points[p];
        if (Math.hypot(point[0] - x, point[1] - y) <= tolerance) return { kind: 'stroke', id: stroke.id };
        if (p > 0) {
          const previous = stroke.points[p - 1];
          if (distToSegment(x, y, previous[0], previous[1], point[0], point[1]) <= tolerance) {
            return { kind: 'stroke', id: stroke.id };
          }
        }
      }
    }
    for (let i = this.strokeManager.objects.length - 1; i >= 0; i--) {
      const object = this.strokeManager.objects[i];
      if (this.pointHitsObject(object, x, y)) return { kind: 'object', id: object.id };
    }
    return null;
  }

  private pointHitsObject(object: DiagramObject, x: number, y: number): boolean {
    const x2 = object.x + object.width;
    const y2 = object.y + object.height;
    const tolerance = Math.max(8, object.size + 4);
    if (object.kind === 'line' || object.kind === 'arrow') {
      return distToSegment(x, y, object.x, object.y, x2, y2) <= tolerance;
    }
    if (object.kind === 'ellipse') {
      const rx = Math.max(1, Math.abs(object.width) / 2);
      const ry = Math.max(1, Math.abs(object.height) / 2);
      const normalized = Math.hypot((x - (object.x + x2) / 2) / rx, (y - (object.y + y2) / 2) / ry);
      return normalized <= 1 + tolerance / Math.max(rx, ry);
    }
    return x >= Math.min(object.x, x2) - tolerance && x <= Math.max(object.x, x2) + tolerance &&
      y >= Math.min(object.y, y2) - tolerance && y <= Math.max(object.y, y2) + tolerance;
  }

  private strokeBounds(stroke: Stroke): { x: number; y: number; width: number; height: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of stroke.points) {
      minX = Math.min(minX, point[0]);
      minY = Math.min(minY, point[1]);
      maxX = Math.max(maxX, point[0]);
      maxY = Math.max(maxY, point[1]);
    }
    const pad = stroke.size / 2;
    return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
  }

  private objectBounds(object: DiagramObject): { x: number; y: number; width: number; height: number } {
    const x2 = object.x + object.width;
    const y2 = object.y + object.height;
    const pad = object.size / 2;
    const left = Math.min(object.x, x2) - pad;
    const top = Math.min(object.y, y2) - pad;
    return { x: left, y: top, width: Math.abs(object.width) + pad * 2, height: Math.abs(object.height) + pad * 2 };
  }

  private objectContainedByRect(object: DiagramObject, left: number, top: number, right: number, bottom: number): boolean {
    const x2 = object.x + object.width;
    const y2 = object.y + object.height;
    if (object.kind === 'line' || object.kind === 'arrow') {
      return this.pointInRect(object.x, object.y, left, top, right, bottom) && this.pointInRect(x2, y2, left, top, right, bottom);
    }
    const bounds = this.objectBounds(object);
    return this.pointInRect(bounds.x, bounds.y, left, top, right, bottom) &&
      this.pointInRect(bounds.x + bounds.width, bounds.y + bounds.height, left, top, right, bottom);
  }

  private strokeContainedByRect(stroke: Stroke, left: number, top: number, right: number, bottom: number): boolean {
    if (stroke.points.length === 0) return false;
    const tolerance = stroke.size / 2;
    return stroke.points.every((point) => point[0] - tolerance >= left && point[0] + tolerance <= right &&
      point[1] - tolerance >= top && point[1] + tolerance <= bottom);
  }

  private pointInRect(x: number, y: number, left: number, top: number, right: number, bottom: number): boolean {
    return x >= left && x <= right && y >= top && y <= bottom;
  }

  private pointInsideSelectionBounds(x: number, y: number): boolean {
    const bounds = this.selectionBounds();
    if (!bounds) return false;
    const padding = Math.max(10, 8 / Math.max(0.1, this.view.scale));
    return this.pointInRect(x, y, bounds.x - padding, bounds.y - padding,
      bounds.x + bounds.width + padding, bounds.y + bounds.height + padding);
  }

  private resizeHandleHit(x: number, y: number): string | null {
    if (this.selectedObjectIds.size !== 1) return null;
    const id = [...this.selectedObjectIds][0];
    const object = this.strokeManager.objects.find((candidate) => candidate.id === id);
    if (!object) return null;
    const bounds = this.objectBounds(object);
    const tolerance = Math.max(10, object.size + 6);
    return Math.hypot(x - (bounds.x + bounds.width), y - (bounds.y + bounds.height)) <= tolerance ? id : null;
  }

  render(): void {
    if (this.staticDirty) {
      this.renderStatic();
      this.staticDirty = false;
    }
    if (this.activeDirty) {
      this.renderActive();
      this.activeDirty = false;
    }
    this.rafId = 0;
  }

  requestRender(): void {
    if (this.rafId !== 0) return;
    this.rafId = window.requestAnimationFrame(() => this.render());
  }

  exportThumbnail(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const bounds = this.getContentBounds();
      if (bounds.width === 0 || bounds.height === 0) {
        resolve(null);
        return;
      }

      const thumbCanvas = createEl('canvas');
      const maxSize = 256;
      const scale = Math.min(maxSize / bounds.width, maxSize / bounds.height);
      thumbCanvas.width = Math.ceil(bounds.width * scale);
      thumbCanvas.height = Math.ceil(bounds.height * scale);

      const ctx = thumbCanvas.getContext('2d')!;
      ctx.scale(scale, scale);
      ctx.translate(-bounds.x, -bounds.y);
      this.renderStrokes(ctx, this.strokeManager.strokes);

      thumbCanvas.toBlob((blob) => resolve(blob));
    });
  }

  getContentBounds(): { x: number; y: number; width: number; height: number } {
    const strokes = this.strokeManager.strokes;
    const objects = this.strokeManager.objects;
    if (strokes.length === 0 && objects.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxSize = 0;

    for (const stroke of strokes) {
      if (stroke.size > maxSize) maxSize = stroke.size;
      for (const point of stroke.points) {
        if (point[0] < minX) minX = point[0];
        if (point[1] < minY) minY = point[1];
        if (point[0] > maxX) maxX = point[0];
        if (point[1] > maxY) maxY = point[1];
      }
    }

    for (const object of objects) {
      const x2 = object.x + object.width;
      const y2 = object.y + object.height;
      minX = Math.min(minX, object.x, x2);
      minY = Math.min(minY, object.y, y2);
      maxX = Math.max(maxX, object.x, x2);
      maxY = Math.max(maxY, object.y, y2);
      if (object.size > maxSize) maxSize = object.size;
    }

    const pad = maxSize / 2;
    return {
      x: minX - pad,
      y: minY - pad,
      width: (maxX - minX) + maxSize,
      height: (maxY - minY) + maxSize,
    };
  }


  setCanvasSize(width: number, height: number): void {
    if (width === 0 || height === 0) return;
    this.drawingWidth = width;
    this.drawingHeight = height;
    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
    this.staticCanvas.width = width * dpr;
    this.staticCanvas.height = height * dpr;
    this.activeCanvas.width = width * dpr;
    this.activeCanvas.height = height * dpr;
    this.staticDirty = true;
    this.activeDirty = true;
    this.requestRender();
  }

  /** Size the backing store to the display box (CSS px) and recompute the view. */
  setDisplaySize(width: number, height: number): void {
    if (width === 0 || height === 0) return;
    this.displayWidth = width;
    this.displayHeight = height;
    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
    this.staticCanvas.width = width * dpr;
    this.staticCanvas.height = height * dpr;
    this.activeCanvas.width = width * dpr;
    this.activeCanvas.height = height * dpr;
    this.recomputeView();
    this.staticDirty = true;
    this.activeDirty = true;
    this.requestRender();
  }

  /**
   * Standalone view: size the backing store to a CSS box and centre the content at
   * scale 1 (no zoom). Empty content centres the drawing-space origin in the box.
   */
  centerInBox(boxW: number, boxH: number): void {
    if (boxW <= 0 || boxH <= 0) return;
    this.resizeBackingStore(boxW, boxH);
    const b = this.getContentBounds();
    this.contentBounds = (b.width > 0 && b.height > 0) ? b : null;
    this.view = centerContentInBox({ width: boxW, height: boxH }, this.contentBounds);
    this.staticDirty = true;
    this.activeDirty = true;
    this.requestRender();
  }

  /**
   * Replace the view transform wholesale (presentation-facing pan/zoom). `scale` is clamped
   * to [MIN_SCALE, MAX_SCALE]; the render pipeline is untouched (it still composes
   * `view.scale`/`view.offset` with DPR). Marks both layers dirty and requests a render.
   */
  setView(view: ViewTransform): void {
    this.view = {
      scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale)),
      offsetX: view.offsetX,
      offsetY: view.offsetY,
    };
    this.staticDirty = true;
    this.activeDirty = true;
    this.requestRender();
  }

  /** Translate the view offset by (dx, dy) display px without changing the scale. */
  panBy(dx: number, dy: number): void {
    this.view = { scale: this.view.scale, offsetX: this.view.offsetX + dx, offsetY: this.view.offsetY + dy };
    this.staticDirty = true;
    this.activeDirty = true;
    this.requestRender();
  }

  /**
   * Focal-point zoom: scale by `factor` about the box-local point (cx, cy), clamped to
   * [MIN_SCALE, MAX_SCALE], keeping the content under (cx, cy) fixed on screen.
   */
  zoomAt(factor: number, cx: number, cy: number): void {
    const scale = this.view.scale;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
    this.view = {
      scale: newScale,
      offsetX: cx - (cx - this.view.offsetX) / scale * newScale,
      offsetY: cy - (cy - this.view.offsetY) / scale * newScale,
    };
    this.staticDirty = true;
    this.activeDirty = true;
    this.requestRender();
  }

  /** Resize the backing store to a CSS box without changing the view transform. */
  resizeBox(boxW: number, boxH: number): void {
    if (boxW <= 0 || boxH <= 0) return;
    this.resizeBackingStore(boxW, boxH);
    this.staticDirty = true;
    this.activeDirty = true;
    this.requestRender();
  }

  private resizeBackingStore(boxW: number, boxH: number): void {
    this.displayWidth = boxW;
    this.displayHeight = boxH;
    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
    this.staticCanvas.width = boxW * dpr;
    this.staticCanvas.height = boxH * dpr;
    this.activeCanvas.width = boxW * dpr;
    this.activeCanvas.height = boxH * dpr;
  }

  /** Recompute the content bbox from current strokes and re-fit. Call on idle, NOT mid-stroke. */
  refitToContent(padding = 0): void {
    const b = this.getContentBounds();
    this.contentBounds = (b.width > 0 && b.height > 0) ? b : null;
    this.recomputeView(padding);
    this.staticDirty = true;
    this.activeDirty = true;
    this.requestRender();
  }

  /**
   * Fit content to the display box using an explicit caller-supplied reference size
   * (the file's saved `width`/`height`) instead of the live recomputed content bounds.
   *
   * The reference rectangle is anchored at the live content origin but takes its
   * DIMENSIONS from the caller, so the resulting scale is `min(boxW/refW, boxH/refH)`
   * regardless of how the content has since grown. Because the saved dimensions are the
   * stable description of the drawing at save time, fitting against them reproduces the
   * same scale across a save→reload round trip — existing strokes keep their on-screen
   * size when an embedded surface is unmounted and remounted after an edit (B3). Anchoring
   * at the live origin makes the content's top-left land at the same screen position too,
   * since the origin cancels in the letterbox offset. Like refitToContent/resizeBox, apply
   * this on layout/resize only, never per stroke.
   */
  fitReferenceSize(refWidth: number, refHeight: number, padding = 0, maxScale = Infinity): void {
    const b = this.getContentBounds();
    const hasContent = b.width > 0 && b.height > 0;
    const reference = (refWidth > 0 && refHeight > 0)
      ? { x: hasContent ? b.x : 0, y: hasContent ? b.y : 0, width: refWidth, height: refHeight }
      : null;
    this.contentBounds = reference;
    this.view = fitContentToBox(
      { width: this.displayWidth || this.drawingWidth, height: this.displayHeight || this.drawingHeight },
      reference,
      padding,
      maxScale,
    );
    this.staticDirty = true;
    this.activeDirty = true;
    this.requestRender();
  }

  private recomputeView(padding = 0): void {
    this.view = fitContentToBox(
      { width: this.displayWidth || this.drawingWidth, height: this.displayHeight || this.drawingHeight },
      this.contentBounds,
      padding,
    );
  }

  getViewTransform(): ViewTransform {
    return { ...this.view };
  }

  /**
   * Map a pointer event to drawing-space coordinates. `el` must be the same element
   * whose layout size drives `setDisplaySize`. Divides by rect.width/height before
   * inverting the view transform to compensate for any CSS zoom applied by
   * Obsidian Canvas (pointer offsets are in rendered px, not layout px).
   */
  screenToDrawing(clientX: number, clientY: number, el: HTMLElement): [number, number] {
    const rect = el.getBoundingClientRect();
    const sx = rect.width ? el.clientWidth / rect.width : 1;
    const sy = rect.height ? el.clientHeight / rect.height : 1;
    const p = screenToContent((clientX - rect.left) * sx, (clientY - rect.top) * sy, this.view);
    return [p.x, p.y];
  }

  destroy(): void {
    if (this.rafId !== 0) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.staticCanvas.remove();
    this.activeCanvas.remove();
  }

  private renderStatic(): void {
    const ctx = this.staticCtx;
    const w = this.staticCanvas.width;
    const h = this.staticCanvas.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.restore();

    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
    this.renderPage(ctx, w, h, dpr);
    ctx.save();
    ctx.setTransform(dpr * this.view.scale, 0, 0, dpr * this.view.scale, dpr * this.view.offsetX, dpr * this.view.offsetY);

    const penStrokes = this.strokeManager.strokes.filter(s => s.tool === 'pen');
    const highlighterStrokes = this.strokeManager.strokes.filter(s => s.tool === 'highlighter');

    for (const stroke of penStrokes) {
      this.renderSingleStroke(ctx, stroke);
    }

    ctx.globalCompositeOperation = 'destination-over';
    for (const stroke of highlighterStrokes) {
      this.renderSingleStroke(ctx, stroke);
    }

    for (const object of this.strokeManager.objects) {
      this.renderObject(ctx, object);
    }
    this.renderSelection(ctx);

    ctx.restore();
  }

  private renderActive(): void {
    const ctx = this.activeCtx;
    const w = this.activeCanvas.width;
    const h = this.activeCanvas.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.restore();

    if (this.activePoints.length < 1 && !this.activeObject && !this.eraserCursor && this.selectionDrag?.mode !== 'lasso') return;

    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
    ctx.save();
    ctx.setTransform(dpr * this.view.scale, 0, 0, dpr * this.view.scale, dpr * this.view.offsetX, dpr * this.view.offsetY);

    if (this.activePoints.length > 0) {
      const outlinePoints = getStroke(this.activePoints, {
        size: this.toolManager.activeSize,
        smoothing: this.inkProfile.smoothing,
        streamline: this.inkProfile.streamline,
        thinning: this.inkProfile.thinning,
        simulatePressure: this.inkProfile.simulatePressure,
      });

      ctx.globalAlpha = this.toolManager.activeOpacity;
      ctx.fillStyle = this.toolManager.activeColor;
      this.fillOutline(ctx, outlinePoints);
    }

    if (this.activeObject) this.renderObject(ctx, this.activeObject, true);
    if (this.selectionDrag?.mode === 'lasso') {
      const left = Math.min(this.selectionDrag.startX, this.selectionDrag.lastX);
      const right = Math.max(this.selectionDrag.startX, this.selectionDrag.lastX);
      const top = Math.min(this.selectionDrag.startY, this.selectionDrag.lastY);
      const bottom = Math.max(this.selectionDrag.startY, this.selectionDrag.lastY);
      this.drawDashedRect(ctx, left, top, right, bottom, '#8b5cf6');
    }
    if (this.eraserCursor && typeof ctx.arc === 'function' && typeof ctx.stroke === 'function') {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#f97316';
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1 / Math.max(0.1, this.view.scale);
      ctx.beginPath();
      ctx.arc(this.eraserCursor.x, this.eraserCursor.y, this.eraserCursor.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  private renderStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[]): void {
    const penStrokes = strokes.filter(s => s.tool === 'pen');
    const highlighterStrokes = strokes.filter(s => s.tool === 'highlighter');

    for (const stroke of penStrokes) {
      this.renderSingleStroke(ctx, stroke);
    }

    for (const stroke of highlighterStrokes) {
      this.renderSingleStroke(ctx, stroke);
    }
  }

  private renderSingleStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    if (stroke.points.length < 1) return;

    const outlinePoints = getStroke(stroke.points, {
      size: stroke.size,
      smoothing: this.inkProfile.smoothing,
      streamline: this.inkProfile.streamline,
      thinning: this.inkProfile.thinning,
      simulatePressure: this.inkProfile.simulatePressure,
    });

    ctx.globalAlpha = stroke.opacity;
    ctx.fillStyle = readableInkColor(stroke.color, this.page.color);
    this.fillOutline(ctx, outlinePoints);
  }

  private renderSelection(ctx: CanvasRenderingContext2D): void {
    const bounds = this.selectionBounds();
    if (!bounds) return;
    this.drawDashedRect(
      ctx,
      bounds.x - 5,
      bounds.y - 5,
      bounds.x + bounds.width + 5,
      bounds.y + bounds.height + 5,
      '#8b5cf6',
    );
    if (this.selectedObjectIds.size === 1 && typeof ctx.fillRect === 'function') {
      const object = this.strokeManager.objects.find((candidate) => this.selectedObjectIds.has(candidate.id));
      if (object) {
        const objectBounds = this.objectBounds(object);
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#8b5cf6';
        const size = 8 / Math.max(0.1, this.view.scale);
        ctx.fillRect(objectBounds.x + objectBounds.width - size / 2, objectBounds.y + objectBounds.height - size / 2, size, size);
        ctx.restore();
      }
    }
  }

  private drawDashedRect(ctx: CanvasRenderingContext2D, left: number, top: number, right: number, bottom: number, color: string): void {
    if (typeof ctx.stroke !== 'function' || typeof ctx.beginPath !== 'function') return;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 1 / Math.max(0.1, this.view.scale);
    if (typeof ctx.setLineDash === 'function') ctx.setLineDash([6 / Math.max(0.1, this.view.scale), 4 / Math.max(0.1, this.view.scale)]);
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(right, top);
    ctx.lineTo(right, bottom);
    ctx.lineTo(left, bottom);
    if (typeof ctx.closePath === 'function') ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  private selectionBounds(): { x: number; y: number; width: number; height: number } | null {
    if (!this.hasSelection()) return null;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const stroke of this.strokeManager.strokes) {
      if (!this.selectedStrokeIds.has(stroke.id)) continue;
      const bounds = this.strokeBounds(stroke);
      left = Math.min(left, bounds.x);
      top = Math.min(top, bounds.y);
      right = Math.max(right, bounds.x + bounds.width);
      bottom = Math.max(bottom, bounds.y + bounds.height);
    }
    for (const object of this.strokeManager.objects) {
      if (!this.selectedObjectIds.has(object.id)) continue;
      const bounds = this.objectBounds(object);
      left = Math.min(left, bounds.x);
      top = Math.min(top, bounds.y);
      right = Math.max(right, bounds.x + bounds.width);
      bottom = Math.max(bottom, bounds.y + bounds.height);
    }
    if (!Number.isFinite(left)) return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  private renderPage(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number): void {
    // Preserve the original fast path for the default Blackboard surface. Most boards use
    // a transparent blank page, so there is no page layer to paint until the user selects a
    // paper style.
    if (this.page.type === 'blank' && (!this.page.color || this.page.color === 'transparent')) return;
    if (typeof ctx.fillRect !== 'function') return;
    const pageColor = this.page.color || 'transparent';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = pageColor;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    if (this.page.type === 'blank') return;
    const gridSize = Math.max(8, this.page.gridSize || 24);
    const gridColor = this.page.gridColor || '#9aa4b2';
    ctx.save();
    ctx.setTransform(dpr * this.view.scale, 0, 0, dpr * this.view.scale, dpr * this.view.offsetX, dpr * this.view.offsetY);
    ctx.strokeStyle = gridColor;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 1 / Math.max(0.1, this.view.scale);
    const left = (-this.view.offsetX / this.view.scale) - gridSize;
    const top = (-this.view.offsetY / this.view.scale) - gridSize;
    const right = left + width / (dpr * this.view.scale) + gridSize * 2;
    const bottom = top + height / (dpr * this.view.scale) + gridSize * 2;
    const startX = Math.floor(left / gridSize) * gridSize;
    const startY = Math.floor(top / gridSize) * gridSize;

    if (this.page.type === 'dot-grid') {
      ctx.fillStyle = gridColor;
      for (let x = startX; x <= right; x += gridSize) {
        for (let y = startY; y <= bottom; y += gridSize) ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
      }
    } else {
      ctx.beginPath();
      if (this.page.type === 'line-grid' || this.page.type === 'square-grid') {
        for (let y = startY; y <= bottom; y += gridSize) { ctx.moveTo(left, y); ctx.lineTo(right, y); }
      }
      if (this.page.type === 'square-grid') {
        for (let x = startX; x <= right; x += gridSize) { ctx.moveTo(x, top); ctx.lineTo(x, bottom); }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private renderObject(ctx: CanvasRenderingContext2D, object: DiagramObject, preview = false): void {
    const x = object.x;
    const y = object.y;
    const w = object.width;
    const h = object.height;
    ctx.save();
    ctx.globalAlpha = object.opacity;
    ctx.strokeStyle = readableInkColor(object.color, this.page.color);
    ctx.lineWidth = object.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const lineStyle = object.lineStyle ?? 'solid';
    if (typeof ctx.setLineDash === 'function') {
      ctx.setLineDash(lineStyle === 'dashed' ? [8, 6] : lineStyle === 'dotted' ? [1, 5] : []);
    }
    if (preview) ctx.setLineDash([6, 4]);
    if (object.fill !== 'transparent' && object.fillOpacity > 0) {
      ctx.globalAlpha = object.fillOpacity;
      ctx.fillStyle = readableInkColor(object.fill, this.page.color);
      if (object.kind === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(Math.min(x, x + w), Math.min(y, y + h), Math.abs(w), Math.abs(h));
      }
      ctx.globalAlpha = object.opacity;
    }
    ctx.beginPath();
    if (object.kind === 'rectangle') {
      const left = Math.min(x, x + w);
      const top = Math.min(y, y + h);
      const right = Math.max(x, x + w);
      const bottom = Math.max(y, y + h);
      if (typeof ctx.rect === 'function') ctx.rect(left, top, right - left, bottom - top);
      else {
        ctx.moveTo(left, top);
        ctx.lineTo(right, top);
        ctx.lineTo(right, bottom);
        ctx.lineTo(left, bottom);
        ctx.lineTo(left, top);
      }
      if (typeof ctx.stroke === 'function') ctx.stroke();
    } else if (object.kind === 'ellipse') {
      if (typeof ctx.ellipse === 'function') {
        ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
      } else {
        const left = Math.min(x, x + w);
        const top = Math.min(y, y + h);
        const right = Math.max(x, x + w);
        const bottom = Math.max(y, y + h);
        ctx.moveTo(left, (top + bottom) / 2);
        ctx.lineTo((left + right) / 2, top);
        ctx.lineTo(right, (top + bottom) / 2);
        ctx.lineTo((left + right) / 2, bottom);
        ctx.lineTo(left, (top + bottom) / 2);
      }
      if (typeof ctx.stroke === 'function') ctx.stroke();
    } else {
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y + h);
      if (typeof ctx.stroke === 'function') ctx.stroke();
      if (object.kind === 'arrow') {
        const angle = Math.atan2(h, w);
        const length = Math.max(8, object.size * 4);
        ctx.beginPath();
        ctx.moveTo(x + w, y + h);
        ctx.lineTo(x + w - length * Math.cos(angle - Math.PI / 6), y + h - length * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(x + w, y + h);
        ctx.lineTo(x + w - length * Math.cos(angle + Math.PI / 6), y + h - length * Math.sin(angle + Math.PI / 6));
        if (typeof ctx.stroke === 'function') ctx.stroke();
      }
    }

    ctx.restore();
  }

  private fillOutline(ctx: CanvasRenderingContext2D, points: number[][]): void {
    if (points.length === 0) return;

    ctx.beginPath();

    if (points.length < 3) {
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i][0], points[i][1]);
      }
    } else {
      ctx.moveTo(points[0][0], points[0][1]);

      let midX = (points[0][0] + points[1][0]) / 2;
      let midY = (points[0][1] + points[1][1]) / 2;
      ctx.lineTo(midX, midY);

      for (let i = 1; i < points.length - 1; i++) {
        const nextMidX = (points[i][0] + points[i + 1][0]) / 2;
        const nextMidY = (points[i][1] + points[i + 1][1]) / 2;
        ctx.quadraticCurveTo(points[i][0], points[i][1], nextMidX, nextMidY);
      }

      const last = points[points.length - 1];
      ctx.lineTo(last[0], last[1]);
    }

    ctx.closePath();
    ctx.fill();
  }
}
