import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { pt } from "date-fns/locale";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  Send,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button-custom";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { locationHeaders } from "@/lib/location-context";
import { calendarTimeInTimeZone } from "@/lib/availability";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type RequestStatus = "pending" | "proposed" | "approved" | "refused";
type AppointmentRequest = {
  id: number;
  locationId: number;
  status: RequestStatus;
  revision: number;
  customerName: string;
  customerEmail?: string | null;
  customerPhone: string;
  requestedStartTime: string;
  appointmentId?: number | null;
  refusalReason?: string | null;
  createdAt: string;
  segments: Array<{
    position: number;
    executionStage: number;
    serviceId: number;
    barberId: number;
    barberName?: string | null;
    startTime: string;
    durationMinutes: number;
    serviceNameSnapshot: string;
    servicePriceCentsSnapshot: number;
  }>;
  activeProposal?: {
    proposedStartTime: string;
    expiresAt: string;
    status: string;
  } | null;
  history?: Array<{
    id: number;
    event_type: string;
    actor_type: string;
    actor_name?: string | null;
    from_status?: string | null;
    to_status?: string | null;
    reason?: string | null;
    created_at: string;
  }>;
};

const statusLabels: Record<RequestStatus, string> = {
  pending: "Pendente",
  proposed: "Proposta enviada",
  approved: "Aprovado",
  refused: "Recusado",
};

const statusDescriptions: Record<RequestStatus, string> = {
  pending: "Pedido recebido — aguarda aprovação do estabelecimento.",
  proposed: "Foi proposta uma alteração ao horário. Aguarda resposta do cliente.",
  approved: "Pedido aprovado — marcação confirmada.",
  refused: "Pedido recusado pelo estabelecimento.",
};

const historyEventCopy: Record<string, {
  title: string;
  action: string;
  icon: typeof Clock;
  tone: string;
}> = {
  request_created: {
    title: "Pedido recebido",
    action: "Enviado",
    icon: Send,
    tone: "border-sky-400/25 bg-sky-400/10 text-sky-200",
  },
  request_approved: {
    title: "Marcação aprovada",
    action: "Aprovada",
    icon: CheckCircle2,
    tone: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
  },
  request_refused: {
    title: "Pedido recusado",
    action: "Recusado",
    icon: XCircle,
    tone: "border-red-400/25 bg-red-400/10 text-red-200",
  },
  approval_conflict: {
    title: "Conflito de disponibilidade",
    action: "Registado",
    icon: AlertTriangle,
    tone: "border-amber-400/25 bg-amber-400/10 text-amber-200",
  },
  proposal_created: {
    title: "Novo horário proposto",
    action: "Proposto",
    icon: MessageSquare,
    tone: "border-violet-400/25 bg-violet-400/10 text-violet-200",
  },
  proposal_replaced: {
    title: "Proposta substituída",
    action: "Substituída",
    icon: MessageSquare,
    tone: "border-violet-400/25 bg-violet-400/10 text-violet-200",
  },
  proposal_accepted: {
    title: "Proposta aceite e marcação confirmada",
    action: "Aceite",
    icon: CheckCircle2,
    tone: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
  },
  proposal_rejected: {
    title: "Proposta recusada",
    action: "Recusada",
    icon: XCircle,
    tone: "border-red-400/25 bg-red-400/10 text-red-200",
  },
  proposal_expired: {
    title: "Proposta expirada",
    action: "Registada",
    icon: Clock,
    tone: "border-gray-400/25 bg-gray-400/10 text-gray-200",
  },
  proposal_unavailable: {
    title: "Horário proposto indisponível",
    action: "Registado",
    icon: AlertTriangle,
    tone: "border-amber-400/25 bg-amber-400/10 text-amber-200",
  },
};

function money(cents: number) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function dateTime(value: string) {
  return format(parseISO(value), "d MMM yyyy, HH:mm", { locale: pt });
}

function historyDateTime(value: string) {
  return format(parseISO(value), "d 'de' MMMM 'de' yyyy, 'às' HH:mm", { locale: pt });
}

function historyActor(action: string, event: NonNullable<AppointmentRequest["history"]>[number]) {
  if (event.actor_name?.trim()) return `${action} por ${event.actor_name.trim()}`;
  if (event.actor_type === "client") return `${action} pelo cliente`;
  if (event.actor_type === "admin") return `${action} pelo administrador`;
  if (event.actor_type === "professional") return `${action} pelo profissional`;
  if (event.actor_type === "system") return `${action} automaticamente pelo sistema`;
  return "Responsável não registado";
}

