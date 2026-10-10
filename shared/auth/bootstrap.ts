import { z } from "zod";

export const canonicalBootstrapInputSchema = z.object({
  token: z.string().min(1).max(512),
  displayName: z.string().trim().min(1, "Indique o nome do administrador.").max(120),
  email: z.string().trim().email("Indique um email válido.").max(160),
  password: z.string().min(8, "A palavra-passe deve ter pelo menos 8 caracteres.").max(200),
}).strict();

export type CanonicalBootstrapInput = z.infer<typeof canonicalBootstrapInputSchema>;
