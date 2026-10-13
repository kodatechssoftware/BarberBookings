import { FormEvent, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { useBusinessBranding } from "@/business/use-business-branding";

type BootstrapStatus = { available: boolean; configured: boolean };

async function responseMessage(response: Response, fallback: string) {
  try {
    const body = await response.json() as { message?: unknown };
    return typeof body.message === "string" && body.message.trim() ? body.message : fallback;
  } catch {
    return fallback;
  }
}

export default function Setup() {
  const shopBranding = useBusinessBranding();
  const [, navigate] = useLocation();
  const submittingRef = useRef(false);
  const [status, setStatus] = useState<BootstrapStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [token, setToken] = useState("");

  useEffect(() => {
    let active = true;
    void apiFetch("/api/auth/bootstrap/status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseMessage(response, "Configuração inicial indisponível."));
        const value = await response.json() as BootstrapStatus;
        if (active) setStatus(value);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Configuração inicial indisponível.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submittingRef.current) return;
    setError("");
    if (password !== confirmPassword) {
      setError("As palavras-passe não coincidem.");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const response = await apiFetch("/api/auth/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ token, displayName, email, password }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível concluir a configuração inicial."));
      setToken("");
      setPassword("");
      setConfirmPassword("");
      queryClient.clear();
      navigate("/admin");
    } catch (cause) {
      setToken("");
      setPassword("");
      setConfirmPassword("");
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir a configuração inicial.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const unavailable = status && (!status.available || !status.configured);

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground sm:py-16">
      <Card className="mx-auto w-full max-w-md">
        <CardHeader className="items-center text-center">
          <img src={shopBranding.logoUrl} alt={shopBranding.name} className="mb-2 h-20 w-20 rounded-full object-cover" />
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
            <CardTitle>Configuração inicial</CardTitle>
          </div>
          <CardDescription>
            Crie o primeiro administrador desta instalação. Este passo só pode ser concluído uma vez.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8" role="status">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              A verificar a instalação…
            </div>
          ) : unavailable ? (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                {!status.available
                  ? "A configuração inicial já foi concluída."
                  : "O token de configuração inicial não está configurado no servidor."}
              </p>
              <Button type="button" variant="outline" onClick={() => navigate("/admin")}>
                Ir para o acesso administrativo
              </Button>
            </div>
          ) : status ? (
            <form className="space-y-4" onSubmit={submit} aria-busy={submitting}>
              <div className="space-y-2">
                <Label htmlFor="setup-name">Nome</Label>
                <Input id="setup-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={120} autoComplete="name" disabled={submitting} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-email">Email</Label>
                <Input id="setup-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={160} autoComplete="email" disabled={submitting} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-password">Palavra-passe</Label>
                <Input id="setup-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} maxLength={200} autoComplete="new-password" disabled={submitting} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-password-confirm">Confirmar palavra-passe</Label>
                <Input id="setup-password-confirm" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={8} maxLength={200} autoComplete="new-password" disabled={submitting} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-token">Token de configuração</Label>
                <Input id="setup-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} required maxLength={512} autoComplete="off" disabled={submitting} />
              </div>
              {error ? (
                <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              ) : null}
              <Button className="w-full" type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Criar primeiro administrador
              </Button>
            </form>
          ) : (
            <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error || "Configuração inicial indisponível."}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
