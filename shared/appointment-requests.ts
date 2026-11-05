import { z } from "zod";
import { normalizePhoneNumber, supportedPhoneValidationMessage } from "./phone-countries";

export const appointmentRequestSelectionSchema = z.object({
  serviceId: z.number().int().positive(),
  barberId: z.number().int().positive(),
});

export const createAppointmentRequestSchema = z.object({
  startTime: z.coerce.date(),
  customerName: z.string().trim().min(1).max(80),
  customerEmail: z.string().trim().email().max(120).optional().nullable(),
  customerPhone: z.string().trim()
    .refine((value) => Boolean(normalizePhoneNumber(value)), supportedPhoneValidationMessage)
    .transform((value) => normalizePhoneNumber(value)),
  whatsappOptIn: z.boolean().optional().default(false),
  idempotencyKey: z.string().trim().min(8).max(100),
  services: z.array(appointmentRequestSelectionSchema).min(1).max(12),
});

export const appointmentRequestRefusalSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable(),
});

export const appointmentRequestProposalSchema = z.object({
  startTime: z.coerce.date(),
  expiresAt: z.coerce.date(),
  commandKey: z.string().trim().min(8).max(100),
});

export const appointmentRequestProposalResponseSchema = z.object({
  token: z.string().trim().min(32).max(256),
  decision: z.enum(["accept", "reject"]),
});

export const appointmentRequestListQuerySchema = z.object({
  status: z.enum(["pending", "proposed", "approved", "refused"]).optional(),
});

export type CreateAppointmentRequestInput = z.infer<typeof createAppointmentRequestSchema>;
export type AppointmentRequestRefusalInput = z.infer<typeof appointmentRequestRefusalSchema>;
export type AppointmentRequestProposalInput = z.infer<typeof appointmentRequestProposalSchema>;
export type AppointmentRequestProposalResponseInput = z.infer<typeof appointmentRequestProposalResponseSchema>;
