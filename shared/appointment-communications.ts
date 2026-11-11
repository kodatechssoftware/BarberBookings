import { z } from "zod";

export const appointmentManualContactMethodSchema = z.enum(["sms", "phone", "other"]);

export type AppointmentManualContactMethod = z.infer<typeof appointmentManualContactMethodSchema>;

export const appointmentCommunicationEventTypes = [
  "appointment_confirmation",
  "appointment_rescheduled",
  "appointment_updated",
  "appointment_cancelled",
  "appointment_reminder_day_before",
] as const;

export type AppointmentCommunicationEventType = (typeof appointmentCommunicationEventTypes)[number];

export type AppointmentCommunicationFailure = {
  eventId: number;
  eventType: AppointmentCommunicationEventType;
  failedAt: string;
  emailStatus: string;
  emailSentAt: string | null;
  contactedAt: string | null;
  contactedByUserId: number | null;
  contactedByName: string | null;
  contactMethod: AppointmentManualContactMethod | null;
};

export function isPendingAppointmentCommunicationFailure(
  failure: AppointmentCommunicationFailure,
) {
  return failure.contactedAt === null;
}
