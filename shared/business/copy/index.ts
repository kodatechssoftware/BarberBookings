import type { BusinessVertical } from "../vertical";
import { barberBusinessCopy } from "./barber.pt";
import { beautyBusinessCopy } from "./beauty.pt";
import type { BusinessCopy } from "./types";

export {
  formatBusinessCopy,
  type AdminCopy,
  type AgendaCopy,
  type BookingCopy,
  type BusinessCopy,
  type CommunicationsCopy,
} from "./types";

export const businessCopy = {
  barber: barberBusinessCopy,
  beauty: beautyBusinessCopy,
} as const satisfies Record<BusinessVertical, BusinessCopy>;
