import { Banknote, CreditCard, Gift, Loader2, Ticket, type LucideIcon } from "lucide-react";
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
    value: "voucher",
    label: "Vale/Cupão",
    description: "Cobre o valor total sem reduzir o valor nominal nem a remuneração.",
    icon: Ticket,
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
  disabled?: boolean;
  pendingValue?: AppointmentPaymentMethod | null;
};

export function AppointmentPaymentOptions({
  value,
  onSelect,
  disabled = false,
  pendingValue = null,
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
            disabled={disabled}
            aria-pressed={isSelected}
            aria-busy={pendingValue === option.value}
            data-payment-method={option.value}
            className={cn(
              "rounded-lg border p-3 text-left transition disabled:cursor-wait disabled:opacity-60",
              isSelected
                ? "border-primary/60 bg-primary/15 ring-1 ring-primary/30"
                : "border-white/10 bg-background/70 hover:border-primary/50 hover:bg-primary/10",
            )}
          >
            <span className="flex items-center gap-2 font-semibold text-white">
              {pendingValue === option.value
                ? <Loader2 className="h-4 w-4 animate-spin text-primary" />
                : <Icon className="h-4 w-4 text-primary" />}
              {option.label}
            </span>
            <span className="mt-1 block text-xs text-gray-400">{option.description}</span>
          </button>
        );
      })}
    </div>
  );
}
