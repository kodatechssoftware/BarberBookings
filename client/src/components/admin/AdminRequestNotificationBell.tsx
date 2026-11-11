import { useMemo, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { pt } from "date-fns/locale";
import { AlertTriangle, Bell, BellRing, CalendarClock, CheckCheck, CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { AdminNotificationFeed, AdminNotificationItem } from "@shared/admin-notifications";
import { Button } from "@/components/ui/button-custom";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { locationHeaders } from "@/lib/location-context";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

function requestedAt(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-PT", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function elapsed(value: string) {
  return formatDistanceToNowStrict(new Date(value), { addSuffix: true, locale: pt });
}

const notificationPresentation: Record<AdminNotificationItem["type"], {
  title: string;
  icon: typeof CalendarClock;
  tone: string;
}> = {
  new_request: {
    title: "Novo pedido de marcação",
    icon: CalendarClock,
    tone: "border-primary/30 bg-primary/10 text-primary",
  },
  pending_reminder: {
    title: "Pedido ainda por analisar",
    icon: CalendarClock,
    tone: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  },
  proposal_accepted: {
    title: "Cliente aceitou a proposta",
    icon: CheckCircle2,
    tone: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  },
  proposal_rejected: {
    title: "Cliente recusou a proposta",
    icon: XCircle,
    tone: "border-red-400/30 bg-red-400/10 text-red-200",
  },
  proposal_unavailable: {
    title: "Horário proposto indisponível",
    icon: AlertTriangle,
    tone: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  },
};

export function AdminRequestNotificationBell({
  locationId,
  timeZone,
  feed,
  loading,
  onOpenRequest,
}: {
  locationId: number;
  timeZone: string;
  feed?: AdminNotificationFeed;
  loading: boolean;
  onOpenRequest: (item: AdminNotificationItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<number | "all" | null>(null);
  const { toast } = useToast();
  const queryKey = useMemo(() => ["admin-request-notifications", locationId], [locationId]);

  const markRead = async (item: AdminNotificationItem) => {
    setPendingId(item.id);
    try {
      if (!item.readAt) {
        await apiRequest("POST", `/api/admin/request-notifications/${item.id}/read`, undefined, {
          headers: locationHeaders(locationId),
        });
        await queryClient.invalidateQueries({ queryKey });
      }
      setOpen(false);
      onOpenRequest(item);
    } catch (error) {
      toast({
        title: "Não foi possível abrir a notificação",
        description: error instanceof Error ? error.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setPendingId(null);
    }
  };

  const markAllRead = async () => {
    setPendingId("all");
    try {
      await apiRequest("POST", "/api/admin/request-notifications/read-all", undefined, {
        headers: locationHeaders(locationId),
      });
      await queryClient.invalidateQueries({ queryKey });
    } catch (error) {
      toast({
        title: "Não foi possível marcar as notificações como lidas",
        description: error instanceof Error ? error.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setPendingId(null);
    }
  };

  const unreadCount = feed?.unreadCount ?? 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="relative h-9 w-9 border-white/10 bg-card text-white hover:bg-white/10"
          aria-label={unreadCount > 0 ? `${unreadCount} notificações não lidas` : "Notificações"}
          data-testid="admin-notification-bell"
        >
          {unreadCount > 0 ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          {unreadCount > 0 && (
            <span className="absolute -right-2 -top-2 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground ring-2 ring-background">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        className="w-[calc(100vw-1.5rem)] max-w-sm border-white/10 bg-card p-0 text-white shadow-2xl"
        data-testid="admin-notification-panel"
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
          <div>
            <p className="font-semibold">Notificações</p>
            <p className="text-xs text-gray-400">Pedidos, lembretes e respostas das clientes</p>
          </div>
          {unreadCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs text-primary"
              disabled={pendingId !== null}
              onClick={() => void markAllRead()}
            >
              {pendingId === "all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
              Marcar todas como lidas
            </Button>
          )}
        </div>
        <div className="max-h-[min(28rem,70vh)] overflow-y-auto">
          {loading && !feed ? (
            <div className="flex min-h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : (feed?.items.length ?? 0) === 0 ? (
            <div className="p-8 text-center">
              <Bell className="mx-auto mb-3 h-7 w-7 text-gray-500" />
              <p className="text-sm font-medium">Sem notificações recentes</p>
              <p className="mt-1 text-xs text-gray-400">Os novos pedidos aparecerão aqui.</p>
            </div>
          ) : feed!.items.map((item) => {
            const presentation = notificationPresentation[item.type];
            const NotificationIcon = presentation.icon;
            return (
            <button
              key={item.id}
              type="button"
              className={cn(
                "block w-full border-b border-white/5 p-4 text-left transition-colors last:border-b-0 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                !item.readAt && "bg-primary/[0.06]",
              )}
              disabled={pendingId !== null}
              onClick={() => void markRead(item)}
              data-testid={`admin-notification-${item.id}`}
            >
              <div className="flex items-start gap-3">
                <span className={cn(
                  "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border",
                  presentation.tone,
                )}>
                  <NotificationIcon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <strong className="text-sm text-white">
                      {presentation.title}
                    </strong>
                    {!item.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Não lida" />}
                  </span>
                  <span className="mt-1 block truncate text-sm font-medium text-gray-200">{item.customerName}</span>
                  <span className="mt-0.5 block line-clamp-2 text-xs text-gray-400">
                    {item.services.map((service) => service.name).join(" · ")}
                  </span>
                  <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-400">
                    <span>{requestedAt(item.requestedStartTime, timeZone)}</span>
                    <span>{elapsed(item.createdAt)}</span>
                  </span>
                </span>
                {pendingId === item.id && <Loader2 className="mt-2 h-4 w-4 shrink-0 animate-spin text-primary" />}
              </div>
            </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
