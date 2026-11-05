import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { pt } from "date-fns/locale";
import { Check, Loader2, X } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button-custom";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";

type ProposalPreview = {
  status: string;
  requestStatus: string;
  proposedStartTime: string;
  expiresAt: string;
  services: Array<{ position: number; name: string; durationMinutes: number; priceCents: number }>;
};

function getFragmentToken() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token")?.trim() ?? "";
}

export default function AppointmentRequestProposal() {
  const token = useMemo(getFragmentToken, []);
  const [decision, setDecision] = useState<"accepted" | "rejected" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const { data, isLoading, isError } = useQuery<ProposalPreview>({
    queryKey: ["appointment-request-proposal", token ? "present" : "missing"],
    enabled: token.length >= 32,
    queryFn: async () => {
      const response = await apiRequest("POST", "/api/appointment-request-proposals/inspect", { token });
      return response.json();
    },
  });
  const total = data?.services.reduce((sum, service) => sum + service.priceCents, 0) ?? 0;
  const active = data?.status === "active" && data.requestStatus === "proposed";
  const respond = async (next: "accept" | "reject") => {
    setSubmitting(true);
    setError("");
    try {
      await apiRequest("POST", "/api/appointment-request-proposals/respond", { token, decision: next });
      setDecision(next === "accept" ? "accepted" : "rejected");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível responder à proposta.");
    } finally {
      setSubmitting(false);
    }
  };
  return <main className="flex min-h-screen items-center justify-center bg-background p-5 text-white">
    <Card className="w-full max-w-xl border-white/10 bg-card text-white"><CardContent className="space-y-5 p-6 sm:p-8">
      {isLoading ? <Loader2 className="mx-auto my-12 h-8 w-8 animate-spin text-primary" />
        : !token || isError || !data ? <><h1 className="font-display text-2xl font-bold">Ligação indisponível</h1><p className="text-gray-300">Esta ligação não é válida ou já não está disponível.</p><Button asChild variant="outline"><Link href="/">Voltar ao início</Link></Button></>
        : decision ? <div className="space-y-4 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">{decision === "accepted" ? <Check className="h-7 w-7 text-primary" /> : <X className="h-7 w-7 text-primary" />}</div><h1 className="font-display text-2xl font-bold">{decision === "accepted" ? "Novo horário aceite" : "Proposta recusada"}</h1><p className="text-gray-300">{decision === "accepted" ? "A marcação foi confirmada. Receberá os detalhes através dos contactos indicados." : "O estabelecimento foi informado e poderá enviar uma nova proposta."}</p></div>
        : <><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Proposta de alteração</p><h1 className="mt-2 font-display text-2xl font-bold">Novo horário sugerido</h1><p className="mt-2 text-sm text-gray-400">Aceitar cria a marcação apenas se o horário continuar disponível.</p></div><div className="rounded-xl border border-primary/20 bg-primary/5 p-4"><p className="text-lg font-bold">{format(parseISO(data.proposedStartTime), "EEEE, d 'de' MMMM 'às' HH:mm", { locale: pt })}</p><p className="mt-1 text-xs text-gray-400">Válido até {format(parseISO(data.expiresAt), "d/MM/yyyy HH:mm")}</p></div><div className="space-y-2">{data.services.map((service) => <div key={service.position} className="flex justify-between gap-3 text-sm"><span>{service.position + 1}. {service.name}<small className="block text-gray-400">{service.durationMinutes} min</small></span><strong>{(service.priceCents / 100).toFixed(2)} €</strong></div>)}<div className="flex justify-between border-t border-white/10 pt-2 font-bold"><span>Total</span><span className="text-primary">{(total / 100).toFixed(2)} €</span></div></div>{!active && <p className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100">Esta proposta já não está ativa.</p>}{error && <p className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}<div className="grid gap-2 sm:grid-cols-2"><Button variant="outline" disabled={!active || submitting} onClick={() => respond("reject")}><X className="mr-2 h-4 w-4" />Recusar</Button><Button disabled={!active || submitting} onClick={() => respond("accept")}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="mr-2 h-4 w-4" />Aceitar horário</>}</Button></div></>}
    </CardContent></Card>
  </main>;
}
