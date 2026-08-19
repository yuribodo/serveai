import { describe, expect, it } from "vitest";
import { buildGoogleCalendarUrl } from "./calendar";

describe("Google Calendar link", () => {
  it("prefills the confirmed appointment", () => {
    const result = new URL(buildGoogleCalendarUrl({
      title: "Chaveiro — Chaveiro Pinheiros",
      location: "Pinheiros, São Paulo",
      description: "Serviço confirmado. Preço: R$180.",
      date: new Date(2026, 7, 19, 10),
      startTime: "15:30",
      timeZone: "America/Sao_Paulo",
    }));

    expect(result.origin).toBe("https://calendar.google.com");
    expect(result.searchParams.get("action")).toBe("TEMPLATE");
    expect(result.searchParams.get("text")).toBe("Chaveiro — Chaveiro Pinheiros");
    expect(result.searchParams.get("dates")).toBe("20260819T153000/20260819T163000");
    expect(result.searchParams.get("location")).toBe("Pinheiros, São Paulo");
    expect(result.searchParams.get("ctz")).toBe("America/Sao_Paulo");
  });
});
