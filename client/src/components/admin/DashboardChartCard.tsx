import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type DailyDashboardPoint = {
  label: string;
  appointments: number;
  completed: number;
  revenueCents: number;
};

type BarberDashboardPoint = {
  id: number;
  name: string;
  appointments: number;
  revenueCents: number;
};

type DashboardChartCardProps =
  | {
      variant: "daily";
      daily: DailyDashboardPoint[];
      formatCents: (value: number) => string;
    }
  | {
      variant: "barbers";
      barbers: BarberDashboardPoint[];
      formatCents: (value: number) => string;
    };

const tooltipStyle = {
  background: "#111",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
};

export default function DashboardChartCard(props: DashboardChartCardProps) {
  if (props.variant === "daily") {
    return (
      <Card className="border-white/10 bg-card text-white">
        <CardHeader>
          <CardTitle className="text-base font-bold">Evolução diária</CardTitle>
          <p className="text-sm text-gray-400">Marcações, serviços concluídos e receita por dia.</p>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={props.daily} margin={{ left: -18, right: 8, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="dashboardRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#d4af37" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="#d4af37" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                <XAxis dataKey="label" stroke="#71717a" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis stroke="#71717a" tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: "#fff" }}
                  formatter={(value, name) => [
                    name === "revenueCents" ? props.formatCents(Number(value)) : value,
                    name === "revenueCents" ? "Receita" : name === "appointments" ? "Marcações" : "Concluídas",
                  ]}
                />
                <Area type="monotone" dataKey="revenueCents" stroke="#d4af37" fill="url(#dashboardRevenue)" strokeWidth={2} />
                <Area type="monotone" dataKey="appointments" stroke="#60a5fa" fill="transparent" strokeWidth={2} />
                <Area type="monotone" dataKey="completed" stroke="#86efac" fill="transparent" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-white/10 bg-card text-white">
      <CardHeader>
        <CardTitle className="text-base font-bold">Desempenho por barbeiro</CardTitle>
      </CardHeader>
      <CardContent>
        {props.barbers.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">Sem dados neste período.</p>
        ) : (
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={props.barbers} margin={{ left: -18, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                <XAxis dataKey="name" stroke="#71717a" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis stroke="#71717a" tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value, name) => [
                    name === "revenueCents" ? props.formatCents(Number(value)) : value,
                    name === "revenueCents" ? "Receita" : "Marcações",
                  ]}
                />
                <Bar dataKey="revenueCents" fill="#d4af37" radius={[6, 6, 0, 0]} />
                <Bar dataKey="appointments" fill="#3b82f6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
