import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button-custom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";

export default function BarberInvite() {
  const [, params] = useRoute("/barber-invite/:token");
  const token = params?.token;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const { data: invite, isLoading } = useQuery({
    queryKey: ["/api/barber-invites", token],
    enabled: Boolean(token),
    queryFn: async () => {
      const res = await apiFetch(`/api/barber-invites/${token}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Não foi possível carregar o convite.");
      return res.json();
    },
  });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (password.length < 8) {
      toast({ title: "Palavra-passe curta", description: "Use pelo menos 8 caracteres.", variant: "destructive" });
      return;
    }

    if (password !== confirmPassword) {
      toast({ title: "Confirmação diferente", description: "As palavras-passe não coincidem.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiFetch(`/api/barber-invites/${token}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Não foi possível definir a palavra-passe.");

      setSuccess(true);
      toast({ title: "Acesso criado", description: "Já pode entrar no painel." });
      setTimeout(() => navigate("/admin"), 900);
    } catch (error: any) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (!invite) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4 text-center text-white">
        <Card className="max-w-md w-full bg-card border-white/10">
          <CardContent className="pt-8">
            <XCircle className="w-14 h-14 text-red-400 mx-auto mb-4" />
            <h1 className="text-2xl font-display font-bold mb-2">Convite inválido</h1>
            <p className="text-sm text-gray-400">Este link pode já ter expirado ou já ter sido usado.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 text-white">
      <Card className="max-w-md w-full bg-card border-white/10">
        <CardHeader>
          <CardTitle className="text-2xl font-display font-bold text-center text-primary">
            Criar acesso de barbeiro
          </CardTitle>
          <p className="text-center text-sm text-gray-400">
            Convite para {invite.barberName} {invite.barberEmail ? `(${invite.barberEmail})` : ""}
          </p>
        </CardHeader>
        <CardContent>
          {success ? (
            <div className="py-8 text-center">
              <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
              <p className="font-bold">Palavra-passe definida.</p>
              <p className="text-sm text-gray-400">A abrir o painel...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Nova palavra-passe</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="bg-background border-white/10 text-white"
                  minLength={8}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Confirmar palavra-passe</Label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="bg-background border-white/10 text-white"
                  minLength={8}
                  required
                />
              </div>
              <Button type="submit" variant="gold" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "A guardar..." : "Definir palavra-passe"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
