import { z } from 'zod';
import { insertBarberSchema, insertServiceSchema, insertAppointmentSchema, appointmentStatuses, barbers, services, appointments } from './schema';

export type CreateBarberRequest = z.infer<typeof insertBarberSchema>;
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
  })
};

// ============================================
// API CONTRACT
// ============================================
export const api = {
  barbers: {
    list: {
      method: 'GET' as const,
      path: '/api/barbers',
      responses: {
        200: z.array(z.custom<typeof barbers.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/barbers/:id',
      responses: {
        200: z.custom<typeof barbers.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: { // For admin/seed
      method: 'POST' as const,
      path: '/api/barbers',
      input: insertBarberSchema,
      responses: {
        201: z.custom<typeof barbers.$inferSelect>(),
        400: errorSchemas.validation,
      },
    }
  },
  services: {
    list: {
      method: 'GET' as const,
      path: '/api/services',
      responses: {
        200: z.array(z.custom<typeof services.$inferSelect>()),
      },
    },
    create: { // For admin/seed
      method: 'POST' as const,
      path: '/api/services',
      input: insertServiceSchema,
      responses: {
        201: z.custom<typeof services.$inferSelect>(),
        400: errorSchemas.validation,
      },
    }
  },
  appointments: {
    list: {
      method: 'GET' as const,
      path: '/api/appointments',
      input: z.object({
        barberId: z.string().optional(),
        date: z.string().optional(), // ISO date string YYYY-MM-DD
      }).optional(),
      responses: {
        200: z.array(z.custom<typeof appointments.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/appointments',
      input: insertAppointmentSchema,
      responses: {
        201: z.custom<typeof appointments.$inferSelect>(),
        400: errorSchemas.validation,
        409: errorSchemas.conflict, // Slot taken
      },
    },
    updateStatus: {
      method: 'PATCH' as const,
      path: '/api/appointments/:id/status',
      input: z.object({ status: z.enum(appointmentStatuses) }),
      responses: {
        200: z.custom<typeof appointments.$inferSelect>(),
        404: errorSchemas.notFound,
      }
    },
    cancel: {
      method: 'POST' as const,
      path: '/api/appointments/cancel/:token',
      responses: {
        200: z.object({ message: z.string() }),
        404: errorSchemas.notFound,
      }
    }
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
