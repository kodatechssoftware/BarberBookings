import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  Copy,
  KeyRound,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Unlink,
  UserCog,
  UserRound,
} from "lucide-react";
import {
  accessPresets,
  canGrantCapabilityAtLocation,
  capabilityCodes,
  capabilityRegistry,
  hasCapability,
  hasCapabilityAtLocation,
  resolvePresetCapabilities,
  type AccessPresetKey,
  type AccessScope,
  type CapabilityArea,
  type CapabilityCode,
  type EffectiveAccess,
} from "@shared/auth";
import type { ShopLocation } from "@shared/locations";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiFetch } from "@/lib/api";
import { locationHeaders } from "@/lib/location-context";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button-custom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type ManagedCanonicalUser = {
  id: number;
  displayName: string;
  username: string | null;
  email: string;
  status: "invited" | "active" | "disabled";
  authVersion: number;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  professionalId: number | null;
};

type ManagedCanonicalUserDetail = ManagedCanonicalUser & { access: AccessScope[] };

type ProfessionalOption = {
  id: number;
  name: string;
  userId?: number | null;
};

type InviteResult = {
  inviteUrl: string;
  expiresAt: string;
};

type UserAccessManagerProps = {
  enabled: boolean;
  currentUserId: number;
  currentAccess: EffectiveAccess;
  locations: ShopLocation[];
  professionals: ProfessionalOption[];
};

type AccessDraft = {
  key: string;
  kind: "global" | "location";
  locationId: number | null;
  preset: AccessPresetKey | "custom";
  capabilities: CapabilityCode[];
};

