export const FILE_EXTENSION = 'blackboard';

export type Point = [number, number, number];

export interface Background {
  type: 'blank' | 'dot-grid' | 'line-grid' | 'square-grid';
  color: string;
  grid: boolean;
  gridSize: number;
  gridColor?: string;
}

export type DiagramObjectKind = 'line' | 'arrow' | 'rectangle' | 'ellipse';
export type DrawingTool = 'pen' | 'highlighter' | 'eraser' | 'selection' | DiagramObjectKind;

export type InkProfileMode = 'raw' | 'natural' | 'pressure';

export interface InkProfile {
  mode: InkProfileMode;
  smoothing: number;
  streamline: number;
  thinning: number;
  simulatePressure: boolean;
}

export const INK_PROFILES: Record<InkProfileMode, InkProfile> = {
  raw: { mode: 'raw', smoothing: 0, streamline: 0, thinning: 0, simulatePressure: false },
  natural: { mode: 'natural', smoothing: 0.5, streamline: 0.5, thinning: 0.5, simulatePressure: true },
  pressure: { mode: 'pressure', smoothing: 0, streamline: 0, thinning: 0.5, simulatePressure: false },
};

export interface DiagramObject {
  id: string;
  kind: DiagramObjectKind;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  size: number;
  opacity: number;
  fill: string;
  fillOpacity: number;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  timestamp: number;
}

export interface Stroke {
  id: string;
  tool: 'pen' | 'highlighter';
  color: string;
  size: number;
  opacity: number;
  points: Point[];
  hasPressure: boolean;
  timestamp: number;
}

export interface ToolState {
  activeTool: DrawingTool;
  penColor: string;
  penSize: number;
  highlighterColor: string;
  highlighterSize: number;
  eraserSize: number;
}

/**
 * The per-tool default values seeded once into the shared `ToolManager`. Mirrors the
 * prior `default*` settings so first-run tool behavior is unchanged now that those
 * settings fields are gone.
 */
export const DEFAULT_TOOL_STATE: ToolState = {
  activeTool: 'pen',
  penColor: '#ffffff',
  penSize: 2,
  highlighterColor: '#ffff00',
  // The highlighter has its own wider size scale (HIGHLIGHTER_SIZES); its default lands on
  // a mid preset (22) so a marker looks like a marker. The eraser default lands on a real
  // PEN_SIZES preset (8) so the size popover can highlight its selected dot.
  highlighterSize: 22,
  eraserSize: 8,
};

export type StrokeAction =
  | { type: 'add'; stroke: Stroke }
  | { type: 'delete'; strokeId: string; stroke: Stroke }
  | { type: 'move'; strokeIds: string[]; dx: number; dy: number }
  | { type: 'clear'; strokes: Stroke[] };

export interface PluginSettings {
  drawingFolder: string;
  newFileLocation: 'fixed' | 'current';
  autoExportSvg: boolean;
  svgExportPath: string;
  /** Exactly eight color shortcuts (6-digit hex) in toolbar display order. */
  paletteColors: string[];
  /**
   * Whether the collapsed toolbar pill (the circular pen-icon affordance) is shown on
   * Markdown/Canvas host views with no active drawing surface. True preserves the
   * always-present pill; false suppresses only that persistent no-surface pill.
   */
  showToolbarPill: boolean;
  /**
   * CSS color painted behind every drawing surface (standalone view, Markdown embed, and
   * Canvas node). Default '#000000' keeps the classic blackboard; set '#ffffff' for a
   * whiteboard, or any CSS color. Applies on-screen only — SVG export stays transparent.
   */
  boardBackground: string;
}

/** The eight color-popover shortcuts seeded by default, in display order. */
export const DEFAULT_PALETTE_COLORS = [
  '#000000', '#ffffff', '#ff0000', '#0000ff', '#00ff00', '#ffff00', '#ffa500', '#800080',
];

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  drawingFolder: 'Blackboard',
  newFileLocation: 'fixed',
  autoExportSvg: false,
  svgExportPath: '',
  paletteColors: [...DEFAULT_PALETTE_COLORS],
  showToolbarPill: true,
  boardBackground: '#000000',
};

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export interface BlackboardFile {
  version: number;
  /** Content bounding-box dimensions, cached on save (recomputable from strokes). */
  width: number;
  /** Content bounding-box dimensions, cached on save (recomputable from strokes). */
  height: number;
  strokes: Stroke[];
  /** Optional for backwards-compatible v3 files that predate diagram objects. */
  objects?: DiagramObject[];
  background: { color: string };
  page?: Background;
  /** Optional board-level rendering profile; omitted means raw ink for legacy files. */
  inkProfile?: InkProfile;
  /** Cached drawing-space content bounding box (recomputable from strokes). */
  contentBounds?: { x: number; y: number; width: number; height: number };
}

