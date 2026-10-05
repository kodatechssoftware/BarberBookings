import { Banknote, CreditCard, Gift, type LucideIcon } from "lucide-react";
import type { AppointmentPaymentMethod } from "@shared/schema";
import { cn } from "@/lib/utils";

type CompletedAppointmentPaymentMethod = Exclude<AppointmentPaymentMethod, "pending">;

export const appointmentPaymentOptions: Array<{
  value: CompletedAppointmentPaymentMethod;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    value: "cash",
    label: "Dinheiro",
    description: "Conta como valor recebido em numerário.",
    icon: Banknote,
  },
  {
    value: "card",
    label: "Multibanco",
    description: "Conta como valor recebido por cartão ou MB.",
    icon: CreditCard,
  },
  {
    value: "gift",
    label: "Oferta",
    description: "Conta como serviço feito, mas sem receita recebida.",
    icon: Gift,
  },
];

type AppointmentPaymentOptionsProps = {
  value?: AppointmentPaymentMethod;
  onSelect: (paymentMethod: CompletedAppointmentPaymentMethod) => void;
};

export function AppointmentPaymentOptions({
  value,
  onSelect,
}: AppointmentPaymentOptionsProps) {
  return (
    <div className="grid gap-2">
      {appointmentPaymentOptions.map((option) => {
        const Icon = option.icon;
        const isSelected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onSelect(option.value)}
            aria-pressed={isSelected}
            data-payment-method={option.value}
            className={cn(
              "rounded-lg border p-3 text-left transition",
              isSelected
                ? "border-primary/60 bg-primary/15 ring-1 ring-primary/30"
                : "border-white/10 bg-background/70 hover:border-primary/50 hover:bg-primary/10",
            )}
          >
            <span className="flex items-center gap-2 font-semibold text-white">
              <Icon className="h-4 w-4 text-primary" />
              {option.label}
            </span>
            <span className="mt-1 block text-xs text-gray-400">{option.description}</span>
          </button>
        );
      })}
    </div>
  );
}
