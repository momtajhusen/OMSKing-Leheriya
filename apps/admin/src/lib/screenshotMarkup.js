/** Drawing helpers for marking up a screenshot before it is sent in the Report chat. Shapes are in image pixels. */
export const MARKUP_TOOLS = [
  { id: 'pen', label: 'Draw' },
  { id: 'box', label: 'Box' },
  { id: 'arrow', label: 'Arrow' },
];

export const MARKUP_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#111827', '#ffffff'];

const MIN_DRAG_PX = 4;

export function strokeWidth(imageWidth) {
  return Math.max(3, Math.round(imageWidth / 300));
}

export function toImagePoint(clientX, clientY, rect, width, height) {
  const clamp = (v, max) => Math.min(max, Math.max(0, v));
  return {
    x: clamp(((clientX - rect.left) / rect.width) * width, width),
    y: clamp(((clientY - rect.top) / rect.height) * height, height),
  };
}

export function arrowHead(from, to, size) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const wing = Math.PI / 6;
  return [
    { x: to.x - size * Math.cos(angle + wing), y: to.y - size * Math.sin(angle + wing) },
    { x: to.x - size * Math.cos(angle - wing), y: to.y - size * Math.sin(angle - wing) },
  ];
}

export function isMeaningful(shape) {
  if (shape.tool === 'pen') return shape.points.length > 0;
  return Math.hypot(shape.to.x - shape.from.x, shape.to.y - shape.from.y) >= MIN_DRAG_PX;
}

export function drawShape(ctx, shape) {
  ctx.save();
  ctx.strokeStyle = shape.color;
  ctx.lineWidth = shape.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (shape.tool === 'pen') {
    const [first, ...rest] = shape.points;
    ctx.moveTo(first.x, first.y);
    (rest.length ? rest : [first]).forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.stroke();
  } else if (shape.tool === 'box') {
    const x = Math.min(shape.from.x, shape.to.x);
    const y = Math.min(shape.from.y, shape.to.y);
    ctx.strokeRect(x, y, Math.abs(shape.to.x - shape.from.x), Math.abs(shape.to.y - shape.from.y));
  } else if (shape.tool === 'arrow') {
    const [left, right] = arrowHead(shape.from, shape.to, shape.width * 4);
    ctx.moveTo(shape.from.x, shape.from.y);
    ctx.lineTo(shape.to.x, shape.to.y);
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(shape.to.x, shape.to.y);
    ctx.moveTo(right.x, right.y);
    ctx.lineTo(shape.to.x, shape.to.y);
    ctx.stroke();
  }
  ctx.restore();
}

export function markedName(name, type = 'image/png') {
  const base = (name || 'screenshot').replace(/\.[^.]+$/, '');
  return `${base}-marked.${type === 'image/jpeg' ? 'jpg' : 'png'}`;
}
