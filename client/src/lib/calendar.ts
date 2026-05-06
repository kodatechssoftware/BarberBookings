type CalendarEvent = {
  title: string;
  start: Date;
  durationMinutes: number;
  details?: string;
  location?: string;
};

const escapeIcsText = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");

const toCalendarDate = (date: Date) =>
  date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

export function buildGoogleCalendarUrl(event: CalendarEvent) {
  const end = new Date(event.start.getTime() + event.durationMinutes * 60000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${toCalendarDate(event.start)}/${toCalendarDate(end)}`,
    details: event.details || "",
    location: event.location || "",
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function buildIcsDataUri(event: CalendarEvent) {
  const end = new Date(event.start.getTime() + event.durationMinutes * 60000);
  const uid =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Baptista Barber Shop//Bookings//PT",
    "BEGIN:VEVENT",
    `UID:${uid}@baptistabarbershop`,
    `DTSTAMP:${toCalendarDate(new Date())}`,
    `DTSTART:${toCalendarDate(event.start)}`,
    `DTEND:${toCalendarDate(end)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.details || "")}`,
    `LOCATION:${escapeIcsText(event.location || "")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}
