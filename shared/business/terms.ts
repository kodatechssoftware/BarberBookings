import type { BusinessVertical } from "./vertical";

export type BusinessTerm = {
  singular: string;
  plural: string;
};

export type BusinessTerms = {
  professional: BusinessTerm;
  service: BusinessTerm;
  appointment: BusinessTerm;
  workspace: BusinessTerm;
};

export const businessTerms = {
  barber: {
    professional: { singular: "barbeiro", plural: "barbeiros" },
    service: { singular: "serviço", plural: "serviços" },
    appointment: { singular: "marcação", plural: "marcações" },
    workspace: { singular: "cadeira", plural: "cadeiras" },
  },
  beauty: {
    professional: { singular: "profissional", plural: "profissionais" },
    service: { singular: "serviço", plural: "serviços" },
    appointment: { singular: "marcação", plural: "marcações" },
    workspace: { singular: "espaço", plural: "espaços" },
  },
} as const satisfies Record<BusinessVertical, BusinessTerms>;
