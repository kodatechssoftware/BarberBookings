import { useRef, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button-custom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import { useBusinessCopy } from "@/business/use-business-copy";
import { formatBusinessCopy } from "@shared/business/copy/types";

export default function BarberInvite() {
  const publicCycleCopy = useBusinessCopy().publicCycle;
  const copy = publicCycleCopy.invite;
  const [, params] = useRoute("/barber-invite/:token");
  const token = params?.token;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const submittingRef = useRef(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const { data: invite, isLoading, isError } = useQuery({
    queryKey: ["/api/barber-invites", token],
    enabled: Boolean(token),
    queryFn: async () => {
      const res = await apiFetch(`/api/barber-invites/${token}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(copy.loadError);
      return res.json();
    },
  });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;

    if (password.length < 8) {
      toast({ title: copy.shortPasswordTitle, description: copy.shortPasswordDescription, variant: "destructive" });
      return;
    }

    if (password !== confirmPassword) {
      toast({ title: copy.passwordMismatchTitle, description: copy.passwordMismatchDescription, variant: "destructive" });
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const res = await apiFetch(`/api/barber-invites/${token}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || copy.definePasswordError);

      setSuccess(true);
      toast({ title: copy.successTitle, description: copy.successDescription });
      setTimeout(() => navigate("/admin"), 900);
    } catch (error: any) {
      toast({ title: publicCycleCopy.common.genericErrorTitle, description: error.message, variant: "destructive" });
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <div role="status" aria-label={copy.loadingAria} className="min-h-screen bg-background flex items-center justify-center"><Loader2 aria-hidden="true" className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (isError || !invite) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4 text-center text-white">
        <Card className="max-w-md w-full bg-card border-white/10">
          <CardContent className="pt-8">
            <XCircle className="w-14 h-14 text-red-400 mx-auto mb-4" />
            <h1 className="text-2xl font-display font-bold mb-2">{isError ? copy.loadError : copy.invalidTitle}</h1>
            <p className="text-sm text-gray-400">{isError ? copy.loadErrorDescription : copy.invalidDescription}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 text-white">
      <Card className="max-w-md w-full bg-card border-white/10">
        <CardHeader>
          <CardTitle role="heading" aria-level={1} className="text-2xl font-display font-bold text-center text-primary">
            {copy.createAccessTitle}
          </CardTitle>
          <p className="text-center text-sm text-gray-400">
            {formatBusinessCopy(copy.invitationFor, {
              name: invite.barberName,
              email: invite.barberEmail ? ` (${invite.barberEmail})` : "",
            })}
          </p>
          <p className="text-center text-xs leading-5 text-gray-500">{copy.accessScopeDescription}</p>
        </CardHeader>
        <CardContent>
          {success ? (
            <div className="py-8 text-center">
              <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
              <p className="font-bold">{copy.passwordSaved}</p>
              <p className="text-sm text-gray-400">{copy.openingPanel}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-password">{copy.newPasswordLabel}</Label>
                <Input
                  id="invite-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="bg-background border-white/10 text-white"
                  minLength={8}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-password-confirmation">{copy.confirmPasswordLabel}</Label>
                <Input
                  id="invite-password-confirmation"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="bg-background border-white/10 text-white"
                  minLength={8}
                  required
                />
              </div>
              <Button type="submit" variant="gold" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? copy.saving : copy.save}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
