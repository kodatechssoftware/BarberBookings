import { cn } from "@/lib/utils";

type AppointmentDaySummaryProps = {
  summary: {
    total: number;
    booked: number;
    completed: number;
    risk: number;
  };
};

const summaryItems = [
  { key: "total", label: "Total do dia", tone: "text-white" },
  { key: "booked", label: "Ativas", tone: "text-primary" },
  { key: "completed", label: "Concluídas", tone: "text-green-300" },
  { key: "risk", label: "Risco", tone: "text-rose-300" },
] as const;

export function AppointmentDaySummary({ summary }: AppointmentDaySummaryProps) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {summaryItems.map((item) => (
        <div key={item.key} className="rounded-xl border border-white/10 bg-card p-3">
          <p className="text-[11px] uppercase tracking-widest text-gray-500">{item.label}</p>
          <p className={cn("mt-1 text-2xl font-bold", item.tone)}>{summary[item.key]}</p>
        </div>
      ))}
    </div>
  );
}
