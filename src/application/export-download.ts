import type { Background, DiagramObject, InkProfile, Stroke } from '../domain/entities';
import { exportSvg } from './export-service';
import { exportPdf } from './pdf-export';
import type { IDrawingRepository } from '../domain/ports';

export type ExportFormat = 'svg' | 'pdf';

export async function writeExportArtifact(
  repo: IDrawingRepository,
  sourcePath: string,
  strokes: Stroke[],
  objects: DiagramObject[],
  page: Background,
  inkProfile: InkProfile | undefined,
  format: ExportFormat,
  selectionOnly: boolean,
): Promise<string> {
  const source = sourcePath.replace(/\\/g, '/');
  const slash = source.lastIndexOf('/');
  const folder = slash >= 0 ? source.slice(0, slash + 1) : '';
  const basename = (slash >= 0 ? source.slice(slash + 1) : source).replace(/\.[^.]+$/, '');
  const suffix = selectionOnly ? ' - selection' : '';
  const path = `${folder}${basename}${suffix}.${format}`;
  const content = format === 'pdf'
    ? exportPdf(strokes, page, inkProfile, objects)
    : exportSvg(strokes, page, inkProfile, objects);
  await repo.writeRaw(path, content);
  return path;
}

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
