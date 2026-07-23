import { z } from "zod";
import {
  insertBarberSchema,
  insertServiceSchema,
  insertAppointmentSchema,
  appointmentStatuses,
  services,
  appointments,
  barberCompensationModels,
  chairRentPeriods,
  type BarberWithServices,
} from "./schema";

const serviceIdsInputSchema = z.array(z.number().int().positive()).optional();
const compensationModelSchema = z.enum(barberCompensationModels);
const chairRentPeriodSchema = z.enum(chairRentPeriods);

const barberCompensationInputSchema = z.object({
  compensationModel: compensationModelSchema.optional(),
  commissionPercent: z.number().min(0).max(100).nullable().optional(),
  chairRentCents: z.number().int().min(0).nullable().optional(),
  chairRentPeriod: chairRentPeriodSchema.nullable().optional(),
});

const barberProfileInputSchema = insertBarberSchema.extend({
  name: z.string().trim().min(1, "Indique o nome do barbeiro.").max(100, "O nome nao pode ter mais de 100 caracteres."),
  specialty: z.string().trim().min(1, "Indique a especialidade do barbeiro.").max(160, "A especialidade nao pode ter mais de 160 caracteres."),
  bio: z.string().trim().max(1000, "A biografia nao pode ter mais de 1000 caracteres.").optional().nullable(),
  email: z.string().trim().max(120, "O email nao pode ter mais de 120 caracteres.").refine(
    (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    "Indique um email valido.",
  ).optional().nullable(),
  serviceIds: serviceIdsInputSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor invalida. Use formato hexadecimal.").optional(),
});

export const barberInputSchema = barberProfileInputSchema.merge(barberCompensationInputSchema);
export type CreateBarberRequest = z.infer<typeof barberInputSchema>;
export type CreateServiceRequest = z.infer<typeof insertServiceSchema>;
export type CreateAppointmentRequest = z.infer<typeof insertAppointmentSchema>;

// ============================================
// SHARED ERROR SCHEMAS
// ============================================
export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
  conflict: z.object({
    message: z.string(),
  }),
};

// ============================================
// API CONTRACT
// ============================================
export const api = {
  barbers: {
    list: {
      method: "GET" as const,
      path: "/api/barbers",
      responses: {
        200: z.array(z.custom<BarberWithServices>()),
      },
    },
    get: {
      method: "GET" as const,
      path: "/api/barbers/:id",
      responses: {
        200: z.custom<BarberWithServices>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: "POST" as const,
      path: "/api/barbers",
      input: barberInputSchema,
      responses: {
        201: z.custom<BarberWithServices>(),
        400: errorSchemas.validation,
      },
    },
  },
  services: {
    list: {
      method: "GET" as const,
      path: "/api/services",
      responses: {
        200: z.array(z.custom<typeof services.$inferSelect>()),
      },
    },
    create: {
      method: "POST" as const,
      path: "/api/services",
      input: insertServiceSchema,
      responses: {
        201: z.custom<typeof services.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
  },
  appointments: {
    list: {
      method: "GET" as const,
      path: "/api/appointments",
      input: z.object({
        barberId: z.string().optional(),
        date: z.string().optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<typeof appointments.$inferSelect>()),
      },
    },
    create: {
      method: "POST" as const,
      path: "/api/appointments",
      input: insertAppointmentSchema,
      responses: {
        201: z.custom<typeof appointments.$inferSelect>(),
        400: errorSchemas.validation,
        409: errorSchemas.conflict,
      },
    },
    updateStatus: {
      method: "PATCH" as const,
      path: "/api/appointments/:id/status",
      input: z.object({ status: z.enum(appointmentStatuses) }),
      responses: {
        200: z.custom<typeof appointments.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    cancel: {
      method: "POST" as const,
      path: "/api/appointments/cancel/:token",
      responses: {
        200: z.object({ message: z.string() }),
        404: errorSchemas.notFound,
      },
    },
  },
};

// ============================================
// REQUIRED: buildUrl helper
// ============================================
export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
