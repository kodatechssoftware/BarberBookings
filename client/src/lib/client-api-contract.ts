import type {
  BarberWithServices,
  Service,
  ServiceCatalogueItem,
} from "@shared/schema";
import type { ServiceCategoryWithCount } from "@shared/routes";

type Parser<T> = { parse(value: unknown): T };

function passthroughParser<T>(): Parser<T> {
  return { parse: (value) => value as T };
}

function arrayParser<T>(): Parser<T[]> {
  return {
    parse(value) {
      if (!Array.isArray(value)) {
        throw new TypeError("Expected an array response from the API.");
      }
      return value as T[];
    },
  };
}

// The browser only needs route metadata and the same lightweight response
// guards already provided by z.array(z.custom()). Keeping the server schemas
// out of this module prevents Drizzle and Zod from entering the public bundle.
export const api = {
  barbers: {
    list: {
      method: "GET" as const,
      path: "/api/barbers",
      responses: { 200: arrayParser<BarberWithServices>() },
    },
    get: {
      method: "GET" as const,
      path: "/api/barbers/:id",
      responses: { 200: passthroughParser<BarberWithServices>() },
    },
    create: {
      method: "POST" as const,
      path: "/api/barbers",
      responses: { 201: passthroughParser<BarberWithServices>() },
    },
  },
  services: {
    list: {
      method: "GET" as const,
      path: "/api/services",
      responses: { 200: arrayParser<ServiceCatalogueItem>() },
    },
    create: {
      method: "POST" as const,
      path: "/api/services",
      responses: { 201: passthroughParser<Service>() },
    },
  },
  serviceCategories: {
    list: {
      method: "GET" as const,
      path: "/api/service-categories",
      responses: { 200: arrayParser<ServiceCategoryWithCount>() },
    },
  },
  appointments: {
    list: { method: "GET" as const, path: "/api/appointments" },
    create: { method: "POST" as const, path: "/api/appointments" },
    updateStatus: {
      method: "PATCH" as const,
      path: "/api/appointments/:id/status",
    },
  },
} as const;

export function buildUrl(
  path: string,
  params?: Record<string, string | number>,
): string {
  let url = path;
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url = url.replace(`:${key}`, String(value));
    }
  }
  return url;
}
