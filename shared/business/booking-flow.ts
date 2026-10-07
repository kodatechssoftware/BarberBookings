export const businessBookingSteps = [
  "professional",
  "service",
  "datetime",
  "customer",
] as const;

export type BusinessBookingStep = (typeof businessBookingSteps)[number];

export type BusinessBookingFlow = readonly BusinessBookingStep[];

export const businessBookingFlows = {
  barber: ["professional", "service", "datetime", "customer"],
  beauty: ["service", "professional", "datetime", "customer"],
} as const satisfies Record<string, BusinessBookingFlow>;
