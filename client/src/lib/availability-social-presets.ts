import type {
  AvailabilitySocialScheduleLayout,
  AvailabilitySocialTemplate,
  AvailabilitySocialVisualSettings,
} from "@/lib/availability-social-image";

export type AvailabilitySocialPreset = {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  settings: AvailabilitySocialVisualSettings;
};

const STORAGE_KEY = "barberbookings:availability-social-presets:v1";
const DATABASE_NAME = "barberbookings-availability-social-assets";
const DATABASE_VERSION = 1;
const OBJECT_STORE = "backgrounds";
const MAX_PRESETS = 20;
export const MAX_BACKGROUND_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_OPTIMIZED_BACKGROUND_BYTES = 2.5 * 1024 * 1024;

const validTemplates = new Set<AvailabilitySocialTemplate>(["classic", "modern", "premium"]);
const validLayouts = new Set<AvailabilitySocialScheduleLayout>(["balanced", "compact", "stacked"]);

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function clamp(value: unknown, minimum: number, maximum: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

export function createDefaultAvailabilitySocialSettings(
  template: AvailabilitySocialTemplate = "classic",
): AvailabilitySocialVisualSettings {
  return {
    template,
    accentColor: "#D4AF37",
    secondaryColor: "#8D1E2D",
    overlayOpacity: 0.62,
    scheduleLayout: "balanced",
    backgroundImageId: null,
    backgroundImageName: null,
    backgroundPositionX: 50,
    backgroundPositionY: 50,
    backgroundZoom: 1,
  };
}

export function normalizeAvailabilitySocialSettings(value: unknown): AvailabilitySocialVisualSettings {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const template = validTemplates.has(record.template as AvailabilitySocialTemplate)
    ? record.template as AvailabilitySocialTemplate
    : "classic";
  return {
    template,
    accentColor: isHexColor(record.accentColor) ? record.accentColor.toUpperCase() : "#D4AF37",
    secondaryColor: isHexColor(record.secondaryColor) ? record.secondaryColor.toUpperCase() : "#8D1E2D",
    overlayOpacity: clamp(record.overlayOpacity, 0.45, 0.85, 0.62),
    scheduleLayout: validLayouts.has(record.scheduleLayout as AvailabilitySocialScheduleLayout)
      ? record.scheduleLayout as AvailabilitySocialScheduleLayout
      : "balanced",
    backgroundImageId: typeof record.backgroundImageId === "string" && record.backgroundImageId ? record.backgroundImageId : null,
    backgroundImageName: typeof record.backgroundImageName === "string" && record.backgroundImageName
      ? record.backgroundImageName.slice(0, 120)
      : null,
    backgroundPositionX: clamp(record.backgroundPositionX, 0, 100, 50),
    backgroundPositionY: clamp(record.backgroundPositionY, 0, 100, 50),
    backgroundZoom: clamp(record.backgroundZoom, 1, 1.8, 1),
  };
}

export function loadAvailabilitySocialPresets(): AvailabilitySocialPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_PRESETS).flatMap((item): AvailabilitySocialPreset[] => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      if (typeof record.id !== "string" || typeof record.name !== "string") return [];
      return [{
        id: record.id,
        name: record.name.trim().slice(0, 50) || "Modelo sem nome",
        isDefault: record.isDefault === true,
        createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
        updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
        settings: normalizeAvailabilitySocialSettings(record.settings),
      }];
    });
  } catch {
    return [];
  }
}

export function persistAvailabilitySocialPresets(presets: AvailabilitySocialPreset[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets.slice(0, MAX_PRESETS)));
}

export function createAvailabilitySocialPreset(
  name: string,
  settings: AvailabilitySocialVisualSettings,
  current: AvailabilitySocialPreset[],
) {
  if (current.length >= MAX_PRESETS) throw new Error(`Pode guardar até ${MAX_PRESETS} modelos neste dispositivo.`);
  const now = new Date().toISOString();
  return {
    id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: name.trim().slice(0, 50),
    isDefault: current.length === 0,
    createdAt: now,
    updatedAt: now,
    settings: normalizeAvailabilitySocialSettings(settings),
  } satisfies AvailabilitySocialPreset;
}

function openBackgroundDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Este navegador não permite guardar imagens localmente."));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OBJECT_STORE)) request.result.createObjectStore(OBJECT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir o armazenamento local."));
  });
}

async function runBackgroundTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await openBackgroundDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, mode);
      const request = operation(transaction.objectStore(OBJECT_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Não foi possível aceder à imagem guardada."));
      transaction.onabort = () => reject(transaction.error ?? new Error("A operação de armazenamento foi cancelada."));
    });
  } finally {
    database.close();
  }
}

export async function saveAvailabilitySocialBackground(id: string, blob: Blob) {
  await runBackgroundTransaction("readwrite", (store) => store.put(blob, id));
}

export async function loadAvailabilitySocialBackground(id: string) {
  return runBackgroundTransaction<Blob | undefined>("readonly", (store) => store.get(id));
}

export async function deleteAvailabilitySocialBackground(id: string) {
  await runBackgroundTransaction("readwrite", (store) => store.delete(id));
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Não foi possível otimizar a imagem.")),
      type,
      quality,
    );
  });
}

export async function optimizeAvailabilitySocialBackground(file: File) {
  if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type)) {
    throw new Error("Escolha uma imagem JPG, PNG ou WebP.");
  }
  if (file.size > MAX_BACKGROUND_FILE_BYTES) throw new Error("A imagem original não pode exceder 10 MB.");

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = sourceUrl;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("A imagem não tem dimensões válidas.");
    if (image.naturalWidth > 12_000 || image.naturalHeight > 12_000) throw new Error("A imagem tem dimensões demasiado grandes.");

    const scale = Math.min(1, 2160 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("O navegador não permite otimizar a imagem.");
    context.fillStyle = "#090909";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, "image/webp", 0.86);
    if (blob.size > MAX_OPTIMIZED_BACKGROUND_BYTES) throw new Error("A imagem otimizada continua demasiado grande. Escolha outra imagem.");
    return blob;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
