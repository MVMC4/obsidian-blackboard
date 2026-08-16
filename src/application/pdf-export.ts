import { getStroke } from 'perfect-freehand';
import type { Background, DiagramObject, InkProfile, Stroke } from '../domain/entities';

function colorRgb(color: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(color) || /^#([0-9a-f]{3})$/i.exec(color);
  if (!match) return [0, 0, 0];
  const hex = match[1].length === 3 ? match[1].split('').map((c) => c + c).join('') : match[1];
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number];
}

function number(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3).replace(/\.?(0+)$/, '') : '0';
}

function setStrokeColor(color: string): string {
  const [r, g, b] = colorRgb(color);
  return `${number(r)} ${number(g)} ${number(b)} RG`;
}

function setFillColor(color: string): string {
  const [r, g, b] = colorRgb(color);
  return `${number(r)} ${number(g)} ${number(b)} rg`;
}

function boundsOf(strokes: Stroke[], objects: DiagramObject[]): { x: number; y: number; width: number; height: number } {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const stroke of strokes) {
    for (const point of stroke.points) {
      left = Math.min(left, point[0] - stroke.size / 2);
      top = Math.min(top, point[1] - stroke.size / 2);
      right = Math.max(right, point[0] + stroke.size / 2);
      bottom = Math.max(bottom, point[1] + stroke.size / 2);
    }
  }
  for (const object of objects) {
    const x2 = object.x + object.width;
    const y2 = object.y + object.height;
    left = Math.min(left, object.x, x2);
    top = Math.min(top, object.y, y2);
    right = Math.max(right, object.x, x2);
    bottom = Math.max(bottom, object.y, y2);
  }
  if (!Number.isFinite(left)) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  const k = 0.5522848;
  return `${number(cx + rx)} ${number(cy)} m ` +
    `${number(cx + rx)} ${number(cy + k * ry)} ${number(cx + k * rx)} ${number(cy + ry)} ${number(cx)} ${number(cy + ry)} c ` +
    `${number(cx - k * rx)} ${number(cy + ry)} ${number(cx - rx)} ${number(cy + k * ry)} ${number(cx - rx)} ${number(cy)} c ` +
    `${number(cx - rx)} ${number(cy - k * ry)} ${number(cx - k * rx)} ${number(cy - ry)} ${number(cx)} ${number(cy - ry)} c ` +
    `${number(cx + k * rx)} ${number(cy - ry)} ${number(cx + rx)} ${number(cy - k * ry)} ${number(cx + rx)} ${number(cy)} c h`;
}

function shapeCommands(object: DiagramObject): string[] {
  const x2 = object.x + object.width;
  const y2 = object.y + object.height;
  const commands = [setStrokeColor(object.color), `${number(object.size)} w`, '1 J', '1 j'];
  if (object.lineStyle === 'dashed') commands.push('[8 6] 0 d');
  else if (object.lineStyle === 'dotted') commands.push('[1 5] 0 d');
  else commands.push('[] 0 d');
  if (object.kind === 'rectangle') {
    commands.push(`${number(Math.min(object.x, x2))} ${number(Math.min(object.y, y2))} ${number(Math.abs(object.width))} ${number(Math.abs(object.height))} re S`);
  } else if (object.kind === 'ellipse') {
    commands.push(`${ellipsePath((object.x + x2) / 2, (object.y + y2) / 2, Math.abs(object.width / 2), Math.abs(object.height / 2))} S`);
  } else {
    commands.push(`${number(object.x)} ${number(object.y)} m ${number(x2)} ${number(y2)} l S`);
    if (object.kind === 'arrow') {
      const angle = Math.atan2(object.height, object.width);
      const length = Math.max(8, object.size * 4);
      commands.push(`${number(x2)} ${number(y2)} m ${number(x2 - length * Math.cos(angle - Math.PI / 6))} ${number(y2 - length * Math.sin(angle - Math.PI / 6))} l S`);
      commands.push(`${number(x2)} ${number(y2)} m ${number(x2 - length * Math.cos(angle + Math.PI / 6))} ${number(y2 - length * Math.sin(angle + Math.PI / 6))} l S`);
    }
  }
  return commands;
}

export function exportPdf(
  strokes: Stroke[],
  background: Background,
  inkProfile: InkProfile | undefined,
  objects: DiagramObject[] = [],
): string {
  const bounds = boundsOf(strokes, objects);
  const padding = 20;
  const pageWidth = bounds.width + padding * 2;
  const pageHeight = bounds.height + padding * 2;
  const commands: string[] = [
    'q',
    `1 0 0 -1 ${number(-bounds.x + padding)} ${number(pageHeight + bounds.y - padding)} cm`,
  ];
  if (background.color && background.color !== 'transparent') {
    commands.push(setFillColor(background.color), `${number(bounds.x - padding)} ${number(bounds.y - padding)} ${number(pageWidth)} ${number(pageHeight)} re f`);
  }
  if (background.grid) {
    const grid = Math.max(8, background.gridSize || 24);
    commands.push(setStrokeColor(background.gridColor || '#9aa4b2'), '0.4 w', '[] 0 d');
    const firstX = Math.floor((bounds.x - padding) / grid) * grid;
    const firstY = Math.floor((bounds.y - padding) / grid) * grid;
    for (let x = firstX; x <= bounds.x + bounds.width + padding; x += grid) commands.push(`${number(x)} ${number(bounds.y - padding)} m ${number(x)} ${number(bounds.y + bounds.height + padding)} l S`);
    for (let y = firstY; y <= bounds.y + bounds.height + padding; y += grid) commands.push(`${number(bounds.x - padding)} ${number(y)} m ${number(bounds.x + bounds.width + padding)} ${number(y)} l S`);
  }
  for (const stroke of strokes) {
    const outline = getStroke(stroke.points, {
      size: stroke.size,
      smoothing: inkProfile?.smoothing ?? 0,
      streamline: inkProfile?.streamline ?? 0,
      thinning: inkProfile?.thinning ?? 0,
      simulatePressure: inkProfile?.simulatePressure ?? false,
    });
    if (outline.length < 3) continue;
    commands.push(setFillColor(stroke.color), `${outline.map((point, index) => `${number(point[0])} ${number(point[1])} ${index === 0 ? 'm' : 'l'}`).join(' ')} h f`);
  }
  for (const object of objects) commands.push(...shapeCommands(object));
  commands.push('Q');
  const stream = commands.join('\n');
  const objectsPdf = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(pageWidth)} ${number(pageHeight)}] /Contents 4 0 R /Resources << >> >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let index = 0; index < objectsPdf.length; index++) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${objectsPdf[index]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objectsPdf.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index++) pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objectsPdf.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}
