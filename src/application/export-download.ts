import type { Background, DiagramObject, InkProfile, Stroke } from '../domain/entities';
import { exportSvg } from './export-service';

export function downloadSvg(
  strokes: Stroke[],
  objects: DiagramObject[],
  page: Background,
  inkProfile: InkProfile | undefined,
  filename: string,
): void {
  const svg = exportSvg(strokes, page, inkProfile, objects);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = activeDocument.createEl('a', { cls: 'blackboard-export-download' });
  link.href = url;
  link.download = filename.endsWith('.svg') ? filename : `${filename}.svg`;
  activeDocument.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
