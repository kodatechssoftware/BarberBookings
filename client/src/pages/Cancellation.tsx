import { useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { useAppointmentByToken, useCancelAppointment } from "@/hooks/use-appointments";
import { Button } from "@/components/ui/button-custom";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Home,
  Loader2,
  Scissors,
  UserRound,
  XCircle,
} from "lucide-react";
import { motion } from "framer-motion";
import { shopBranding } from "@/lib/branding";
import { AppointmentCommercialSummary } from "@/components/AppointmentCommercialSummary";
import { useBusinessCopy } from "@/business/use-business-copy";
import { formatBusinessCopy } from "@shared/business/copy/types";

function formatAppointmentDate(value?: string, timeZone = "Europe/Lisbon") {
  if (!value) return "";

  return new Intl.DateTimeFormat("pt-PT", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(value)) + "h";
}

function StatusScreen({
  tone,
  title,
  description,
  returnHomeLabel,
}: {
  tone: "success" | "danger" | "neutral";
  title: string;
  description: string;
  returnHomeLabel: string;
}) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "danger" ? XCircle : AlertTriangle;
  const iconClass = tone === "success" ? "text-emerald-400" : tone === "danger" ? "text-red-400" : "text-primary";
  const bgClass = tone === "success" ? "bg-emerald-500/10" : tone === "danger" ? "bg-red-500/10" : "bg-primary/10";

  return (
    <div className="min-h-[100svh] bg-background text-white flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-card/80 p-6 text-center shadow-2xl shadow-black/30">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full ${bgClass}`}
        >
          <Icon className={`h-8 w-8 ${iconClass}`} />
        </motion.div>
        <h2 className="mb-3 font-display text-2xl font-bold leading-tight text-white">{title}</h2>
        <p className="mb-6 text-sm leading-6 text-gray-300">{description}</p>
        <Link href="/">
          <Button variant="gold" className="flex h-11 w-full items-center justify-center gap-2">
            <Home className="h-4 w-4" aria-hidden="true" /> {returnHomeLabel}
          </Button>
        </Link>
      </div>
    </div>
  );
}

export default function Cancellation() {
  const copy = useBusinessCopy().publicCycle;
  const [, params] = useRoute("/cancel/:token");
  const token = params?.token;
  const cancelAppointment = useCancelAppointment();
  const { data: appointment, isLoading, isError } = useAppointmentByToken(token);
  const [success, setSuccess] = useState(false);
  const [cancelMessage, setCancelMessage] = useState("");
  const [cancelError, setCancelError] = useState("");

  const appointmentDate = useMemo(
    () => formatAppointmentDate(appointment?.startTime, appointment?.locationTimeZone),
    [appointment?.locationTimeZone, appointment?.startTime],
  );
  const isCancelled = appointment?.status === "cancelled" || appointment?.status === "late_cancelled";
  const isUnavailable = appointment && appointment.status !== "booked" && !isCancelled;

  const handleCancel = async () => {
    if (!token) return;
    setCancelError("");
    try {
      const result = await cancelAppointment.mutateAsync(token);
      setCancelMessage(result.message || copy.cancellation.successFallback);
      setSuccess(true);
    } catch (error) {
      setCancelError(error instanceof Error && error.message
        ? error.message
        : copy.cancellation.errorFallback);
    }
  };

  if (isLoading) {
    return (
      <div role="status" aria-label={copy.common.loadingAppointmentAria} className="min-h-[100svh] bg-background flex items-center justify-center p-4">
        <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError) {
    return (
      <StatusScreen
        tone="danger"
        title={copy.common.genericErrorTitle}
        description={copy.cancellation.errorFallback}
        returnHomeLabel={copy.common.returnHome}
      />
    );
  }

  if (appointment === null) {
    return (
      <StatusScreen
        tone="neutral"
        title={copy.cancellation.notFoundTitle}
        description={copy.cancellation.notFoundDescription}
        returnHomeLabel={copy.common.returnHome}
      />
    );
  }

  if (success || isCancelled) {
    return (
      <StatusScreen
        tone="danger"
        title={copy.cancellation.cancelledTitle}
        description={cancelMessage || copy.cancellation.alreadyCancelledDescription}
        returnHomeLabel={copy.common.returnHome}
      />
    );
  }

  if (isUnavailable) {
    return (
      <StatusScreen
        tone="neutral"
        title={copy.cancellation.unavailableTitle}
        description={copy.cancellation.unavailableDescription}
        returnHomeLabel={copy.common.returnHome}
      />
    );
  }

  return (
    <div className="min-h-[100svh] bg-background text-white flex items-center justify-center px-4 py-6">
      <main className="w-full max-w-md">
        <div className="mb-5 text-center">
          <p className="text-xs font-semibold uppercase text-primary">{appointment?.locationName || shopBranding.name}</p>
          <h1 className="mt-2 font-display text-3xl font-bold leading-tight">{copy.cancellation.pageTitle}</h1>
          <p className="mt-3 text-sm leading-6 text-gray-300">
            {copy.cancellation.pageDescription}
          </p>
        </div>

        <section className="rounded-lg border border-white/10 bg-card/80 p-5 shadow-2xl shadow-black/30">
          <div className="text-left">
            <div className="flex items-start gap-3 border-b border-white/10 pb-4">
              <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="text-xs uppercase text-gray-500">{copy.cancellation.dateTimeLabel}</p>
                <p className="text-sm font-semibold capitalize text-white">{appointmentDate}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2">
              <div className="flex items-start gap-3 border-b border-white/10 py-4 sm:border-r sm:pr-4">
                <UserRound className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <p className="text-xs uppercase text-gray-500">{copy.cancellation.professionalLabel}</p>
                  <p className="text-sm font-semibold text-white">{appointment?.barberName}</p>
                </div>
              </div>

              <div className="flex items-start gap-3 border-b border-white/10 py-4 sm:pl-4">
                <Scissors className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <p className="text-xs uppercase text-gray-500">{copy.cancellation.serviceLabel}</p>
                  <p className="text-sm font-semibold text-white">{appointment?.serviceName}</p>
                </div>
              </div>
            </div>
            {appointment && (
              <AppointmentCommercialSummary
                serviceName={appointment.serviceName}
                servicePriceCents={appointment.price}
                extras={appointment.extras ?? []}
                totalPriceCents={appointment.totalPrice ?? appointment.price}
                className="mt-4"
              />
            )}
          </div>

          {appointment?.isLateCancellation && (
            <div className="mt-4 rounded-md border border-orange-400/25 bg-orange-500/10 p-3 text-left text-sm leading-6 text-orange-100">
              {formatBusinessCopy(copy.cancellation.lateWarning, {
                hours: appointment.cancellationPolicyHours || 4,
              })}
            </div>
          )}

          {cancelError ? (
            <div role="alert" className="mt-4 rounded-md border border-red-400/30 bg-red-500/10 p-3 text-left text-sm leading-6 text-red-100">
              {cancelError}
            </div>
          ) : null}

          <div className="mt-6 space-y-3">
            <Button
              variant="destructive"
              className="h-12 w-full text-base"
              onClick={handleCancel}
              disabled={cancelAppointment.isPending}
              aria-busy={cancelAppointment.isPending}
            >
              {cancelAppointment.isPending ? (
                <>
                  <Loader2 aria-hidden="true" className="mx-auto h-5 w-5 animate-spin" />
                  <span className="sr-only">{copy.cancellation.cancellingAria}</span>
                </>
              ) : (
                copy.cancellation.cancelAction
              )}
            </Button>

            <Link href="/">
              <Button variant="ghost" className="h-11 w-full">
                {copy.cancellation.keepAction}
              </Button>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
