import { FormEvent, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button-custom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

type InviteState = "valid" | "used" | "revoked" | "expired" | "invalid";

const inviteStateCopy: Record<Exclude<InviteState, "valid">, string> = {
  used: "Este convite já foi utilizado.",
  revoked: "Este convite foi revogado ou substituído.",
  expired: "Este convite expirou.",
  invalid: "Este convite é inválido.",
};

async function responsePayload(response: Response) {
  return response.json().catch(() => null) as Promise<{ code?: string; message?: string; state?: InviteState } | null>;
}

function stateFromCode(code?: string): Exclude<InviteState, "valid"> | null {
  if (code === "INVITE_USED") return "used";
  if (code === "INVITE_REVOKED") return "revoked";
  if (code === "INVITE_EXPIRED") return "expired";
  if (code === "INVITE_INVALID" || code === "USER_NOT_INVITED") return "invalid";
  return null;
}

export default function UserInvite() {
  const [, navigate] = useLocation();
  const submittingRef = useRef(false);
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token")?.trim() ?? "");
  const [inviteState, setInviteState] = useState<InviteState>(token ? "valid" : "invalid");
  const [checking, setChecking] = useState(Boolean(token));
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    if (!token) return;

    let active = true;
    void apiFetch("/api/user-invites/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ token }),
    }).then(async (response) => {
      const payload = await responsePayload(response);
      if (!active) return;
      if (!response.ok) {
        setInviteState(stateFromCode(payload?.code) ?? "invalid");
        setError(payload?.message || "Não foi possível validar o convite.");
        return;
      }
      setInviteState(payload?.state ?? "invalid");
    }).catch(() => {
      if (active) {
        setInviteState("invalid");
        setError("Não foi possível validar o convite. Tente novamente.");
      }
    }).finally(() => {
      if (active) setChecking(false);
    });

    return () => {
      active = false;
    };
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submittingRef.current || inviteState !== "valid") return;
    setError("");
    if (password.length < 8) {
      setError("Use uma palavra-passe com pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("As palavras-passe não coincidem.");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const response = await apiFetch("/api/user-invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ token, password }),
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        const nextState = stateFromCode(payload?.code);
        if (nextState) setInviteState(nextState);
        throw new Error(payload?.message || "Não foi possível ativar o acesso.");
      }
      setPassword("");
      setConfirmPassword("");
      setSuccess(true);
      queryClient.clear();
      window.setTimeout(() => navigate("/admin"), 900);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível ativar o acesso.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center text-foreground" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <span className="sr-only">A validar convite…</span>
      </main>
    );
  }

  if (inviteState !== "valid") {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-4 text-center text-foreground">
        <Card className="w-full max-w-md border-white/10 bg-card">
          <CardContent className="pt-8">
            <XCircle className="mx-auto mb-4 h-14 w-14 text-red-400" aria-hidden="true" />
            <h1 className="mb-2 text-2xl font-display font-bold">Convite indisponível</h1>
            <p className="text-sm text-muted-foreground">{error || inviteStateCopy[inviteState]}</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4 text-foreground">
      <Card className="w-full max-w-md border-white/10 bg-card">
        <CardHeader>
          <h1 className="text-center text-2xl font-display font-bold text-primary">
            Criar acesso
          </h1>
          <p className="text-center text-sm text-muted-foreground">
            Defina a palavra-passe para ativar o seu utilizador.
          </p>
        </CardHeader>
        <CardContent>
          {success ? (
            <div className="py-8 text-center" role="status">
              <CheckCircle className="mx-auto mb-4 h-16 w-16 text-green-400" aria-hidden="true" />
              <p className="font-bold">Acesso ativado.</p>
              <p className="text-sm text-muted-foreground">A abrir o painel…</p>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submit} aria-busy={submitting}>
              <div className="space-y-2">
                <Label htmlFor="canonical-invite-password">Nova palavra-passe</Label>
                <Input
                  id="canonical-invite-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  maxLength={200}
                  required
                  autoComplete="new-password"
                  disabled={submitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="canonical-invite-confirm-password">Confirmar palavra-passe</Label>
                <Input
                  id="canonical-invite-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  minLength={8}
                  maxLength={200}
                  required
                  autoComplete="new-password"
                  disabled={submitting}
                />
              </div>
              {error ? <p className="rounded-md border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100" role="alert">{error}</p> : null}
              <Button type="submit" variant="gold" className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {submitting ? "A ativar…" : "Definir palavra-passe"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
