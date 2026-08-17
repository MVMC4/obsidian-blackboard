/** Return an RGB triplet for the hex colors used by the drawing model. */
function rgb(color: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(color.trim());
  if (!match) return null;
  const hex = match[1].length === 3
    ? match[1].split('').map((channel) => channel + channel).join('')
    : match[1];
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}

function luminance(color: string): number | null {
  const channels = rgb(color);
  if (!channels) return null;
  const [r, g, b] = channels.map((channel) => channel / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Keep the user's stored color unchanged, but remap pure/light black-and-white ink when
 * the selected paper tone would make it disappear. Accent colors are deliberately left
 * alone so choosing red/blue/etc. remains predictable.
 */
export function readableInkColor(color: string, paperColor: string): string {
  const background = luminance(paperColor);
  const foreground = luminance(color);
  if (background === null || foreground === null) return color;
  if (background >= 0.65 && foreground >= 0.82) return '#000000';
  if (background <= 0.35 && foreground <= 0.18) return '#ffffff';
  return color;
}
