export type AvailabilitySocialFormat = "story" | "square";
export type AvailabilitySocialTemplate = "classic" | "modern" | "premium";

export type AvailabilitySocialImageInput = {
  format: AvailabilitySocialFormat;
  template: AvailabilitySocialTemplate;
  businessName: string;
  logoUrl: string;
  title: string;
  dateLabel: string;
  serviceName: string;
  professionalName: string;
  slots: string[];
  bookingLabel: string;
};

export type AvailabilitySocialRect = { x: number; y: number; width: number; height: number };

export type AvailabilitySocialImageLayout = {
  safeArea: AvailabilitySocialRect;
  header: AvailabilitySocialRect;
  title: AvailabilitySocialRect;
  meta: AvailabilitySocialRect;
  slots: AvailabilitySocialRect;
  linkSticker?: AvailabilitySocialRect;
  footer: AvailabilitySocialRect;
  slotRects: AvailabilitySocialRect[];
};

export const AVAILABILITY_SOCIAL_FORMATS = {
  story: { width: 1080, height: 1920, label: "Story vertical", detail: "1080 × 1920 px" },
  square: { width: 1080, height: 1080, label: "Publicação quadrada", detail: "1080 × 1080 px" },
} as const;

export const AVAILABILITY_SOCIAL_TEMPLATES = {
  classic: { label: "Clássico", description: "Elegante e minimalista" },
  modern: { label: "Moderno", description: "Maior destaque para os horários" },
  premium: { label: "Premium", description: "Composição editorial e sofisticada" },
} as const;

const COLORS = {
  ink: "#090909",
  charcoal: "#151515",
  gold: "#D4AF37",
  goldLight: "#F0D67A",
  cream: "#F7F2E8",
  muted: "#C8C1B3",
  red: "#8D1E2D",
};

const FORMAT_LAYOUTS: Record<AvailabilitySocialFormat, Omit<AvailabilitySocialImageLayout, "slotRects">> = {
  story: {
    safeArea: { x: 60, y: 200, width: 960, height: 1460 },
    header: { x: 110, y: 220, width: 860, height: 180 },
    title: { x: 110, y: 420, width: 860, height: 155 },
    meta: { x: 120, y: 590, width: 840, height: 110 },
    slots: { x: 110, y: 720, width: 860, height: 510 },
    linkSticker: { x: 180, y: 1260, width: 720, height: 140 },
    footer: { x: 110, y: 1430, width: 860, height: 210 },
  },
  square: {
    safeArea: { x: 50, y: 50, width: 980, height: 980 },
    header: { x: 80, y: 65, width: 920, height: 145 },
    title: { x: 85, y: 225, width: 910, height: 145 },
    meta: { x: 95, y: 390, width: 890, height: 105 },
    slots: { x: 95, y: 515, width: 890, height: 315 },
    footer: { x: 95, y: 855, width: 890, height: 160 },
  },
};

const renderEpochs = new WeakMap<HTMLCanvasElement, number>();
const imageCache = new Map<string, Promise<HTMLImageElement>>();

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function drawTrackingText(context: CanvasRenderingContext2D, value: string, x: number, y: number, tracking: number) {
  const characters = Array.from(value);
  const widths = characters.map((character) => context.measureText(character).width);
  const totalWidth = widths.reduce((total, width) => total + width, 0) + tracking * Math.max(0, characters.length - 1);
  let cursor = x - totalWidth / 2;
  characters.forEach((character, index) => {
    context.fillText(character, cursor, y);
    cursor += widths[index] + tracking;
  });
}

function ellipsizeText(context: CanvasRenderingContext2D, value: string, maxWidth: number) {
  if (context.measureText(value).width <= maxWidth) return value;
  let candidate = value.trim();
  while (candidate.length > 1 && context.measureText(`${candidate}…`).width > maxWidth) candidate = candidate.slice(0, -1).trimEnd();
  return `${candidate}…`;
}

