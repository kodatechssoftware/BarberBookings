import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  calendarDateTimeToInstant,
  getCalendarDateTimeParts,
} from "../../server/calendar-timezone";
import { getAppointmentReminderAvailableAt } from "../../server/appointment-reminders";

const timeZone = "Europe/Lisbon";

function futureThursday(weeksAhead: number, hour: number) {
  const localNow = getCalendarDateTimeParts(new Date(), timeZone);
  const localDate = new Date(Date.UTC(localNow.year, localNow.month - 1, localNow.day));
  const daysUntilThursday = (4 - localDate.getUTCDay() + 7) % 7;
  localDate.setUTCDate(localDate.getUTCDate() + daysUntilThursday + weeksAhead * 7);
  return calendarDateTimeToInstant({
    year: localDate.getUTCFullYear(),
    month: localDate.getUTCMonth() + 1,
    day: localDate.getUTCDate(),
    hour,
    minute: 0,
    second: 0,
  }, timeZone);
}

async function loginAdmin(request: APIRequestContext) {
  const response = await request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function eventsFor(request: APIRequestContext, appointmentId: number) {
  const response = await request.get(`/api/admin/dev/notifications/appointment/${appointmentId}`);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

test("public and manual Beauty bookings schedule one day-before reminder without GET side effects", async ({ request }) => {
  const [barbersResponse, servicesResponse] = await Promise.all([
    request.get("/api/barbers"),
    request.get("/api/services"),
  ]);
  expect(barbersResponse.ok(), await barbersResponse.text()).toBe(true);
  expect(servicesResponse.ok(), await servicesResponse.text()).toBe(true);
  const barbers = await barbersResponse.json();
  const services = await servicesResponse.json();
  const professional = barbers.find((candidate: any) => candidate.isVisible !== false);
  const service = services.find((candidate: any) => candidate.isVisible !== false
    && (!Array.isArray(professional?.serviceIds)
      || professional.serviceIds.length === 0
      || professional.serviceIds.includes(candidate.id)));
  expect(professional).toBeTruthy();
  expect(service).toBeTruthy();

  const publicStart = futureThursday(8, 10);
  const publicResponse = await request.post("/api/appointments", { data: {
    barberId: professional.id,
    serviceId: service.id,
    startTime: publicStart.toISOString(),
    customerName: "Beauty Reminder Público QA",
    customerPhone: "+351912690101",
    customerEmail: "beauty-reminder-public@example.test",
    whatsappOptIn: true,
  } });
  expect(publicResponse.status(), await publicResponse.text()).toBe(201);
  const publicAppointment = await publicResponse.json();

  await loginAdmin(request);
  const publicEvents = await eventsFor(request, publicAppointment.id);
  const publicReminders = publicEvents.filter((event: any) => event.eventType === "appointment_reminder_day_before");
  expect(publicReminders).toHaveLength(1);
  expect(publicReminders[0].eventKey).toBe(`appointment:${publicAppointment.id}:reminder_day_before:1`);
  expect(new Date(publicReminders[0].availableAt).toISOString()).toBe(
    getAppointmentReminderAvailableAt(publicStart, timeZone, new Date())?.toISOString(),
  );

  const manualStart = futureThursday(9, 11);
  const manualName = `Beauty Reminder Manual QA ${Date.now()}`;
  const manualResponse = await request.post("/api/appointments/block", { data: {
    barberId: professional.id,
    serviceId: service.id,
    startTime: manualStart.toISOString(),
    name: manualName,
    phone: "+351912690102",
    customerEmail: "beauty-reminder-manual@example.test",
    isManualBooking: true,
    allowOutsideHours: true,
  } });
  expect(manualResponse.status(), await manualResponse.text()).toBe(201);
  const appointments = await (await request.get("/api/appointments")).json();
  const manualAppointment = appointments.find((candidate: any) => candidate.customerName === manualName);
  expect(manualAppointment).toBeTruthy();
  const manualEvents = await eventsFor(request, manualAppointment.id);
  expect(manualEvents.filter((event: any) => event.eventType === "appointment_reminder_day_before")).toHaveLength(1);

  const afterRead = await eventsFor(request, publicAppointment.id);
  expect(afterRead.map((event: any) => event.eventKey)).toEqual(publicEvents.map((event: any) => event.eventKey));

  for (const appointment of [publicAppointment, manualAppointment]) {
    const response = await request.patch(`/api/appointments/${appointment.id}/status`, {
      data: { status: "cancelled", expectedStatus: "booked" },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
});