export function createDefaultFile(_settings: PluginSettings): BlackboardFile {
  return {
    version: 3,
    width: 800,
    height: 600,
    strokes: [],
    background: { color: 'transparent' },
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

export function validateFileData(raw: unknown): BlackboardFile | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.version !== 'number') return null;
  if (!Array.isArray(raw.strokes)) return null;

  const strokes = raw.strokes.filter((s: unknown): s is Stroke =>
    isRecord(s) && typeof s.id === 'string' &&
    Array.isArray(s.points) &&
    typeof s.color === 'string' &&
    typeof s.tool === 'string'
  );
  const objects = Array.isArray(raw.objects)
    ? raw.objects.filter((o: unknown): o is DiagramObject =>
      isRecord(o) && typeof o.id === 'string' &&
      (o.kind === 'line' || o.kind === 'arrow' || o.kind === 'rectangle' || o.kind === 'ellipse') &&
      typeof o.x === 'number' && typeof o.y === 'number' &&
      typeof o.width === 'number' && typeof o.height === 'number' &&
      typeof o.color === 'string' && typeof o.size === 'number' &&
      (o.lineStyle === undefined || o.lineStyle === 'solid' || o.lineStyle === 'dashed' || o.lineStyle === 'dotted')
    )
    : undefined;

  const result: BlackboardFile = {
    version: raw.version,
    width: (typeof raw.width === 'number' && raw.width > 0) ? raw.width : 800,
    height: (typeof raw.height === 'number' && raw.height > 0) ? raw.height : 600,
    strokes,
    background: isRecord(raw.background) && typeof raw.background.color === 'string'
      ? { color: raw.background.color }
      : { color: 'transparent' },
  };
  if (objects !== undefined) result.objects = objects;
  if (isRecord(raw.page) &&
      (raw.page.type === 'blank' || raw.page.type === 'dot-grid' || raw.page.type === 'line-grid' || raw.page.type === 'square-grid') &&
      typeof raw.page.color === 'string' && typeof raw.page.gridSize === 'number') {
    result.page = {
      type: raw.page.type,
      color: raw.page.color,
      grid: raw.page.type !== 'blank',
      gridSize: Math.max(8, Math.min(200, raw.page.gridSize)),
      gridColor: typeof raw.page.gridColor === 'string' ? raw.page.gridColor : '#9aa4b2',
    };
  }
  if (isRecord(raw.inkProfile) &&
      (raw.inkProfile.mode === 'raw' || raw.inkProfile.mode === 'natural' || raw.inkProfile.mode === 'pressure')) {
    const mode = raw.inkProfile.mode;
    const defaults = INK_PROFILES[mode];
    result.inkProfile = {
      mode,
      smoothing: typeof raw.inkProfile.smoothing === 'number' ? Math.max(0, Math.min(1, raw.inkProfile.smoothing)) : defaults.smoothing,
      streamline: typeof raw.inkProfile.streamline === 'number' ? Math.max(0, Math.min(1, raw.inkProfile.streamline)) : defaults.streamline,
      thinning: typeof raw.inkProfile.thinning === 'number' ? Math.max(-1, Math.min(1, raw.inkProfile.thinning)) : defaults.thinning,
      simulatePressure: typeof raw.inkProfile.simulatePressure === 'boolean' ? raw.inkProfile.simulatePressure : defaults.simulatePressure,
    };
  }
  if (isRecord(raw.contentBounds)) {
    const cb = raw.contentBounds;
    if (typeof cb.x === 'number' && typeof cb.y === 'number' &&
        typeof cb.width === 'number' && cb.width >= 0 &&
        typeof cb.height === 'number' && cb.height >= 0) {
      result.contentBounds = { x: cb.x, y: cb.y, width: cb.width, height: cb.height };
    }
  }
  return result;
}

export function validateSettings(settings: PluginSettings): PluginSettings {
  const result = { ...settings };
  if (typeof result.drawingFolder !== 'string') {
    result.drawingFolder = 'Blackboard';
  }
  if (result.newFileLocation !== 'fixed' && result.newFileLocation !== 'current') {
    result.newFileLocation = 'fixed';
  }
  if (typeof result.autoExportSvg !== 'boolean') {
    result.autoExportSvg = false;
  }
  if (typeof result.svgExportPath !== 'string') {
    result.svgExportPath = '';
  }
  if (typeof result.showToolbarPill !== 'boolean') {
    result.showToolbarPill = true;
  }
  if (typeof result.boardBackground !== 'string' || result.boardBackground === '') {
    result.boardBackground = '#000000';
  }
  // Palette: a non-array or wrong-length value is reset wholesale; an eight-entry array
  // has only its invalid hex entries repaired in place to the default at that index.
  if (!Array.isArray(result.paletteColors) || result.paletteColors.length !== 8) {
    result.paletteColors = [...DEFAULT_PALETTE_COLORS];
  } else {
    result.paletteColors = result.paletteColors.map((c, i) =>
      typeof c === 'string' && HEX6.test(c) ? c : DEFAULT_PALETTE_COLORS[i],
    );
  }
  return result;
}
