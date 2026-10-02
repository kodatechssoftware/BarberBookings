import { cn } from "@/lib/utils";

const currencyFormatter = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
});

function formatCents(value: number) {
  return currencyFormatter.format(value / 100);
}

export function AppointmentCommercialSummary({
  serviceName,
  servicePriceCents,
  extras,
  totalPriceCents,
  className,
}: {
  serviceName: string;
  servicePriceCents: number;
  extras: Array<{
    nameSnapshot: string;
    amountCentsSnapshot: number;
    position: number;
  }>;
  totalPriceCents: number;
  className?: string;
}) {
  if (extras.length === 0) return null;

  return (
    <div
      className={cn("space-y-2 rounded-xl border border-white/10 bg-card/80 p-4 text-left text-sm", className)}
      data-testid="customer-appointment-commercial-summary"
    >
      <div className="flex items-start justify-between gap-4">
        <span className="min-w-0 break-words text-gray-300">{serviceName}</span>
        <span className="shrink-0 font-medium text-white">{formatCents(servicePriceCents)}</span>
      </div>
      {[...extras].sort((left, right) => left.position - right.position).map((extra) => (
        <div key={`${extra.position}-${extra.nameSnapshot}`} className="flex items-start justify-between gap-4">
          <span className="min-w-0 break-words text-gray-300">{extra.nameSnapshot}</span>
          <span className="shrink-0 font-medium text-white">{formatCents(extra.amountCentsSnapshot)}</span>
        </div>
      ))}
      <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-2 font-bold">
        <span className="text-white">Total</span>
        <span className="shrink-0 text-primary">{formatCents(totalPriceCents)}</span>
      </div>
    </div>
  );
}