function wrapText(context: CanvasRenderingContext2D, value: string, maxWidth: number, maxLines: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let consumedWords = 0;
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (context.measureText(next).width <= maxWidth || !current) {
      current = next;
      consumedWords += 1;
      continue;
    }
    lines.push(ellipsizeText(context, current, maxWidth));
    if (lines.length === maxLines) break;
    current = word;
    consumedWords += 1;
  }
  if (current && lines.length < maxLines) lines.push(ellipsizeText(context, current, maxWidth));
  if (consumedWords < words.length && lines.length > 0) {
    lines[lines.length - 1] = ellipsizeText(context, `${lines[lines.length - 1].replace(/…$/, "")}…`, maxWidth);
  }
  return lines.slice(0, maxLines);
}

function drawWrappedTextInRect(
  context: CanvasRenderingContext2D,
  value: string,
  rect: AvailabilitySocialRect,
  lineHeight: number,
  maxLines: number,
  align: CanvasTextAlign,
) {
  const lines = wrapText(context, value, rect.width, maxLines);
  const firstBaseline = rect.y + rect.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  context.textAlign = align;
  context.textBaseline = "middle";
  const x = align === "left" ? rect.x : align === "right" ? rect.x + rect.width : rect.x + rect.width / 2;
  lines.forEach((line, index) => context.fillText(line, x, firstBaseline + index * lineHeight));
  return lines.length;
}

function loadImage(source: string) {
  if (!source) return Promise.reject(new Error("Sem logótipo configurado."));
  const cached = imageCache.get(source);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Não foi possível carregar o logótipo."));
    image.src = source;
  }).catch((error) => {
    imageCache.delete(source);
    throw error;
  });
  imageCache.set(source, promise);
  return promise;
}

async function ensureCanvasFonts() {
  if (!document.fonts) return;
  await Promise.allSettled([
    document.fonts.load('800 96px "DM Sans"'),
    document.fonts.load('700 82px "Playfair Display"'),
    document.fonts.load('500 32px "DM Sans"'),
  ]);
  await document.fonts.ready;
}

