import { z } from "zod";

export const adminNotificationTypeSchema = z.enum([
  "new_request",
  "pending_reminder",
  "proposal_accepted",
  "proposal_rejected",
  "proposal_unavailable",
]);

export const adminNotificationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const requestNotificationSettingsSchema = z.object({
  emailEnabled: z.boolean(),
  reminderEnabled: z.boolean(),
  reminderDelayMinutes: z.number().int().min(5).max(1440),
  respectOpeningHours: z.boolean(),
  recipients: z.array(z.object({
    userId: z.number().int().positive(),
    isActive: z.boolean(),
    newRequestEmail: z.boolean(),
    pendingReminderEmail: z.boolean(),
  })).max(50),
});

export type AdminNotificationType = z.infer<typeof adminNotificationTypeSchema>;
export type RequestNotificationSettingsInput = z.infer<typeof requestNotificationSettingsSchema>;

export type AdminNotificationItem = {
  id: number;
  locationId: number;
  requestId: number;
  type: AdminNotificationType;
  customerName: string;
  requestedStartTime: string;
  services: Array<{ name: string; professionalName: string }>;
  availableAt: string;
  createdAt: string;
  readAt: string | null;
};

export type AdminNotificationFeed = {
  items: AdminNotificationItem[];
  unreadCount: number;
  pendingDecisionCount: number;
};

export type RequestNotificationRecipientOption = {
  userId: number;
  displayName: string;
  email: string;
  eligible: boolean;
  configured: boolean;
  isActive: boolean;
  newRequestEmail: boolean;
  pendingReminderEmail: boolean;
};

export type RequestNotificationSettingsResponse = {
  emailEnabled: boolean;
  reminderEnabled: boolean;
  reminderDelayMinutes: number;
  respectOpeningHours: boolean;
  externalEmailRuntimeEnabled: boolean;
  recipients: RequestNotificationRecipientOption[];
};
