import { getStroke } from 'perfect-freehand';
import { INK_PROFILES } from '../domain/entities';
import type { Background, DiagramObject, InkProfile, Stroke } from '../domain/entities';
import { readableInkColor } from '../domain/ink-color';

export function getSvgPathFromStroke(points: number[][]): string {
  if (points.length < 2) return '';

  const first = points[0];
  let d = `M${first[0].toFixed(2)},${first[1].toFixed(2)}`;

  for (let i = 1; i < points.length - 1; i++) {
    const cp = points[i];
    const next = points[i + 1];
    const midX = (cp[0] + next[0]) / 2;
    const midY = (cp[1] + next[1]) / 2;
    d += ` Q${cp[0].toFixed(2)},${cp[1].toFixed(2)} ${midX.toFixed(2)},${midY.toFixed(2)}`;
  }

  const last = points[points.length - 1];
  d += ` Q${last[0].toFixed(2)},${last[1].toFixed(2)} ${first[0].toFixed(2)},${first[1].toFixed(2)}Z`;

  return d;
}

export function getStrokeBounds(strokes: Stroke[]): { x: number; y: number; width: number; height: number } {
  if (strokes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of strokes) {
    for (const point of stroke.points) {
      if (point[0] < minX) minX = point[0];
      if (point[1] < minY) minY = point[1];
      if (point[0] > maxX) maxX = point[0];
      if (point[1] > maxY) maxY = point[1];
    }
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function exportSvg(
  strokes: Stroke[],
  background: Background,
  inkProfile: InkProfile = INK_PROFILES.raw,
  objects: DiagramObject[] = [],
): string {
  const strokeBounds = getStrokeBounds(strokes);
  let bounds = { ...strokeBounds };
  for (const object of objects) {
    const x2 = object.x + object.width;
    const y2 = object.y + object.height;
    const left = Math.min(object.x, x2);
    const top = Math.min(object.y, y2);
    const right = Math.max(object.x, x2);
    const bottom = Math.max(object.y, y2);
    if (bounds.width === 0 && bounds.height === 0 && strokes.length === 0) {
      bounds = { x: left, y: top, width: right - left, height: bottom - top };
    } else {
      const rightMost = Math.max(bounds.x + bounds.width, right);
      const bottomMost = Math.max(bounds.y + bounds.height, bottom);
      bounds = {
        x: Math.min(bounds.x, left),
        y: Math.min(bounds.y, top),
        width: rightMost - Math.min(bounds.x, left),
        height: bottomMost - Math.min(bounds.y, top),
      };
    }
  }
  const padding = 20;
  const vx = bounds.x - padding;
  const vy = bounds.y - padding;
  const vw = bounds.width + padding * 2;
  const vh = bounds.height + padding * 2;

  let defs = '';
  let gridRect = '';

  if (background.grid) {
    const gs = background.gridSize;
    defs = `<defs><pattern id="grid" width="${gs}" height="${gs}" patternUnits="userSpaceOnUse"><path d="M ${gs} 0 L 0 0 0 ${gs}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="0.5"/></pattern></defs>`;
    gridRect = `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="url(#grid)"/>`;
  }

  const paths = strokes.map((stroke) => {
    const outlinePoints = getStroke(stroke.points, {
      size: stroke.size,
      smoothing: inkProfile.smoothing,
      streamline: inkProfile.streamline,
      thinning: inkProfile.thinning,
      simulatePressure: inkProfile.simulatePressure,
    });
    const d = getSvgPathFromStroke(outlinePoints);
    return `<path d="${d}" fill="${readableInkColor(stroke.color, background.color)}" opacity="${stroke.opacity}"/>`;
  });

  const objectMarkup = objects.map((object) => {
    const dash = object.lineStyle === 'dashed' ? ' stroke-dasharray="8 6"' : object.lineStyle === 'dotted' ? ' stroke-dasharray="1 5"' : '';
    const style = `stroke="${readableInkColor(object.color, background.color)}" stroke-width="${object.size}" stroke-linecap="round" opacity="${object.opacity}"${dash}`;
    const x2 = object.x + object.width;
    const y2 = object.y + object.height;
    const fill = `fill="${object.fill === 'transparent' ? 'none' : readableInkColor(object.fill, background.color)}" fill-opacity="${object.fillOpacity}"`;
    if (object.kind === 'rectangle') return `<rect x="${Math.min(object.x, x2)}" y="${Math.min(object.y, y2)}" width="${Math.abs(object.width)}" height="${Math.abs(object.height)}" ${style} ${fill}/>`;
    if (object.kind === 'ellipse') return `<ellipse cx="${(object.x + x2) / 2}" cy="${(object.y + y2) / 2}" rx="${Math.abs(object.width / 2)}" ry="${Math.abs(object.height / 2)}" ${style} ${fill}/>`;
    const angle = Math.atan2(object.height, object.width);
    const length = Math.max(8, object.size * 4);
    const arrow = object.kind === 'arrow'
      ? ` M${x2 - length * Math.cos(angle - Math.PI / 6)},${y2 - length * Math.sin(angle - Math.PI / 6)} L${x2},${y2} L${x2 - length * Math.cos(angle + Math.PI / 6)},${y2 - length * Math.sin(angle + Math.PI / 6)}`
      : '';
    return `<path d="M${object.x},${object.y} L${x2},${y2}${arrow}" ${style} fill="none"/>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}">${defs}${gridRect}${paths.join('')}${objectMarkup}</svg>`;
}