async function drawLogo(
  context: CanvasRenderingContext2D,
  source: string,
  centerX: number,
  centerY: number,
  size: number,
  fallbackName: string,
) {
  context.save();
  context.beginPath();
  context.arc(centerX, centerY, size / 2, 0, Math.PI * 2);
  context.closePath();
  context.clip();
  context.fillStyle = COLORS.cream;
  context.fillRect(centerX - size / 2, centerY - size / 2, size, size);
  try {
    const image = await loadImage(source);
    const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, centerX - width / 2, centerY - height / 2, width, height);
  } catch {
    context.fillStyle = COLORS.ink;
    context.font = `700 ${Math.round(size * 0.45)}px "DM Sans", Arial, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(fallbackName.trim().charAt(0).toUpperCase() || "B", centerX, centerY + size * 0.02);
  }
  context.restore();
  context.save();
  context.strokeStyle = COLORS.gold;
  context.lineWidth = Math.max(4, size * 0.04);
  context.beginPath();
  context.arc(centerX, centerY, size / 2 + context.lineWidth / 2, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawNoisePattern(context: CanvasRenderingContext2D, width: number, height: number) {
  context.save();
  context.globalAlpha = 0.045;
  context.fillStyle = COLORS.cream;
  for (let y = 0; y < height; y += 34) {
    for (let x = (y / 34) % 2 === 0 ? 0 : 17; x < width; x += 34) context.fillRect(x, y, 2, 2);
  }
  context.restore();
}

function drawClassicBackground(context: CanvasRenderingContext2D, width: number, height: number) {
  context.fillStyle = COLORS.ink;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = COLORS.gold;
  context.lineWidth = 4;
  context.strokeRect(42, 42, width - 84, height - 84);
  context.strokeStyle = "rgba(212, 175, 55, 0.35)";
  context.lineWidth = 1;
  context.strokeRect(60, 60, width - 120, height - 120);
  drawNoisePattern(context, width, height);
}

function drawModernBackground(context: CanvasRenderingContext2D, width: number, height: number) {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#080808");
  gradient.addColorStop(0.56, "#171717");
  gradient.addColorStop(1, "#241015");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.fillStyle = COLORS.red;
  context.beginPath();
  context.moveTo(width * 0.7, 0);
  context.lineTo(width, 0);
  context.lineTo(width, height * 0.43);
  context.closePath();
  context.fill();
  context.fillStyle = "rgba(212, 175, 55, 0.12)";
  context.beginPath();
  context.moveTo(0, height * 0.82);
  context.lineTo(width, height * 0.61);
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  context.fill();
}

function drawPremiumBackground(context: CanvasRenderingContext2D, width: number, height: number) {
  const gradient = context.createRadialGradient(width * 0.52, height * 0.32, 60, width * 0.5, height * 0.45, height * 0.82);
  gradient.addColorStop(0, "#2A2416");
  gradient.addColorStop(0.36, "#12110D");
  gradient.addColorStop(1, "#050505");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(240, 214, 122, 0.2)";
  context.lineWidth = 2;
  for (let inset = 44; inset <= 76; inset += 16) {
    roundedRect(context, inset, inset, width - inset * 2, height - inset * 2, 28);
    context.stroke();
  }
  drawNoisePattern(context, width, height);
}

function getSlotRects(format: AvailabilitySocialFormat, slotCount: number, region: AvailabilitySocialRect) {
  const count = Math.max(0, Math.min(8, slotCount));
  if (count === 0) return [];
  const isStory = format === "story";
  const labelSpace = isStory ? 72 : 48;
  const grid: AvailabilitySocialRect = {
    x: region.x + (isStory ? 18 : 12),
    y: region.y + labelSpace,
    width: region.width - (isStory ? 36 : 24),
    height: region.height - labelSpace,
  };
  const columns = count === 1 ? 1 : 2;
  const rows = Math.ceil(count / columns);
  const gapX = isStory ? 28 : 20;
  const gapY = isStory ? 26 : 14;
  const naturalWidth = (grid.width - gapX * (columns - 1)) / columns;
  const slotWidth = columns === 1 ? Math.min(naturalWidth, isStory ? 650 : 570) : naturalWidth;
  const maxHeight = isStory
    ? (count === 1 ? 240 : count === 2 ? 190 : 138)
    : (count === 1 ? 150 : count === 2 ? 122 : 70);
  const slotHeight = Math.min(maxHeight, (grid.height - gapY * (rows - 1)) / rows);
  const totalHeight = slotHeight * rows + gapY * (rows - 1);
  const firstY = grid.y + (grid.height - totalHeight) / 2;
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const itemsInRow = Math.min(columns, count - row * columns);
    const rowWidth = slotWidth * itemsInRow + gapX * Math.max(0, itemsInRow - 1);
    const rowX = grid.x + (grid.width - rowWidth) / 2;
    return { x: rowX + column * (slotWidth + gapX), y: firstY + row * (slotHeight + gapY), width: slotWidth, height: slotHeight };
  });
}

export function getAvailabilitySocialImageLayout(format: AvailabilitySocialFormat, slotCount: number): AvailabilitySocialImageLayout {
  const base = FORMAT_LAYOUTS[format];
  return {
    safeArea: { ...base.safeArea }, header: { ...base.header }, title: { ...base.title }, meta: { ...base.meta },
    slots: { ...base.slots },
    ...(base.linkSticker ? { linkSticker: { ...base.linkSticker } } : {}),
    footer: { ...base.footer }, slotRects: getSlotRects(format, slotCount, base.slots),
  };
}

function drawHeader(context: CanvasRenderingContext2D, input: AvailabilitySocialImageInput, layout: AvailabilitySocialImageLayout) {
  const isStory = input.format === "story";
  const modern = input.template === "modern";
  const logoSize = modern ? (isStory ? 128 : 88) : (isStory ? 125 : 98);
  const logoX = modern ? layout.header.x + logoSize / 2 + 8 : layout.header.x + layout.header.width / 2;
  const logoY = modern ? layout.header.y + layout.header.height / 2 : layout.header.y + logoSize / 2 + 4;
  return drawLogo(context, input.logoUrl, logoX, logoY, logoSize, input.businessName).then(() => {
    context.fillStyle = modern ? COLORS.cream : COLORS.goldLight;
    if (modern) {
      context.font = `800 ${isStory ? 31 : 24}px "DM Sans", Arial, sans-serif`;
      drawWrappedTextInRect(context, input.businessName.toUpperCase(), {
        x: layout.header.x + logoSize + 38, y: layout.header.y + 20,
        width: layout.header.width - logoSize - 54, height: layout.header.height - 40,
      }, isStory ? 40 : 31, 2, "left");
      return;
    }
    context.font = `700 ${isStory ? 25 : 20}px "DM Sans", Arial, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    const brand = ellipsizeText(context, input.businessName.toUpperCase(), layout.header.width - 80);
    drawTrackingText(context, brand, layout.header.x + layout.header.width / 2, layout.header.y + layout.header.height - (isStory ? 10 : 12), isStory ? 4.5 : 3.2);
  });
}

