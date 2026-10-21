export const LAST_BOOKING_STORAGE_KEY = "baptista:lastBooking";
export const LAST_BOOKING_RETENTION_DAYS = 30;

const LAST_BOOKING_RETENTION_MS = LAST_BOOKING_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export type LastBookingPreference = {
  barberId: number | null;
  serviceId: number | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
};

type StoredLastBookingPreference = {
  barberId?: unknown;
  serviceId?: unknown;
  customerName?: unknown;
  customerEmail?: unknown;
  customerPhone?: unknown;
  updatedAt?: unknown;
};

type BookingStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function clearStoredPreference(storage: BookingStorage) {
  try {
    storage.removeItem(LAST_BOOKING_STORAGE_KEY);
  } catch {
    // Storage indisponível não deve impedir a marcação.
  }
}

export function readLastBookingPreference(
  storage: BookingStorage,
  now: Date = new Date(),
): LastBookingPreference | null {
  try {
    const raw = storage.getItem(LAST_BOOKING_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as StoredLastBookingPreference;
    const updatedAt = typeof parsed.updatedAt === "string"
      ? Date.parse(parsed.updatedAt)
      : Number.NaN;
    const age = now.getTime() - updatedAt;

    if (!Number.isFinite(updatedAt) || age < 0 || age > LAST_BOOKING_RETENTION_MS) {
      clearStoredPreference(storage);
      return null;
    }

    return {
      barberId: typeof parsed.barberId === "number" ? parsed.barberId : null,
      serviceId: typeof parsed.serviceId === "number" ? parsed.serviceId : null,
      customerName: typeof parsed.customerName === "string" ? parsed.customerName : "",
      customerEmail: typeof parsed.customerEmail === "string" ? parsed.customerEmail : "",
      customerPhone: typeof parsed.customerPhone === "string" ? parsed.customerPhone : "",
    };
  } catch {
    clearStoredPreference(storage);
    return null;
  }
}

export function saveLastBookingPreference(
  storage: BookingStorage,
  preference: {
    barberId: number;
    serviceId: number;
    customerName: string;
    customerEmail?: string;
    customerPhone: string;
  },
  now: Date = new Date(),
) {
  try {
    storage.setItem(
      LAST_BOOKING_STORAGE_KEY,
      JSON.stringify({
        ...preference,
        customerEmail: preference.customerEmail || "",
        updatedAt: now.toISOString(),
      }),
    );
  } catch {
    // Falhas de storage não devem impedir uma marcação confirmada.
  }
}
