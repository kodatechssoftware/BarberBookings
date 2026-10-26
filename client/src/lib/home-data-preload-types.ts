export type HomeDataPreloadKey = "services" | "barbers" | "availability";

export type HomeDataPreloadResult =
  | { ok: true; data: unknown }
  | { ok: false; status?: number; message: string };

export type HomeDataPreloadState = {
  locationId: number | null;
  requests: Partial<Record<HomeDataPreloadKey, Promise<HomeDataPreloadResult>>>;
};

declare global {
  interface Window {
    __barberBookingsHomeDataPreload?: HomeDataPreloadState;
  }
}

export {};
