import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type CreateAppointmentRequest } from "@shared/routes";

export function useAppointments(params?: { barberId?: string; date?: string; public?: boolean }) {
  return useQuery({
    queryKey: [params?.public ? '/api/appointments/public' : api.appointments.list.path, params],
    queryFn: async () => {
      let url = params?.public ? '/api/appointments/public' : api.appointments.list.path;
      if (params) {
        const queryParams = new URLSearchParams();
        if (params.barberId) queryParams.append("barberId", params.barberId);
        if (params.date) queryParams.append("date", params.date);
        url += `?${queryParams.toString()}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch appointments");
      return res.json();
    },
  });
}

export function useCreateAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateAppointmentRequest) => {
      const res = await fetch(api.appointments.create.path, {
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
      return api.appointments.create.responses[201].parse(await res.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.appointments.list.path] }),
  });
}

export function useUpdateAppointmentStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: "booked" | "completed" | "cancelled" }) => {
      const url = buildUrl(api.appointments.updateStatus.path, { id });
      const res = await fetch(url, {
        method: api.appointments.updateStatus.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      return api.appointments.updateStatus.responses[200].parse(await res.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.appointments.list.path] }),
  });
}

export function useCancelAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) => {
      const url = `/api/appointments/cancel/${token}`;
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Falha ao cancelar marcação");
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.appointments.list.path] }),
  });
}
