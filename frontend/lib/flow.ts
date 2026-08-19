export type FlowStage = "start" | "collect" | "work" | "result";

export type EditableField = "service" | "location" | "availability" | "problem" | "budget";

export interface ServiceRequest {
  service: string;
  location: string;
  availability: string;
  problem: string;
  budget: string;
}

export interface ProviderOffer {
  provider: string;
  rating: number;
  reviewCount: number;
  distance: string;
  price: string;
  arrival: string;
}

export interface BookingResult extends ProviderOffer {
  calendarAdded: boolean;
  providerConfirmed: boolean;
}

export interface FlowState {
  stage: FlowStage;
  originalRequest: string;
  request: ServiceRequest;
}

export type FlowAction =
  | { type: "START_REQUEST"; message: string }
  | { type: "UPDATE_FIELD"; field: EditableField; value: string }
  | { type: "BEGIN_WORK" }
  | { type: "SHOW_RESULT" }
  | { type: "RETURN_TO_COLLECTION" }
  | { type: "RESET" };

export const emptyRequest: ServiceRequest = {
  service: "Chaveiro",
  location: "Pinheiros, São Paulo",
  availability: "Hoje · 14:00–18:00",
  problem: "",
  budget: "",
};

export const initialFlowState: FlowState = {
  stage: "start",
  originalRequest: "",
  request: emptyRequest,
};

export const bookingResult: BookingResult = {
  provider: "Chaveiro Pinheiros",
  rating: 4.8,
  reviewCount: 128,
  distance: "1,2 km",
  price: "R$180",
  arrival: "15:30",
  calendarAdded: true,
  providerConfirmed: true,
};

export function isRequestReady(request: ServiceRequest) {
  return Object.values(request).every((value) => value.trim().length > 0);
}

export function fieldFlowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "START_REQUEST":
      if (!action.message.trim()) return state;
      return {
        stage: "collect",
        originalRequest: action.message.trim(),
        request: { ...emptyRequest },
      };
    case "UPDATE_FIELD":
      return {
        ...state,
        request: { ...state.request, [action.field]: action.value.trim() },
      };
    case "BEGIN_WORK":
      return isRequestReady(state.request) ? { ...state, stage: "work" } : state;
    case "SHOW_RESULT":
      return state.stage === "work" ? { ...state, stage: "result" } : state;
    case "RETURN_TO_COLLECTION":
      return { ...state, stage: "collect" };
    case "RESET":
      return { ...initialFlowState, request: { ...emptyRequest } };
    default:
      return state;
  }
}
