import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/location", () => {
  it("rejects missing coordinates", async () => {
    const response = await GET(new Request("http://localhost/api/location"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Coordenadas inválidas." });
  });

  it("rejects coordinates outside the valid range", async () => {
    const response = await GET(new Request(
      "http://localhost/api/location?latitude=-91&longitude=-46",
    ));
    expect(response.status).toBe(400);
  });
});
