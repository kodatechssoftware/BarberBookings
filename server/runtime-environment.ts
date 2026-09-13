const appEnvironment = process.env.APP_ENV?.trim().toLowerCase();

export const isDevelopmentDeployment =
  process.env.NODE_ENV !== "production" || appEnvironment === "development";

export const isProductionDeployment =
  process.env.NODE_ENV === "production" && appEnvironment === "production";

function explicitBoolean(name: string) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return undefined;
  if (["true", "1"].includes(value)) return true;
  if (["false", "0"].includes(value)) return false;
  throw new Error(`${name} must be true or false.`);
}

// Development keeps its existing defaults. Production capabilities are always
// fail-closed and require an explicit opt-in.
export const appointmentNotificationEventsEnabled =
  explicitBoolean("APPOINTMENT_NOTIFICATION_EVENTS_ENABLED") ?? isDevelopmentDeployment;

export const appointmentNotificationWorkerEnabled =
  explicitBoolean("NOTIFICATION_OUTBOX_WORKER_ENABLED") ?? isDevelopmentDeployment;

export const recurringWhatsappNotificationsEnabled =
  explicitBoolean("META_WHATSAPP_RECURRING_NOTIFICATIONS_ENABLED") ?? false;

export function validateRuntimeConfiguration() {
  if (process.env.NODE_ENV === "production" && !["development", "production"].includes(appEnvironment || "")) {
    throw new Error("APP_ENV must be explicitly set to development or production when NODE_ENV=production.");
  }

  if (!isProductionDeployment) return;

  const publicUrl = (process.env.PUBLIC_URL || process.env.APP_BASE_URL || "").trim();
  if (!publicUrl) {
    throw new Error("PUBLIC_URL (or APP_BASE_URL) is required in Production.");
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(publicUrl);
  } catch {
    throw new Error("PUBLIC_URL (or APP_BASE_URL) must be a valid absolute URL in Production.");
  }
  if (parsedUrl.protocol !== "https:") {
    throw new Error("PUBLIC_URL (or APP_BASE_URL) must use HTTPS in Production.");
  }

  const sessionSecret = process.env.SESSION_SECRET?.trim() || "";
  if (sessionSecret.length < 32 || sessionSecret === "baptista-barber-shop-secret") {
    throw new Error("SESSION_SECRET must be explicitly configured with at least 32 characters in Production.");
  }

  if (appointmentNotificationWorkerEnabled && !appointmentNotificationEventsEnabled) {
    throw new Error("NOTIFICATION_OUTBOX_WORKER_ENABLED requires APPOINTMENT_NOTIFICATION_EVENTS_ENABLED.");
  }

  const whatsappEnabled = ["true", "1"].includes(
    process.env.WHATSAPP_NOTIFICATIONS_ENABLED?.trim().toLowerCase() || "",
  );
  if (whatsappEnabled) {
    if (!appointmentNotificationEventsEnabled || !appointmentNotificationWorkerEnabled) {
      throw new Error("Production WhatsApp requires notification events and the outbox worker to be enabled.");
    }
    if (process.env.MESSAGING_PROVIDER?.trim().toLowerCase() !== "meta") {
      throw new Error("MESSAGING_PROVIDER must be meta when Production WhatsApp is enabled.");
    }
    const graphVersion = process.env.META_WHATSAPP_GRAPH_API_VERSION?.trim() || "";
    if (!/^v\d+\.\d+$/.test(graphVersion)
      || !process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim()
      || !process.env.META_WHATSAPP_WABA_ID?.trim()
      || !process.env.META_WHATSAPP_ACCESS_TOKEN?.trim()) {
      throw new Error("Meta WhatsApp configuration is incomplete while Production WhatsApp is enabled.");
    }
    const templateEnvironmentNames = [
      "META_WHATSAPP_CONFIRMATION_TEMPLATE",
      "META_WHATSAPP_RESCHEDULED_TEMPLATE",
      "META_WHATSAPP_CANCELLED_TEMPLATE",
      "META_WHATSAPP_RECURRING_CONFIRMATION_TEMPLATE",
    ];
    if (templateEnvironmentNames.some((name) => !process.env[name]?.trim())) {
      throw new Error("All Meta WhatsApp appointment templates must be explicitly configured when Production WhatsApp is enabled.");
    }
  }

  const webhookEnabled = ["true", "1"].includes(
    process.env.META_WHATSAPP_WEBHOOK_ENABLED?.trim().toLowerCase() || "",
  );
  if (webhookEnabled && (
    !process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim()
    || !process.env.META_WHATSAPP_APP_SECRET?.trim()
    || !process.env.META_WHATSAPP_WABA_ID?.trim()
    || !process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim()
  )) {
    throw new Error("Meta webhook configuration is incomplete while the Production webhook is enabled.");
  }

  if (recurringWhatsappNotificationsEnabled && !whatsappEnabled) {
    throw new Error("Recurring WhatsApp notifications require WhatsApp notifications to be enabled.");
  }
}