const statusCopy: Record<ManagedCanonicalUser["status"], { label: string; className: string }> = {
  invited: { label: "Convidado", className: "border-amber-400/30 bg-amber-500/10 text-amber-200" },
  active: { label: "Ativo", className: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" },
  disabled: { label: "Desativado", className: "border-red-400/30 bg-red-500/10 text-red-200" },
};

const capabilityAreaLabels: Record<CapabilityArea, string> = {
  agenda: "Agenda",
  appointments: "Marcações",
  customers: "Clientes",
  team: "Equipa",
  catalog: "Catálogo",
  hours: "Horários",
  extras: "Extras",
  finance: "Financeiro",
  reports: "Relatórios",
  locations: "Localizações",
  users: "Utilizadores",
  access: "Acessos",
  settings: "Configuração",
  audit: "Auditoria",
  system: "Sistema",
};

const capabilityLabels: Record<CapabilityCode, string> = {
  "agenda.view_own": "Ver a própria agenda",
  "agenda.view_team": "Ver a agenda da equipa",
  "appointments.create_manual": "Criar marcações manuais",
  "appointments.block_time": "Criar ausências e bloqueios",
  "appointments.manage_own": "Gerir as próprias marcações",
  "appointments.manage_team": "Gerir marcações da equipa",
  "appointments.change_status_own": "Alterar o estado das próprias marcações",
  "appointments.change_status_team": "Alterar o estado das marcações da equipa",
  "customers.view_own": "Ver os próprios clientes",
  "customers.view_team": "Ver clientes da equipa",
  "customers.notes_own": "Gerir notas dos próprios clientes",
  "customers.notes_team": "Gerir notas de clientes da equipa",
  "customers.block": "Bloquear e desbloquear clientes",
  "team.view": "Ver a equipa",
  "team.manage_global": "Gerir identidades profissionais globais",
  "team.assign_location": "Associar profissionais a localizações",
  "catalog.view": "Ver o catálogo",
  "catalog.manage_global": "Gerir identidade global de serviços e categorias",
  "catalog.manage_location": "Gerir a oferta de serviços da localização",
  "hours.manage_own": "Gerir o próprio horário",
  "hours.manage_team": "Gerir horários da equipa",
  "hours.manage_establishment": "Gerir o horário do estabelecimento",
  "extras.manage": "Gerir o catálogo de Extras",
  "finance.view_own": "Ver os próprios resultados financeiros",
  "finance.view_team": "Ver resultados financeiros da equipa",
  "finance.manage_expenses": "Gerir despesas",
  "finance.manage_compensation": "Gerir compensação profissional",
  "reports.export_own": "Exportar o próprio relatório",
  "reports.export_team": "Exportar relatórios da equipa",
  "locations.manage": "Gerir localizações",
  "users.manage": "Gerir identidades de utilizador",
  "access.manage": "Gerir acessos e permissões",
  "settings.manage": "Gerir configuração da instalação",
  "audit.view": "Ver o registo de auditoria",
  "system.diagnostics": "Usar diagnósticos protegidos",
};

function accessScopeKey(scope: AccessScope, index: number) {
  return scope.kind === "global" ? `global-${index}` : `location-${scope.locationId}-${index}`;
}

function toAccessDrafts(scopes: readonly AccessScope[]): AccessDraft[] {
  return scopes.map((scope, index) => ({
    key: accessScopeKey(scope, index),
    kind: scope.kind,
    locationId: scope.kind === "location" ? scope.locationId : null,
    preset: scope.preset ?? "custom",
    capabilities: [...(scope.capabilities ?? [])],
  }));
}

function toAccessScopes(drafts: readonly AccessDraft[]): AccessScope[] {
  return drafts.map((draft) => draft.kind === "global"
    ? {
        kind: "global" as const,
        ...(draft.preset !== "custom" ? { preset: draft.preset } : {}),
        capabilities: draft.capabilities,
      }
    : {
        kind: "location" as const,
        locationId: draft.locationId!,
        ...(draft.preset !== "custom" ? { preset: draft.preset } : {}),
        capabilities: draft.capabilities,
      });
}

export function isGlobalAdministrator(scopes: readonly AccessScope[]) {
  return scopes.some((scope) => scope.kind === "global" && scope.preset === "administrator");
}

export function canActorGrantScope(
  actorAccess: EffectiveAccess,
  scope: Pick<AccessDraft, "kind" | "locationId" | "preset" | "capabilities">,
) {
  if (scope.kind === "global") {
    if (!hasCapability(actorAccess, "access.manage")) return false;
    if (scope.preset === "administrator"
      && !capabilityCodes.every((capability) => hasCapability(actorAccess, capability))) return false;
    const capabilities = scope.preset === "custom"
      ? scope.capabilities
      : [...resolvePresetCapabilities(scope.preset), ...scope.capabilities];
    return capabilities.every((capability) => hasCapability(actorAccess, capability));
  }
  if (!scope.locationId || !hasCapabilityAtLocation(actorAccess, "access.manage", scope.locationId)) return false;
  if (scope.preset === "administrator") return false;
  const capabilities = scope.preset === "custom"
    ? scope.capabilities
    : [...resolvePresetCapabilities(scope.preset), ...scope.capabilities];
  return capabilities.every((capability) => canGrantCapabilityAtLocation(capability)
    && hasCapabilityAtLocation(actorAccess, capability, scope.locationId!));
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function scopeSummary(scope: AccessScope, locations: readonly ShopLocation[]) {
  const context = scope.kind === "global"
    ? "Global"
    : locations.find((location) => location.id === scope.locationId)?.name ?? `Localização #${scope.locationId}`;
  const preset = scope.preset ? accessPresets[scope.preset].label : "Personalizado";
  const explicitCount = scope.capabilities?.length ?? 0;
  return `${context}: ${preset}${explicitCount ? ` + ${explicitCount}` : ""}`;
}

function AccessEditor({
  value,
  onChange,
  actorAccess,
  locations,
  disabled,
  lastAdministrator,
}: {
  value: AccessDraft[];
  onChange: (value: AccessDraft[]) => void;
  actorAccess: EffectiveAccess;
  locations: ShopLocation[];
  disabled?: boolean;
  lastAdministrator?: boolean;
}) {
  const canManageGlobal = hasCapability(actorAccess, "access.manage");
  const manageableLocations = locations.filter((location) =>
    hasCapabilityAtLocation(actorAccess, "access.manage", location.id));
  const usedLocationIds = new Set(value.flatMap((scope) =>
    scope.kind === "location" && scope.locationId ? [scope.locationId] : []));
  const canAddGlobal = canManageGlobal && !value.some((scope) => scope.kind === "global");
  const availableLocations = manageableLocations.filter((location) => !usedLocationIds.has(location.id));

  const updateScope = (key: string, patch: Partial<AccessDraft>) => {
    onChange(value.map((scope) => scope.key === key ? { ...scope, ...patch } : scope));
  };

  const removeScope = (scope: AccessDraft) => {
    if (lastAdministrator && scope.kind === "global" && scope.preset === "administrator") return;
    onChange(value.filter((candidate) => candidate.key !== scope.key));
  };

  const addGlobal = () => onChange([...value, {
    key: `global-${Date.now()}`,
    kind: "global",
    locationId: null,
    preset: resolvePresetCapabilities("professional").every((capability) =>
      hasCapability(actorAccess, capability)) ? "professional" : "custom",
    capabilities: [],
  }]);

  const addLocation = (locationId: number) => onChange([...value, {
    key: `location-${locationId}-${Date.now()}`,
    kind: "location",
    locationId,
    preset: resolvePresetCapabilities("professional").every((capability) =>
      hasCapabilityAtLocation(actorAccess, capability, locationId)) ? "professional" : "custom",
    capabilities: [],
  }]);

  return (
    <div className="space-y-4" data-testid="access-editor">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="font-semibold text-white">Acesso</h4>
          <p className="text-xs text-gray-400">O vínculo a um Profissional não concede permissões por si só.</p>
        </div>
        {!disabled && (
          <div className="flex flex-col gap-2 min-[420px]:flex-row">
            <Button type="button" variant="outline" size="sm" disabled={!canAddGlobal} onClick={addGlobal}>
              Acesso global
            </Button>
            <Select
              value=""
              onValueChange={(raw) => addLocation(Number(raw))}
              disabled={availableLocations.length === 0}
            >
              <SelectTrigger className="h-9 min-w-48 border-white/10 bg-background" aria-label="Adicionar acesso por localização">
                <SelectValue placeholder="Acesso por localização" />
              </SelectTrigger>
              <SelectContent>
                {availableLocations.map((location) => (
                  <SelectItem key={location.id} value={String(location.id)}>{location.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {value.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/15 p-4 text-sm text-gray-400">
          Sem acesso atribuído.
        </div>
      ) : value.map((scope) => {
        const locationName = scope.kind === "location"
          ? locations.find((location) => location.id === scope.locationId)?.name ?? `Localização #${scope.locationId}`
          : "Toda a instalação";
        const scopeGrantable = canActorGrantScope(actorAccess, scope);
        const protectsLastAdministrator = Boolean(
          lastAdministrator && scope.kind === "global" && scope.preset === "administrator",
        );
        const allowedCapabilities = capabilityCodes.filter((capability) =>
          scope.kind === "global"
            ? hasCapability(actorAccess, capability)
            : Boolean(scope.locationId
              && canGrantCapabilityAtLocation(capability)
              && hasCapabilityAtLocation(actorAccess, capability, scope.locationId)),
        );
        const capabilitiesByArea = allowedCapabilities.reduce((groups, capability) => {
          const area = capabilityRegistry[capability].area;
          const group = groups.get(area) ?? [];
          group.push(capability);
          groups.set(area, group);
          return groups;
        }, new Map<CapabilityArea, CapabilityCode[]>());
        const canUseAdministrator = scope.kind === "global"
          && capabilityCodes.every((capability) => hasCapability(actorAccess, capability));
        const canUseProfessional = resolvePresetCapabilities("professional").every((capability) =>
          scope.kind === "global"
            ? hasCapability(actorAccess, capability)
            : Boolean(scope.locationId && hasCapabilityAtLocation(actorAccess, capability, scope.locationId)));

        return (
          <section key={scope.key} className="rounded-xl border border-white/10 bg-background/40 p-4" aria-label={`Acesso ${locationName}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0 flex-1">
                <Label htmlFor={`preset-${scope.key}`}>{scope.kind === "global" ? "Âmbito global" : locationName}</Label>
                <Select
                  value={scope.preset}
                  disabled={disabled || protectsLastAdministrator || !scopeGrantable}
                  onValueChange={(preset) => updateScope(scope.key, {
                    preset: preset as AccessDraft["preset"],
                    capabilities: [],
                  })}
                >
                  <SelectTrigger id={`preset-${scope.key}`} className="mt-2 border-white/10 bg-card" aria-label={`Preset de ${locationName}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {canUseAdministrator && <SelectItem value="administrator">Administrator</SelectItem>}
                    {canUseProfessional && <SelectItem value="professional">Professional</SelectItem>}
                    <SelectItem value="custom">Personalizado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {!disabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-red-300 hover:text-red-200"
                  disabled={protectsLastAdministrator || !scopeGrantable}
                  title={protectsLastAdministrator ? "O último Administrator global ativo não pode perder acesso." : undefined}
                  onClick={() => removeScope(scope)}
                >
                  Remover âmbito
                </Button>
              )}
            </div>

            {scope.preset !== "custom" && (
              <p className="mt-3 text-xs text-gray-400">
                {accessPresets[scope.preset].description} Pode acrescentar permissões explícitas abaixo.
              </p>
            )}
            {!scopeGrantable && (
              <p role="alert" className="mt-3 rounded-md border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                Este âmbito contém acesso acima do seu teto de concessão e fica apenas em leitura.
              </p>
            )}

            <details className="mt-4 rounded-lg border border-white/10 p-3">
              <summary className="cursor-pointer text-sm font-medium text-white">
                Permissões explícitas ({scope.capabilities.length})
              </summary>
              <div className="mt-4 space-y-4">
                {Array.from(capabilitiesByArea.entries()).map(([area, capabilities]) => (
                  <fieldset key={area} className="space-y-2">
                    <legend className="text-xs font-semibold uppercase tracking-wide text-primary">
                      {capabilityAreaLabels[area]}
                    </legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {capabilities.map((capability) => {
                        const checked = scope.capabilities.includes(capability);
                        const inherited = scope.preset !== "custom"
                          && resolvePresetCapabilities(scope.preset).includes(capability as never);
                        return (
                          <label key={capability} className={cn(
                            "flex items-start gap-3 rounded-md border border-white/5 p-2 text-xs",
                            inherited ? "bg-primary/5 text-gray-400" : "bg-card text-gray-200",
                          )}>
                            <Checkbox
                              checked={checked || inherited}
                              disabled={disabled || inherited || !scopeGrantable}
                              aria-label={capabilityLabels[capability]}
                              onCheckedChange={(next) => updateScope(scope.key, {
                                capabilities: next
                                  ? [...scope.capabilities, capability]
                                  : scope.capabilities.filter((item) => item !== capability),
                              })}
                            />
                            <span>
                              {capabilityLabels[capability]}
                              {inherited && <span className="ml-1 text-[10px] text-primary">(incluída no preset)</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
              </div>
            </details>
          </section>
        );
      })}
    </div>
  );
}

function InviteLinkDialog({ result, onClose }: { result: InviteResult | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const close = () => {
    setCopied(false);
    setCopyError(false);
    onClose();
  };
  const copyLink = async () => {
    if (!result) return;
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(result.inviteUrl);
      setCopied(true);
    } catch {
      inputRef.current?.focus();
      inputRef.current?.select();
      setCopyError(true);
    }
  };
  return (
    <Dialog open={Boolean(result)} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="w-[calc(100vw-1rem)] border-white/10 bg-card text-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Convite pronto</DialogTitle>
          <DialogDescription>
            Copie este link agora. Por segurança, o token não volta a ser apresentado.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Label htmlFor="canonical-invite-url">Link de convite</Label>
          <div className="flex gap-2">
            <Input ref={inputRef} id="canonical-invite-url" readOnly value={result?.inviteUrl ?? ""} className="border-white/10 bg-background" />
            <Button type="button" variant="outline" size="icon" aria-label="Copiar link de convite" onClick={() => void copyLink()}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          {copyError && <p role="alert" className="text-xs text-amber-200">Não foi possível copiar automaticamente. O link ficou selecionado para copiar manualmente.</p>}
          <p className="text-xs text-gray-400">Válido até {result ? new Date(result.expiresAt).toLocaleString("pt-PT") : ""}.</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="gold" onClick={close}>Concluir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UserAccessManager({
  enabled,
  currentUserId,
  currentAccess,
  locations,
  professionals,
}: UserAccessManagerProps) {
  const { toast } = useToast();
  const pendingRef = useRef(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [professionalId, setProfessionalId] = useState<string>("none");
  const [accessDrafts, setAccessDrafts] = useState<AccessDraft[]>([]);

  const canManageGlobalAccess = hasCapability(currentAccess, "access.manage");
  const manageableLocations = locations.filter((location) =>
    hasCapabilityAtLocation(currentAccess, "access.manage", location.id));
  const canCreateWithAccess = canManageGlobalAccess || manageableLocations.length > 0;

  const usersQuery = useQuery<ManagedCanonicalUserDetail[]>({
    queryKey: ["/api/admin/users", "with-access"],
    enabled,
    queryFn: async () => {
      const listResponse = await apiRequest("GET", "/api/admin/users");
      const listedUsers = await listResponse.json() as ManagedCanonicalUser[];
      return Promise.all(listedUsers.map(async (user) => {
        const response = await apiRequest("GET", `/api/admin/users/${user.id}`);
        return response.json();
      }));
    },
  });
  const professionalOptionsQuery = useQuery<ProfessionalOption[]>({
    queryKey: ["/api/admin/users", "professional-options", locations.map((location) => location.id).join(",")],
    enabled: enabled && locations.length > 0,
    queryFn: async () => {
      const byId = new Map<number, ProfessionalOption>();
      for (const location of locations) {
        const response = await apiFetch("/api/barbers?includeHidden=true&avatarMode=reference", {
          headers: locationHeaders(location.id),
        });
        if (!response.ok) throw new Error("Não foi possível carregar os Profissionais.");
        const locationProfessionals = await response.json() as ProfessionalOption[];
        locationProfessionals.forEach((professional) => byId.set(professional.id, professional));
      }
      return Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name, "pt"));
    },
  });
  const allProfessionals = professionalOptionsQuery.data ?? professionals;
  const users = usersQuery.data ?? [];
  const editingUser = users.find((user) => user.id === editingUserId) ?? null;
  const activeGlobalAdministrators = users.filter((user) =>
    user.status === "active" && isGlobalAdministrator(user.access));
  const isEditingLastAdministrator = Boolean(
    editingUser
    && editingUser.status === "active"
    && isGlobalAdministrator(editingUser.access)
    && activeGlobalAdministrators.length === 1,
  );
  const linkedProfessionalIds = new Set(users.flatMap((user) =>
    user.professionalId && user.id !== editingUserId ? [user.professionalId] : []));
  const availableProfessionals = allProfessionals.filter((professional) =>
    !linkedProfessionalIds.has(professional.id));

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/barbers"] }),
    ]);
  };

  const beginPending = (key: string) => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPendingAction(key);
    return true;
  };
  const endPending = () => {
    pendingRef.current = false;
    setPendingAction(null);
  };

  const defaultScope = (): AccessDraft[] => {
    const location = manageableLocations[0];
    if (location) return [{
      key: `location-${location.id}-new`,
      kind: "location",
      locationId: location.id,
      preset: resolvePresetCapabilities("professional").every((capability) =>
        hasCapabilityAtLocation(currentAccess, capability, location.id)) ? "professional" : "custom",
      capabilities: [],
    }];
    return canManageGlobalAccess
      ? [{
          key: "global-new",
          kind: "global",
          locationId: null,
          preset: resolvePresetCapabilities("professional").every((capability) =>
            hasCapability(currentAccess, capability)) ? "professional" : "custom",
          capabilities: [],
        }]
      : [];
  };

  const openCreate = () => {
    setDisplayName("");
    setEmail("");
    setProfessionalId("none");
    setAccessDrafts(defaultScope());
    setFormError(null);
    setCreateOpen(true);
  };

  const openEdit = (user: ManagedCanonicalUserDetail) => {
    setDisplayName(user.displayName);
    setEmail(user.email);
    setProfessionalId(user.professionalId ? String(user.professionalId) : "none");
    setAccessDrafts(toAccessDrafts(user.access));
    setFormError(null);
    setEditingUserId(user.id);
  };

  const validateIdentityAndAccess = () => {
    if (!displayName.trim()) return "Indique o nome do utilizador.";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return "Indique um email válido.";
    if (accessDrafts.length === 0) return "Atribua pelo menos um âmbito de acesso.";
    if (accessDrafts.some((scope) => scope.kind === "location" && !scope.locationId)) return "Indique a localização do acesso.";
    if (accessDrafts.some((scope) => scope.preset === "custom" && scope.capabilities.length === 0)) {
      return "Um âmbito personalizado precisa de pelo menos uma permissão.";
    }
    if (accessDrafts.some((scope) => !canActorGrantScope(currentAccess, scope))) {
      return "Não pode conceder acesso acima do seu teto de permissões.";
    }
    return null;
  };

  const createUser = async () => {
    const validation = validateIdentityAndAccess();
    if (validation) {
      setFormError(validation);
      return;
    }
    if (!beginPending("create")) return;
    setFormError(null);
    try {
      const response = await apiRequest("POST", "/api/admin/users", {
        displayName: displayName.trim(),
        email: email.trim(),
        professionalId: professionalId === "none" ? null : Number(professionalId),
        access: toAccessScopes(accessDrafts),
      });
      const result = await response.json() as { user: ManagedCanonicalUserDetail } & InviteResult;
      setCreateOpen(false);
      setInviteResult({ inviteUrl: result.inviteUrl, expiresAt: result.expiresAt });
      await refresh();
      toast({ title: "Utilizador convidado", description: "A identidade e o acesso foram criados." });
    } catch (error) {
      setFormError(getErrorMessage(error, "Não foi possível convidar o utilizador."));
    } finally {
      endPending();
    }
  };

  const saveIdentity = async () => {
    if (!editingUser || !beginPending(`identity-${editingUser.id}`)) return;
    setFormError(null);
    try {
      if (!displayName.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) {
        throw new Error("Indique um nome e email válidos.");
      }
      if (displayName.trim() !== editingUser.displayName || email.trim().toLowerCase() !== editingUser.email.toLowerCase()) {
        await apiRequest("PATCH", `/api/admin/users/${editingUser.id}`, {
          displayName: displayName.trim(),
          email: email.trim(),
        });
      }
      await refresh();
      toast({ title: "Identidade atualizada", description: "O nome e o email estão atualizados." });
    } catch (error) {
      setFormError(getErrorMessage(error, "Não foi possível atualizar a identidade."));
    } finally {
      endPending();
    }
  };

  const saveProfessional = async () => {
    if (!editingUser || !beginPending(`professional-${editingUser.id}`)) return;
    setFormError(null);
    try {
      const nextProfessionalId = professionalId === "none" ? null : Number(professionalId);
      if (nextProfessionalId !== editingUser.professionalId) {
        await apiRequest("PUT", `/api/admin/users/${editingUser.id}/professional`, {
          professionalId: nextProfessionalId,
        });
      }
      await refresh();
      toast({
        title: "Vínculo atualizado",
        description: nextProfessionalId === null ? "Professional desassociado." : "Professional associado.",
      });
    } catch (error) {
      setFormError(getErrorMessage(error, "Não foi possível atualizar o vínculo Professional."));
    } finally {
      endPending();
    }
  };

  const saveAccess = async () => {
    if (!editingUser || !beginPending(`access-${editingUser.id}`)) return;
    setFormError(null);
    try {
      if (isEditingLastAdministrator && !accessDrafts.some((scope) =>
        scope.kind === "global" && scope.preset === "administrator")) {
        throw new Error("O último Administrator global ativo não pode ser despromovido.");
      }
      if (canManageGlobalAccess) {
        if (accessDrafts.some((scope) => !canActorGrantScope(currentAccess, scope))) {
          throw new Error("Não pode conceder acesso acima do seu teto de permissões.");
        }
        await apiRequest("PUT", `/api/admin/users/${editingUser.id}/access`, {
          mode: "replace_all",
          scopes: toAccessScopes(accessDrafts),
        });
      } else {
        const editableLocationIds = new Set(manageableLocations.map((location) => location.id));
        const original = editingUser.access.filter(
          (scope): scope is Extract<AccessScope, { kind: "location" }> =>
            scope.kind === "location" && editableLocationIds.has(scope.locationId),
        );
        const current = accessDrafts.filter((scope) => scope.kind === "location" && scope.locationId && editableLocationIds.has(scope.locationId));
        const locationIds = new Set<number>([
          ...original.map((scope) => scope.locationId),
          ...current.map((scope) => scope.locationId!),
        ]);
        for (const locationId of Array.from(locationIds)) {
          const scope = current.find((candidate) => candidate.locationId === locationId);
          if (scope && !canActorGrantScope(currentAccess, scope)) {
            throw new Error("Não pode conceder acesso acima do seu teto de permissões.");
          }
          await apiRequest("PUT", `/api/admin/users/${editingUser.id}/access`, {
            mode: "replace_location",
            locationId,
            scopes: scope ? toAccessScopes([scope]) : [],
          });
        }
      }
      await refresh();
      toast({ title: "Acesso atualizado", description: "Os âmbitos e permissões foram guardados." });
    } catch (error) {
      setFormError(getErrorMessage(error, "Não foi possível atualizar o acesso."));
    } finally {
      endPending();
    }
  };

  const performUserAction = async (
    key: string,
    request: () => Promise<Response>,
    success: string,
  ) => {
    if (!beginPending(key)) return;
    try {
      await request();
      await refresh();
      toast({ title: "Concluído", description: success });
    } catch (error) {
      toast({
        title: "Não foi possível concluir a ação",
        description: getErrorMessage(error, "Tente novamente."),
        variant: "destructive",
      });
    } finally {
      endPending();
    }
  };

  const resendInvite = async (user: ManagedCanonicalUserDetail) => {
    if (!beginPending(`invite-${user.id}`)) return;
    try {
      const response = await apiRequest("POST", `/api/admin/users/${user.id}/invites`, {});
      setInviteResult(await response.json());
      await refresh();
    } catch (error) {
      toast({ title: "Não foi possível reenviar o convite", description: getErrorMessage(error, "Tente novamente."), variant: "destructive" });
    } finally {
      endPending();
    }
  };

  const loading = usersQuery.isLoading;
  const loadError = usersQuery.isError;

  return (
    <>
      <Card className="border-white/10 bg-card text-white" data-testid="user-access-manager">
        <CardHeader className="border-b border-white/10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <UserCog className="h-5 w-5 text-primary" /> Utilizadores e acessos
              </CardTitle>
              <p className="mt-2 max-w-2xl text-sm text-gray-400">
                Gerir identidade, vínculo profissional e permissões como conceitos independentes.
              </p>
            </div>
            <Button variant="gold" className="w-full gap-2 sm:w-auto" disabled={!canCreateWithAccess} onClick={openCreate}>
              <Plus className="h-4 w-4" /> Convidar utilizador
            </Button>
          </div>
          {!canCreateWithAccess && (
            <p role="note" className="text-xs text-amber-200">Pode gerir identidades, mas não tem `access.manage` para atribuir o acesso inicial.</p>
          )}
        </CardHeader>
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin text-primary" /> A carregar utilizadores...
            </div>
          ) : loadError ? (
            <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
              <p>Não foi possível carregar os utilizadores.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void usersQuery.refetch()}>Tentar novamente</Button>
            </div>
          ) : users.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/15 p-8 text-center text-sm text-gray-400">
              Ainda não existem utilizadores canónicos.
            </div>
          ) : (
            <div className="space-y-3">
              {users.map((managedUser) => {
                const professional = allProfessionals.find((item) => item.id === managedUser.professionalId);
                const globalAdministrator = isGlobalAdministrator(managedUser.access);
                const lastAdministrator = managedUser.status === "active" && globalAdministrator
                  && activeGlobalAdministrators.length === 1;
                const isSelf = managedUser.id === currentUserId;
                return (
                  <article key={managedUser.id} className="rounded-xl border border-white/10 bg-background/40 p-4" data-testid={`managed-user-${managedUser.id}`}>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate font-semibold text-white">{managedUser.displayName}</h3>
                          <Badge variant="outline" className={statusCopy[managedUser.status].className}>{statusCopy[managedUser.status].label}</Badge>
                          {globalAdministrator && <Badge className="bg-primary text-primary-foreground">Administrator global</Badge>}
                          {managedUser.professionalId && <Badge variant="secondary">Professional associado</Badge>}
                          {isSelf && <Badge variant="outline">A sua conta</Badge>}
                        </div>
                        <p className="break-all text-sm text-gray-300">{managedUser.email}</p>
                        <p className="text-xs text-gray-400">
                          {managedUser.professionalId
                            ? `Professional: ${professional?.name ?? `#${managedUser.professionalId}`}`
                            : "Sem Professional associado"}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {managedUser.access.map((scope, index) => (
                            <span key={accessScopeKey(scope, index)} className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-gray-300">
                              {scopeSummary(scope, locations)}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="grid shrink-0 grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:flex">
                        <Button variant="outline" size="sm" onClick={() => openEdit(managedUser)}>Editar</Button>
                        {managedUser.status === "invited" ? (
                          <>
                            <Button variant="outline" size="sm" disabled={Boolean(pendingAction)} onClick={() => void resendInvite(managedUser)}>
                              {pendingAction === `invite-${managedUser.id}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                              Reenviar convite
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-300 hover:text-red-200"
                              disabled={Boolean(pendingAction)}
                              onClick={() => void performUserAction(
                                `revoke-invite-${managedUser.id}`,
                                () => apiRequest("DELETE", `/api/admin/users/${managedUser.id}/invites`),
                                "Convites pendentes revogados.",
                              )}
                            >Revogar convite</Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={Boolean(pendingAction) || (managedUser.status === "active" && (isSelf || lastAdministrator))}
                              title={lastAdministrator ? "O último Administrator global ativo não pode ser desativado." : isSelf ? "Não pode desativar a sua própria conta." : undefined}
                              onClick={() => void performUserAction(
                                `status-${managedUser.id}`,
                                () => apiRequest("PUT", `/api/admin/users/${managedUser.id}/status`, {
                                  status: managedUser.status === "active" ? "disabled" : "active",
                                }),
                                managedUser.status === "active" ? "Utilizador desativado." : "Utilizador reativado.",
                              )}
                            >{managedUser.status === "active" ? "Desativar" : "Reativar"}</Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={Boolean(pendingAction)}
                              onClick={() => void performUserAction(
                                `sessions-${managedUser.id}`,
                                () => apiRequest("POST", `/api/admin/users/${managedUser.id}/revoke-sessions`, {}),
                                isSelf ? "Sessões revogadas. Terá de iniciar sessão novamente." : "Sessões revogadas.",
                              )}
                            ><KeyRound className="mr-2 h-4 w-4" />Revogar sessões</Button>
                          </>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={(open) => { if (!pendingAction) setCreateOpen(open); }}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-1rem)] overflow-y-auto border-white/10 bg-card text-white sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Convidar novo utilizador</DialogTitle>
            <DialogDescription>Cria uma identidade canónica e um convite de ativação. Nenhuma palavra-passe é apresentada ao Admin.</DialogDescription>
          </DialogHeader>
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-user-name">Nome</Label>
                <Input id="new-user-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="border-white/10 bg-background" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-user-email">Email</Label>
                <Input id="new-user-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="border-white/10 bg-background" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-user-professional">Professional associado (opcional)</Label>
              <Select value={professionalId} onValueChange={setProfessionalId}>
                <SelectTrigger id="new-user-professional" className="border-white/10 bg-background" aria-label="Professional associado">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem Professional</SelectItem>
                  {availableProfessionals.map((professional) => (
                    <SelectItem key={professional.id} value={String(professional.id)}>{professional.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <AccessEditor value={accessDrafts} onChange={setAccessDrafts} actorAccess={currentAccess} locations={locations} />
            {formError && <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{formError}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={Boolean(pendingAction)} onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button type="button" variant="gold" disabled={Boolean(pendingAction)} onClick={() => void createUser()}>
              {pendingAction === "create" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Criar e gerar convite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingUser)} onOpenChange={(open) => { if (!open && !pendingAction) setEditingUserId(null); }}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-1rem)] overflow-y-auto border-white/10 bg-card text-white sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Editar utilizador</DialogTitle>
            <DialogDescription>Identidade, Professional e acesso são geridos separadamente.</DialogDescription>
          </DialogHeader>
          {editingUser && (
            <div className="space-y-6">
              <section className="space-y-4 rounded-xl border border-white/10 bg-background/40 p-4">
                <div className="flex items-center gap-2 font-semibold"><UserRound className="h-4 w-4 text-primary" /> Identidade</div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="edit-user-name">Nome</Label>
                    <Input id="edit-user-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="border-white/10 bg-card" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-user-email">Email</Label>
                    <Input id="edit-user-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="border-white/10 bg-card" />
                  </div>
                </div>
                <Button type="button" variant="outline" disabled={Boolean(pendingAction)} onClick={() => void saveIdentity()}>
                  {pendingAction === `identity-${editingUser.id}` && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar identidade
                </Button>
              </section>

              <section className="space-y-4 rounded-xl border border-white/10 bg-background/40 p-4">
                <div className="flex items-center gap-2 font-semibold"><Link2 className="h-4 w-4 text-primary" /> Professional</div>
                <p className="text-xs text-gray-400">Associação funcional opcional. Não concede permissões automaticamente.</p>
                <div className="space-y-2">
                  <Label htmlFor="edit-user-professional">Professional associado</Label>
                  <Select value={professionalId} onValueChange={setProfessionalId}>
                    <SelectTrigger id="edit-user-professional" className="border-white/10 bg-card" aria-label="Vínculo Professional">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none"><span className="inline-flex items-center gap-2"><Unlink className="h-3.5 w-3.5" /> Sem Professional</span></SelectItem>
                      {availableProfessionals.map((professional) => (
                        <SelectItem key={professional.id} value={String(professional.id)}>
                          <span className="inline-flex items-center gap-2"><Link2 className="h-3.5 w-3.5" /> {professional.name}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" variant="outline" disabled={Boolean(pendingAction)} onClick={() => void saveProfessional()}>
                  {pendingAction === `professional-${editingUser.id}` && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar vínculo Professional
                </Button>
              </section>

              <section className="space-y-4 rounded-xl border border-white/10 bg-background/40 p-4">
                <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-primary" /> Perfis e permissões</div>
                <AccessEditor
                  value={accessDrafts}
                  onChange={setAccessDrafts}
                  actorAccess={currentAccess}
                  locations={locations}
                  disabled={!canManageGlobalAccess && manageableLocations.length === 0}
                  lastAdministrator={isEditingLastAdministrator}
                />
                <Button
                  type="button"
                  variant="gold"
                  disabled={Boolean(pendingAction) || (!canManageGlobalAccess && manageableLocations.length === 0)}
                  onClick={() => void saveAccess()}
                >
                  {pendingAction === `access-${editingUser.id}` && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar acesso
                </Button>
              </section>
              {formError && <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{formError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={Boolean(pendingAction)} onClick={() => setEditingUserId(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InviteLinkDialog result={inviteResult} onClose={() => setInviteResult(null)} />
    </>
  );
}