function drawTitleAndMeta(context: CanvasRenderingContext2D, input: AvailabilitySocialImageInput, layout: AvailabilitySocialImageLayout) {
  const isStory = input.format === "story";
  const modern = input.template === "modern";
  context.fillStyle = COLORS.cream;
  context.font = `700 ${isStory ? 78 : 54}px "Playfair Display", Georgia, serif`;
  drawWrappedTextInRect(context, input.title, layout.title, isStory ? 88 : 62, 2, modern ? "left" : "center");
  if (input.template === "premium") {
    const centerX = layout.meta.x + layout.meta.width / 2;
    context.strokeStyle = "rgba(240, 214, 122, 0.55)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(centerX - (isStory ? 310 : 330), layout.meta.y + 4);
    context.lineTo(centerX - (isStory ? 80 : 70), layout.meta.y + 4);
    context.moveTo(centerX + (isStory ? 80 : 70), layout.meta.y + 4);
    context.lineTo(centerX + (isStory ? 310 : 330), layout.meta.y + 4);
    context.stroke();
    context.fillStyle = COLORS.gold;
    context.beginPath();
    context.arc(centerX, layout.meta.y + 4, 5, 0, Math.PI * 2);
    context.fill();
  }
  const textX = modern ? layout.meta.x : layout.meta.x + layout.meta.width / 2;
  context.textAlign = modern ? "left" : "center";
  context.textBaseline = "middle";
  context.fillStyle = COLORS.goldLight;
  context.font = `800 ${isStory ? 32 : 25}px "DM Sans", Arial, sans-serif`;
  context.fillText(ellipsizeText(context, input.dateLabel.toUpperCase(), layout.meta.width), textX, layout.meta.y + (isStory ? 40 : 30));
  context.fillStyle = "rgba(247, 242, 232, 0.82)";
  context.font = `500 ${isStory ? 27 : 22}px "DM Sans", Arial, sans-serif`;
  context.fillText(ellipsizeText(context, `${input.serviceName} · ${input.professionalName}`, layout.meta.width), textX, layout.meta.y + (isStory ? 94 : 75));
}

