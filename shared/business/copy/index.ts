import type { BusinessVertical } from "../vertical";
import { barberBusinessCopy } from "./barber.pt";
import { beautyBusinessCopy } from "./beauty.pt";
import type { BusinessCopy } from "./types";

export { formatBusinessCopy, type BookingCopy, type BusinessCopy } from "./types";

export const businessCopy = {
  barber: barberBusinessCopy,
  beauty: beautyBusinessCopy,
} as const satisfies Record<BusinessVertical, BusinessCopy>;
