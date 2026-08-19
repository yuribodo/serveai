export interface GoogleCalendarEvent {
  title: string;
  location: string;
  description: string;
  date: Date;
  startTime: string;
  durationMinutes?: number;
  timeZone?: string;
}

const pad = (value: number) => String(value).padStart(2, "0");

function formatCalendarDate(date: Date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    pad(date.getMinutes()),
    "00",
  ].join("");
}

export function buildGoogleCalendarUrl({
  title,
  location,
  description,
  date,
  startTime,
  durationMinutes = 60,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
}: GoogleCalendarEvent) {
  const [hours, minutes] = startTime.split(":").map(Number);
  const start = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0,
  );
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const query = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${formatCalendarDate(start)}/${formatCalendarDate(end)}`,
    details: description,
    location,
    ctz: timeZone,
  });

  return `https://calendar.google.com/calendar/render?${query}`;
}