function drawSlots(context: CanvasRenderingContext2D, input: AvailabilitySocialImageInput, layout: AvailabilitySocialImageLayout) {
  const { width } = AVAILABILITY_SOCIAL_FORMATS[input.format];
  const isStory = input.format === "story";
  const slots = input.slots.slice(0, 8);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = input.template === "modern" ? COLORS.cream : COLORS.goldLight;
  context.font = `800 ${isStory ? 24 : 19}px "DM Sans", Arial, sans-serif`;
  drawTrackingText(context, slots.length === 1 ? "HORÁRIO EM DESTAQUE" : "HORÁRIOS DISPONÍVEIS", width / 2, layout.slots.y + (isStory ? 28 : 20), isStory ? 3.2 : 2.4);
  if (slots.length === 0) {
    context.fillStyle = COLORS.muted;
    context.font = `600 ${isStory ? 42 : 34}px "DM Sans", Arial, sans-serif`;
    context.fillText("Selecione os horários a divulgar", width / 2, layout.slots.y + layout.slots.height / 2);
    return;
  }
  layout.slotRects.forEach((rect, index) => {
    const slot = slots[index];
    context.save();
    roundedRect(context, rect.x, rect.y, rect.width, rect.height, input.template === "modern" ? 20 : rect.height / 2);
    if (input.template === "classic") {
      context.fillStyle = "rgba(255,255,255,0.025)";
      context.strokeStyle = COLORS.gold;
      context.lineWidth = 3;
      context.fill(); context.stroke();
    } else if (input.template === "modern") {
      context.fillStyle = index % 2 === 0 ? COLORS.cream : COLORS.gold;
      context.fill();
      context.fillStyle = "rgba(0,0,0,0.08)";
      context.fillRect(rect.x, rect.y + rect.height - 7, rect.width, 7);
    } else {
      const gradient = context.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
      gradient.addColorStop(0, "rgba(240, 214, 122, 0.22)");
      gradient.addColorStop(1, "rgba(255,255,255,0.035)");
      context.fillStyle = gradient;
      context.strokeStyle = "rgba(240, 214, 122, 0.68)";
      context.lineWidth = 2;
      context.fill(); context.stroke();
    }
    context.fillStyle = input.template === "modern" ? COLORS.ink : COLORS.cream;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `800 ${Math.min(isStory ? 72 : 48, Math.round(rect.height * (isStory ? 0.52 : 0.64)))}px "DM Sans", Arial, sans-serif`;
    context.fillText(slot, rect.x + rect.width / 2, rect.y + rect.height / 2 + 1);
    context.restore();
  });
  if (slots.length === 1) {
    const rect = layout.slotRects[0];
    context.fillStyle = "rgba(247, 242, 232, 0.68)";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `600 ${isStory ? 22 : 17}px "DM Sans", Arial, sans-serif`;
    context.fillText("RESERVA ESTE HORÁRIO ANTES QUE FIQUE INDISPONÍVEL", width / 2, rect.y + rect.height + (isStory ? 55 : 30));
  }
}

function drawLinkStickerPlacement(context: CanvasRenderingContext2D, input: AvailabilitySocialImageInput, layout: AvailabilitySocialImageLayout) {
  const rect = layout.linkSticker;
  if (input.format !== "story" || !rect) return;
  context.save();
  roundedRect(context, rect.x, rect.y, rect.width, rect.height, 28);
  context.fillStyle = input.template === "modern"
    ? "rgba(141, 30, 45, 0.3)"
    : input.template === "premium"
      ? "rgba(240, 214, 122, 0.08)"
      : "rgba(212, 175, 55, 0.06)";
  context.fill();
  context.strokeStyle = input.template === "modern" ? "rgba(247, 242, 232, 0.8)" : "rgba(240, 214, 122, 0.72)";
  context.lineWidth = 3;
  context.setLineDash([16, 12]);
  context.stroke();
  context.setLineDash([]);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = input.template === "modern" ? COLORS.cream : COLORS.goldLight;
  context.font = '800 27px "DM Sans", Arial, sans-serif';
  context.fillText("ZONA PARA O STICKER «LIGAÇÃO»", rect.x + rect.width / 2, rect.y + 52);
  context.fillStyle = "rgba(247, 242, 232, 0.72)";
  context.font = '500 21px "DM Sans", Arial, sans-serif';
  context.fillText("Coloca aqui o sticker no Instagram", rect.x + rect.width / 2, rect.y + 96);
  context.restore();
}

