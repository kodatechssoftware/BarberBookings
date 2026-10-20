import type { BusinessVertical } from "./vertical";

const locationFallbackNames: Record<BusinessVertical, string> = {
  barber: "Barbearia",
  beauty: "Estabelecimento",
};

export function getBusinessLocationFallbackName(vertical: BusinessVertical) {
  return locationFallbackNames[vertical];
}
