import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type CreateAppointmentRequest } from "@shared/routes";
import { apiFetch } from "@/lib/api";

export type AppointmentStatus = "booked" | "completed" | "cancelled" | "late_cancelled" | "no_show";

export type AppointmentRecord = {
  id: number;
  barberId: number;
  serviceId: number | null;
  startTime: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string;
  durationMinutes: number;
  status: AppointmentStatus;
  cancelToken: string;
  cancelledAt: string | null;
  depositRequired: boolean;
  depositReason: string | null;
  createdAt: string | null;
  notificationChannel?: "whatsapp" | "email" | "none";
  notificationSent?: boolean;
};

export type PublicAppointment = {
  id: number;
  barberId: number;
  serviceId: number | null;
  startTime: string;
  duration: number;
};

export type AppointmentByToken = {
  id: number;
  barberId: number;
  serviceId: number | null;
  startTime: string;
  status: AppointmentStatus;
  customerName: string;
  depositRequired: boolean;
  depositReason: string | null;
  cancellationPolicyHours: number;
  isLateCancellation: boolean;
  barberName: string;
  serviceName: string;
  duration: number;
  price: number;
};

export type CancelAppointmentResponse = {
  message: string;
  status?: AppointmentStatus;
  lateCancellation?: boolean;
  policyHours?: number;
  alreadyCancelled?: boolean;
  notificationChannel?: "whatsapp" | "email" | "none";
  notificationSent?: boolean;
};

type AppointmentQueryParams = {
  barberId?: string;
  date?: string;
  startDate?: string;
  endDate?: string;
  enabled?: boolean;
  refetchInterval?: number | false;
};

const PUBLIC_APPOINTMENTS_PATH = "/api/appointments/public";

function appendAppointmentQuery(path: string, params?: AppointmentQueryParams) {
  if (!params?.barberId && !params?.date && !params?.startDate && !params?.endDate) return path;

  const queryParams = new URLSearchParams();
  if (params.barberId) queryParams.append("barberId", params.barberId);
  if (params.date) queryParams.append("date", params.date);
  if (params.startDate) queryParams.append("startDate", params.startDate);
  if (params.endDate) queryParams.append("endDate", params.endDate);
  return `${path}?${queryParams.toString()}`;
}

export function useAppointments(params?: AppointmentQueryParams) {
  return useQuery<AppointmentRecord[]>({
    queryKey: [api.appointments.list.path, params],
    enabled: params?.enabled ?? true,
    refetchInterval: params?.refetchInterval,
    queryFn: async () => {
      const url = appendAppointmentQuery(api.appointments.list.path, params);
      const res = await apiFetch(url);
      if (!res.ok) throw new Error("Failed to fetch appointments");
      return await res.json() as AppointmentRecord[];
    },
  });
}

export function usePublicAppointments(params?: AppointmentQueryParams) {
  return useQuery<PublicAppointment[]>({
    queryKey: [PUBLIC_APPOINTMENTS_PATH, params],
    enabled: params?.enabled ?? true,
    refetchInterval: params?.refetchInterval,
    queryFn: async () => {
      const url = appendAppointmentQuery(PUBLIC_APPOINTMENTS_PATH, params);
      const res = await apiFetch(url);
      if (!res.ok) throw new Error("Failed to fetch public appointments");
      return await res.json() as PublicAppointment[];
    },
  });
}

export function useCreateAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateAppointmentRequest) => {
      const res = await apiFetch(api.appointments.create.path, {
        method: api.appointments.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        if (res.status === 409) {
          throw new Error(err.message || "Este horário já está reservado.");
        }
        throw new Error(err.message || "Falha ao criar marcação");
      }

      return await res.json() as AppointmentRecord;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.appointments.list.path] });
      queryClient.invalidateQueries({ queryKey: [PUBLIC_APPOINTMENTS_PATH] });
    },
  });
}

export function useUpdateAppointmentStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: AppointmentStatus }) => {
      const url = buildUrl(api.appointments.updateStatus.path, { id });
      const res = await apiFetch(url, {
        method: api.appointments.updateStatus.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      return await res.json() as AppointmentRecord;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.appointments.list.path] }),
  });
}

export function useAppointmentByToken(token?: string) {
  return useQuery<AppointmentByToken | null>({
    queryKey: ["/api/appointments/token", token],
    enabled: !!token,
    queryFn: async () => {
      const res = await apiFetch(`/api/appointments/token/${token}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Falha ao carregar marcação");
      return await res.json() as AppointmentByToken;
    },
  });
}

export function useRescheduleAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ token, startTime }: { token: string; startTime: Date }) => {
      const res = await apiFetch(`/api/appointments/reschedule/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTime }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Falha ao reagendar marcação");
      }
      return await res.json() as AppointmentRecord;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.appointments.list.path] });
      queryClient.invalidateQueries({ queryKey: [PUBLIC_APPOINTMENTS_PATH] });
    },
  });
}

export function useCancelAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) => {
      const url = `/api/appointments/cancel/${token}`;
      const res = await apiFetch(url, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Falha ao cancelar marcação");
      }
      return await res.json() as CancelAppointmentResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.appointments.list.path] });
      queryClient.invalidateQueries({ queryKey: [PUBLIC_APPOINTMENTS_PATH] });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/token"] });
    },
  });
}