function drawFooter(context: CanvasRenderingContext2D, input: AvailabilitySocialImageInput, layout: AvailabilitySocialImageLayout) {
  const isStory = input.format === "story";
  const centerX = layout.footer.x + layout.footer.width / 2;
  if (input.template === "modern") {
    roundedRect(context, layout.footer.x + 35, layout.footer.y + 8, layout.footer.width - 70, isStory ? 145 : 100, 24);
    context.fillStyle = COLORS.red;
    context.fill();
  } else {
    context.strokeStyle = input.template === "classic" ? "rgba(212, 175, 55, 0.55)" : "rgba(240, 214, 122, 0.72)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(layout.footer.x + 100, layout.footer.y + 8);
    context.lineTo(layout.footer.x + layout.footer.width - 100, layout.footer.y + 8);
    context.stroke();
  }
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = COLORS.cream;
  context.font = `800 ${isStory ? 48 : 35}px "DM Sans", Arial, sans-serif`;
  context.fillText("MARCA JÁ", centerX, layout.footer.y + (isStory ? 63 : 43));
  context.fillStyle = COLORS.goldLight;
  context.font = `600 ${isStory ? 32 : 27}px "DM Sans", Arial, sans-serif`;
  context.fillText(ellipsizeText(context, input.bookingLabel, layout.footer.width - 100), centerX, layout.footer.y + (isStory ? 125 : 83));
  context.fillStyle = "rgba(247, 242, 232, 0.72)";
  context.font = `500 ${isStory ? 23 : 19}px "DM Sans", Arial, sans-serif`;
  context.fillText("Horários sujeitos a disponibilidade no momento da marcação.", centerX, layout.footer.y + (isStory ? 205 : 133));
}

export function getAvailabilitySocialImageDimensions(format: AvailabilitySocialFormat) {
  return AVAILABILITY_SOCIAL_FORMATS[format];
}

export function sanitizeAvailabilitySocialFileName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "estabelecimento";
}

export async function renderAvailabilitySocialImage(canvas: HTMLCanvasElement, input: AvailabilitySocialImageInput) {
  const epoch = (renderEpochs.get(canvas) ?? 0) + 1;
  renderEpochs.set(canvas, epoch);
  const dimensions = AVAILABILITY_SOCIAL_FORMATS[input.format];
  const surface = document.createElement("canvas");
  surface.width = dimensions.width;
  surface.height = dimensions.height;
  const context = surface.getContext("2d");
  if (!context) throw new Error("O navegador não permite gerar esta imagem.");
  // Intrinsic dimensions are the final export pixels. CSS alone scales the preview.
  await ensureCanvasFonts();
  context.clearRect(0, 0, dimensions.width, dimensions.height);
  if (input.template === "classic") drawClassicBackground(context, dimensions.width, dimensions.height);
  if (input.template === "modern") drawModernBackground(context, dimensions.width, dimensions.height);
  if (input.template === "premium") drawPremiumBackground(context, dimensions.width, dimensions.height);
  const layout = getAvailabilitySocialImageLayout(input.format, input.slots.length);
  await drawHeader(context, input, layout);
  drawTitleAndMeta(context, input, layout);
  drawSlots(context, input, layout);
  drawLinkStickerPlacement(context, input, layout);
  drawFooter(context, input, layout);
  // Fonts and the logo make drawing asynchronous. Only the newest request commits.
  if (renderEpochs.get(canvas) !== epoch) return false;
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const output = canvas.getContext("2d");
  if (!output) throw new Error("O navegador não permite apresentar esta imagem.");
  output.clearRect(0, 0, dimensions.width, dimensions.height);
  output.drawImage(surface, 0, 0);
  return true;
}

export function availabilityCanvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Não foi possível exportar a imagem.")), "image/png", 1);
  });
}