async function requestJson(url: string, locationId: number) {
  const response = await apiFetch(url, { headers: locationHeaders(locationId), cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível carregar os pedidos.");
  return response.json();
}

export function AppointmentRequestsManager({ locationId, timeZone }: { locationId: number; timeZone: string }) {
  const [status, setStatus] = useState<RequestStatus | "all">("pending");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [action, setAction] = useState<"refuse" | "propose" | null>(null);
  const [reason, setReason] = useState("");
  const [proposalDate, setProposalDate] = useState("");
  const [proposalTime, setProposalTime] = useState("");
  const { toast } = useToast();
  const listUrl = `/api/admin/appointment-requests${status === "all" ? "" : `?status=${status}`}`;
  const { data: requests = [], isLoading, isError } = useQuery<AppointmentRequest[]>({
    queryKey: ["admin-appointment-requests", locationId, status],
    queryFn: () => requestJson(listUrl, locationId),
    refetchInterval: 15_000,
  });
  const { data: detail, isLoading: loadingDetail } = useQuery<AppointmentRequest>({
    queryKey: ["admin-appointment-request", locationId, selectedId],
    queryFn: () => requestJson(`/api/admin/appointment-requests/${selectedId}`, locationId),
    enabled: selectedId !== null,
  });
  const total = useMemo(() => detail?.segments.reduce((sum, segment) => sum + segment.servicePriceCentsSnapshot, 0) ?? 0, [detail]);

  const mutation = useMutation({
    mutationFn: async (kind: "approve" | "refuse" | "propose") => {
      if (!selectedId) throw new Error("Pedido inválido.");
      let body: unknown = {};
      if (kind === "refuse") body = { reason: reason.trim() || null };
      if (kind === "propose") {
        if (!proposalDate || !proposalTime) throw new Error("Escolha a data e a hora propostas.");
        const startTime = calendarTimeInTimeZone(new Date(`${proposalDate}T12:00:00`), proposalTime, timeZone);
        body = {
          startTime: startTime.toISOString(),
          expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1_000).toISOString(),
          commandKey: crypto.randomUUID(),
        };
      }
      const response = await apiRequest("POST", `/api/admin/appointment-requests/${selectedId}/${kind}`, body, {
        headers: locationHeaders(locationId),
      });
      return response.json();
    },
    onSuccess: async (_result, kind) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-appointment-requests", locationId] });
      await queryClient.invalidateQueries({ queryKey: ["admin-appointment-request", locationId, selectedId] });
      toast({
        title: kind === "approve" ? "Pedido aprovado" : kind === "refuse" ? "Pedido recusado" : "Novo horário proposto",
        description: kind === "approve" ? "A marcação foi criada e a disponibilidade voltou a ser validada." : "A decisão ficou registada no histórico.",
      });
      setAction(null);
      setReason("");
    },
    onError: (error: Error & { code?: string }) => toast({
      title: error.code === "APPOINTMENT_REQUEST_TIME_UNAVAILABLE" ? "Horário indisponível" : "Não foi possível concluir",
      description: error.message,
      variant: "destructive",
    }),
  });

  return <div className="space-y-5" data-testid="appointment-requests-manager">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-xl font-bold text-white">Pedidos de marcação</h2>
        <p className="text-sm text-gray-400">Analise cada pedido antes de criar a marcação definitiva.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["pending", "proposed", "approved", "refused", "all"] as const).map((value) => <Button
          key={value}
          size="sm"
          variant={status === value ? "gold" : "outline"}
          onClick={() => setStatus(value)}
        >{value === "all" ? "Todos" : statusLabels[value]}</Button>)}
      </div>
    </div>
    {isLoading ? <div className="flex min-h-44 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
      : isError ? <p className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-200">Não foi possível carregar os pedidos.</p>
      : requests.length === 0 ? <p className="rounded-xl border border-dashed border-white/10 p-8 text-center text-gray-400">Não existem pedidos neste estado.</p>
      : <div className="grid gap-3 lg:grid-cols-2">{requests.map((request) => <Card key={request.id} className="border-white/10 bg-card text-white">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div><p className="font-semibold">{request.customerName}</p><p className="text-xs text-gray-400">Recebido {dateTime(request.createdAt)}</p></div>
            <span className={cn("rounded-full border px-2 py-1 text-[10px] font-bold uppercase", request.status === "approved" ? "border-emerald-400/30 text-emerald-300" : request.status === "refused" ? "border-red-400/30 text-red-300" : "border-primary/30 text-primary")}>{statusLabels[request.status]}</span>
          </div>
          <div className="flex items-center gap-2 text-sm"><CalendarClock className="h-4 w-4 text-primary" />{dateTime(request.requestedStartTime)}</div>
          <p className="line-clamp-2 text-sm text-gray-300">{request.segments.map((segment) => segment.serviceNameSnapshot).join(" + ")}</p>
          <Button variant="outline" className="w-full" onClick={() => setSelectedId(request.id)}>
            {request.status === "pending" || request.status === "proposed" ? "Ver e decidir" : "Ver detalhe"}
          </Button>
        </CardContent>
      </Card>)}</div>}

    <Dialog open={selectedId !== null} onOpenChange={(open) => { if (!open && !mutation.isPending) setSelectedId(null); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-white/10 bg-card text-white">
        <DialogHeader>
          <DialogTitle>Pedido de marcação</DialogTitle>
          <DialogDescription className="text-gray-400">
            {detail ? statusDescriptions[detail.status] : "A carregar o pedido de marcação…"}
          </DialogDescription>
        </DialogHeader>
        {loadingDetail || !detail ? <Loader2 className="mx-auto my-12 h-7 w-7 animate-spin text-primary" /> : <div className="space-y-5">
          <div className="grid gap-3 rounded-xl border border-white/10 p-4 text-sm sm:grid-cols-2">
            <div><p className="text-gray-400">Cliente</p><p className="font-semibold">{detail.customerName}</p><p>{detail.customerPhone}</p><p>{detail.customerEmail}</p></div>
            <div><p className="text-gray-400">Horário pedido</p><p className="font-semibold">{dateTime(detail.requestedStartTime)}</p><p className="mt-2 text-gray-400">Estado</p><p>{statusLabels[detail.status]}</p></div>
          </div>
          <div className="space-y-2"><h3 className="font-semibold">Serviços</h3>{detail.segments.map((segment, index) => <div key={`${segment.position}-${segment.serviceId}`} className="flex justify-between gap-4 rounded-lg bg-background/50 p-3 text-sm"><span>{segment.position + 1}. {segment.serviceNameSnapshot}<small className="block text-gray-400">{segment.durationMinutes} min · {segment.barberName || "Profissional"}{index > 0 && segment.executionStage === detail.segments[index - 1].executionStage ? " · em simultâneo" : ""}</small></span><strong>{money(segment.servicePriceCentsSnapshot)}</strong></div>)}<div className="flex justify-between border-t border-white/10 pt-2 font-bold"><span>Total</span><span className="text-primary">{money(total)}</span></div></div>
          {detail.activeProposal && <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm"><p className="font-semibold">Proposta ativa</p><p>{dateTime(detail.activeProposal.proposedStartTime)} · expira {dateTime(detail.activeProposal.expiresAt)}</p></div>}
          {(detail.history?.length ?? 0) > 0 && <div className="space-y-3">
            <h3 className="font-semibold">Histórico</h3>
            <ol className="space-y-3" aria-label="Histórico do pedido">
              {detail.history!.map((event) => {
                const presentation = historyEventCopy[event.event_type] ?? {
                  title: "Atualização do pedido",
                  action: "Registada",
                  icon: Clock,
                  tone: "border-gray-400/25 bg-gray-400/10 text-gray-200",
                };
                const EventIcon = presentation.icon;
                return <li key={event.id} className="flex gap-3 rounded-xl border border-white/10 bg-background/30 p-3 text-sm">
                  <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border", presentation.tone)} aria-hidden="true">
                    <EventIcon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <strong className="block text-white">{presentation.title}</strong>
                    <time className="block text-xs text-gray-400" dateTime={event.created_at}>{historyDateTime(event.created_at)}</time>
                    <small className="mt-1 block text-gray-300">{historyActor(presentation.action, event)}</small>
                    {event.reason && <small className="mt-1 block rounded-md bg-white/5 px-2 py-1 text-gray-300">{event.reason}</small>}
                  </span>
                </li>;
              })}
            </ol>
          </div>}
          {(detail.status === "pending" || detail.status === "proposed") && <div className="grid gap-2 sm:grid-cols-3">
            <Button disabled={mutation.isPending || detail.status !== "pending"} onClick={() => mutation.mutate("approve")}><Check className="mr-2 h-4 w-4" />Aprovar</Button>
            <Button variant="outline" disabled={mutation.isPending} onClick={() => setAction("propose")}><MessageSquare className="mr-2 h-4 w-4" />Propor horário</Button>
            <Button variant="outline" className="border-red-400/30 text-red-300" disabled={mutation.isPending} onClick={() => setAction("refuse")}><X className="mr-2 h-4 w-4" />Recusar</Button>
          </div>}
        </div>}
      </DialogContent>
    </Dialog>

    <Dialog open={action !== null} onOpenChange={(open) => { if (!open && !mutation.isPending) setAction(null); }}>
      <DialogContent className="border-white/10 bg-card text-white">
        <DialogHeader><DialogTitle>{action === "refuse" ? "Recusar pedido" : "Propor outro horário"}</DialogTitle><DialogDescription className="text-gray-400">A decisão fica registada no histórico do pedido.</DialogDescription></DialogHeader>
        {action === "refuse" ? <div className="space-y-2"><Label htmlFor="request-refusal-reason">Motivo opcional</Label><Textarea id="request-refusal-reason" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></div>
          : <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="proposal-date">Data</Label><Input id="proposal-date" type="date" value={proposalDate} onChange={(event) => setProposalDate(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="proposal-time">Hora</Label><Input id="proposal-time" type="time" value={proposalTime} onChange={(event) => setProposalTime(event.target.value)} /></div><p className="text-xs text-gray-400 sm:col-span-2">A ligação de resposta será válida durante 72 horas. A disponibilidade volta a ser confirmada quando a cliente aceitar.</p></div>}
        <DialogFooter><Button variant="outline" onClick={() => setAction(null)}>Cancelar</Button><Button disabled={mutation.isPending} onClick={() => action && mutation.mutate(action)}>{mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
