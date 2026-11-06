import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { pt } from "date-fns/locale";
import { Check, Loader2, X } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button-custom";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { APPOINTMENT_REQUEST_PUBLIC_COPY as requestCopy } from "@shared/business/copy/appointment-request.pt";

type ProposalPreview = {
  status: string;
  requestStatus: string;
  proposedStartTime: string;
  expiresAt: string;
  services: Array<{ position: number; executionStage: number; name: string; durationMinutes: number; priceCents: number }>;
};

function getFragmentToken() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token")?.trim() ?? "";
}

function formatDateTime(value: string) {
  const formatted = format(parseISO(value), "EEEE, d 'de' MMMM 'de' yyyy, 'às' HH:mm", { locale: pt });
  return `${formatted.charAt(0).toLocaleUpperCase("pt-PT")}${formatted.slice(1)}`;
}

function formatShortDateTime(value: string) {
  return format(parseISO(value), "dd/MM/yyyy, HH:mm", { locale: pt });
}

function money(cents: number) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(cents / 100);
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
    } catch {
      setError(requestCopy.proposal.responseError);
    } finally {
      setSubmitting(false);
    }
  };
  return <main className="booking-shell flex min-h-screen items-center justify-center bg-background p-4 text-foreground sm:p-6">
    <Card className="w-full max-w-xl border-border bg-card shadow-xl shadow-primary/10">
      <CardContent className="space-y-5 p-5 sm:p-8">
        {isLoading ? <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-8 w-8 animate-spin text-primary" /> A carregar a proposta...
        </div>
          : !token || isError || !data ? <div className="space-y-4 text-center">
            <h1 className="font-display text-2xl font-bold text-foreground">{requestCopy.proposal.unavailableTitle}</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">{requestCopy.proposal.unavailableDescription}</p>
            <Button asChild variant="outline"><Link href="/">{requestCopy.success.backHome}</Link></Button>
          </div>
          : decision ? <div className="space-y-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              {decision === "accepted" ? <Check className="h-7 w-7 text-primary" /> : <X className="h-7 w-7 text-primary" />}
            </div>
            <h1 className="font-display text-2xl font-bold text-foreground">
              {decision === "accepted" ? requestCopy.proposal.acceptedTitle : requestCopy.proposal.rejectedTitle}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {decision === "accepted" ? requestCopy.proposal.acceptedDescription : requestCopy.proposal.rejectedDescription}
            </p>
            <Button asChild variant="outline"><Link href="/">{requestCopy.success.backHome}</Link></Button>
          </div>
          : <>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{requestCopy.proposal.eyebrow}</p>
              <h1 className="mt-2 font-display text-2xl font-bold text-foreground sm:text-3xl">{requestCopy.proposal.title}</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{requestCopy.proposal.description}</p>
            </div>
            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
              <p className="text-lg font-bold capitalize text-foreground">{formatDateTime(data.proposedStartTime)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{requestCopy.proposal.validUntil} {formatShortDateTime(data.expiresAt)}</p>
            </div>
            <div className="space-y-3">
              <h2 className="font-semibold text-foreground">{data.services.length === 1 ? "Serviço" : "Serviços"}</h2>
              {data.services.map((service, index) => <div key={service.position} className="flex justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2.5 text-sm">
                <span className="text-foreground">{service.position + 1}. {service.name}<small className="mt-0.5 block text-muted-foreground">{service.durationMinutes} min{index > 0 && service.executionStage === data.services[index - 1].executionStage ? " · em simultâneo" : ""}</small></span>
                <strong className="shrink-0 text-foreground">{money(service.priceCents)}</strong>
              </div>)}
              <div className="flex justify-between border-t border-border pt-3 font-bold text-foreground">
                <span>Total</span><span className="text-primary">{money(total)}</span>
              </div>
            </div>
            <p className="rounded-xl bg-secondary/60 px-4 py-3 text-sm leading-relaxed text-secondary-foreground">
              {requestCopy.proposal.availabilityNotice}
            </p>
            {!active && <p className="rounded-xl border border-amber-600/30 bg-amber-50 p-3 text-sm font-medium text-amber-900" role="status">{requestCopy.proposal.inactive}</p>}
            {error && <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{error}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="outline" disabled={!active || submitting} onClick={() => respond("reject")}>
                <X className="mr-2 h-4 w-4" />{requestCopy.proposal.reject}
              </Button>
              <Button disabled={!active || submitting} onClick={() => respond("accept")}>
                {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{requestCopy.proposal.submitting}</> : <><Check className="mr-2 h-4 w-4" />{requestCopy.proposal.accept}</>}
              </Button>
            </div>
          </>}
      </CardContent>
    </Card>
  </main>;
}
