import { describe, expect, it } from "vitest";
import { fieldFlowReducer, initialFlowState, isRequestReady } from "./flow";

describe("FIELD flow", () => {
  it("does not start with an empty request", () => {
    expect(fieldFlowReducer(initialFlowState, { type: "START_REQUEST", message: "  " })).toEqual(
      initialFlowState,
    );
  });

  it("collects the missing fields before beginning work", () => {
    let state = fieldFlowReducer(initialFlowState, {
      type: "START_REQUEST",
      message: "Preciso de um chaveiro em Pinheiros hoje à tarde",
    });

    expect(state.stage).toBe("collect");
    expect(isRequestReady(state.request)).toBe(false);
    expect(fieldFlowReducer(state, { type: "BEGIN_WORK" }).stage).toBe("collect");

    state = fieldFlowReducer(state, {
      type: "UPDATE_FIELD",
      field: "problem",
      value: "Perdi a chave",
    });
    state = fieldFlowReducer(state, {
      type: "UPDATE_FIELD",
      field: "budget",
      value: "Até R$200",
    });

    expect(isRequestReady(state.request)).toBe(true);
    expect(fieldFlowReducer(state, { type: "BEGIN_WORK" }).stage).toBe("work");
  });

  it("preserves the request when the user returns to adjust it", () => {
    const collecting = fieldFlowReducer(initialFlowState, {
      type: "START_REQUEST",
      message: "Preciso de um chaveiro",
    });
    const withProblem = fieldFlowReducer(collecting, {
      type: "UPDATE_FIELD",
      field: "problem",
      value: "A chave quebrou",
    });
    const working = fieldFlowReducer(
      fieldFlowReducer(withProblem, {
        type: "UPDATE_FIELD",
        field: "budget",
        value: "Até R$200",
      }),
      { type: "BEGIN_WORK" },
    );
    const adjusted = fieldFlowReducer(working, { type: "RETURN_TO_COLLECTION" });

    expect(adjusted.stage).toBe("collect");
    expect(adjusted.request.problem).toBe("A chave quebrou");
  });

  it("resets the experience after the result", () => {
    const reset = fieldFlowReducer(
      { ...initialFlowState, stage: "result", originalRequest: "Teste" },
      { type: "RESET" },
    );
    expect(reset).toEqual(initialFlowState);
  });
});
