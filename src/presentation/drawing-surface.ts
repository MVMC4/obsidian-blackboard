import type { Background, DrawingTool, InkProfile } from '../domain/entities';
import type { DrawingEngine } from '../infrastructure/canvas-renderer';

export type ToolName = DrawingTool;

/**
 * The contract the global floating toolbar drives. Implemented by each drawing
 * surface (the standalone BlackboardView and every canvas embed) over its engine,
 * so one shared toolbar can control whichever drawing is currently active.
 */
export interface DrawingSurface {
  setTool(tool: ToolName): void;
  setColor(color: string): void;
  setSize(size: number): void;
  /** Change the per-board paper style. Optional for compatibility with older test hosts. */
  setPage?(page: Background): void;
  setInkProfile?(profile: InkProfile): void;
  setSelectedLineStyle?(style: 'solid' | 'dashed' | 'dotted'): void;
  deleteSelection?(): void;
  exportSvg?(selectionOnly?: boolean): void;
  undo(): void;
  redo(): void;
  readonly activeTool: ToolName;
  readonly activeColor: string;
  readonly activeSize: number;
  /** Pen color regardless of the active tool — lets the toolbar tint the pen glyph. */
  readonly penColor: string;
  /** Highlighter color regardless of the active tool — lets the toolbar tint the highlighter glyph. */
  readonly highlighterColor: string;
  readonly page?: Background;
  readonly inkProfile?: InkProfile;
  readonly selectedLineStyle?: 'solid' | 'dashed' | 'dotted' | null;
  readonly hasSelection?: boolean;
  canUndo(): boolean;
  canRedo(): boolean;
}

/** Build a DrawingSurface backed by a DrawingEngine + a save callback. */
export function engineSurface(engine: DrawingEngine, save: () => void, exportSvg?: (selectionOnly?: boolean) => void): DrawingSurface {
  return {
    setTool: (t) => { engine.clearEraserCursor(); engine.toolManager.setTool(t); },
    setColor: (c) => {
      engine.toolManager.setColor(c);
      if (engine.setSelectionColor(c)) save();
    },
    setSize: (s) => engine.toolManager.setSize(s),
    setPage: (page) => { engine.setPage(page); save(); },
    setInkProfile: (profile) => { engine.setInkProfile(profile); save(); },
    setSelectedLineStyle: (style) => { if (engine.setSelectionLineStyle(style)) save(); },
    deleteSelection: () => {
      if (!engine.deleteSelection()) return;
      engine.staticDirty = true;
      engine.requestRender();
      save();
    },
    exportSvg,
    undo: () => { engine.strokeManager.undo(); engine.staticDirty = true; engine.requestRender(); save(); },
    redo: () => { engine.strokeManager.redo(); engine.staticDirty = true; engine.requestRender(); save(); },
    get activeTool() { return engine.toolManager.activeTool; },
    get activeColor() { return engine.toolManager.activeColor; },
    get activeSize() { return engine.toolManager.activeSize; },
    get penColor() { return engine.toolManager.penColor; },
    get highlighterColor() { return engine.toolManager.highlighterColor; },
    get page() { return engine.getPage(); },
    get inkProfile() { return engine.getInkProfile(); },
    get selectedLineStyle() { return engine.getSelectedLineStyle(); },
    get hasSelection() { return engine.hasSelection(); },
    canUndo: () => engine.strokeManager.canUndo(),
    canRedo: () => engine.strokeManager.canRedo(),
  };
}
