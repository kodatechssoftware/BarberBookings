import { z } from "zod";

export const teamProfileSlugSchema = z.string().trim().min(1).max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use apenas letras minúsculas, números e hífenes no endereço público.");

export const teamQualificationKinds = ["course", "training", "diploma", "certification"] as const;

export const teamQualificationInputSchema = z.object({
  id: z.number().int().positive().optional(),
  kind: z.enum(teamQualificationKinds),
  title: z.string().trim().min(1, "Indique o nome da formação.").max(160),
  issuer: z.string().trim().max(160).nullable().optional(),
  completedYear: z.number().int().min(1900).max(2200).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  displayOrder: z.number().int().min(0).max(2_147_483_647),
  isPublished: z.boolean(),
  publicationAuthorized: z.boolean(),
}).superRefine((value, context) => {
  if (value.isPublished && !value.publicationAuthorized) {
    context.addIssue({ code: "custom", path: ["publicationAuthorized"], message: "Confirme a autorização antes de publicar a qualificação." });
  }
});

export const teamTestimonialInputSchema = z.object({
  id: z.number().int().positive().optional(),
  authorDisplayName: z.string().trim().min(1, "Indique o nome público da cliente.").max(100),
  quote: z.string().trim().min(1, "Indique o testemunho.").max(1200),
  sourceLabel: z.string().trim().max(120).nullable().optional(),
  displayOrder: z.number().int().min(0).max(2_147_483_647),
  isPublished: z.boolean(),
  publicationAuthorized: z.boolean(),
}).superRefine((value, context) => {
  if (value.isPublished && !value.publicationAuthorized) {
    context.addIssue({ code: "custom", path: ["publicationAuthorized"], message: "Confirme a autorização da cliente antes de publicar o testemunho." });
  }
});

export const teamProfileUpdateSchema = z.object({
  slug: teamProfileSlugSchema,
  bio: z.string().trim().max(2000).nullable(),
  displayOrder: z.number().int().min(0).max(2_147_483_647),
  isPublished: z.boolean(),
  publicationAuthorized: z.boolean(),
  qualifications: z.array(teamQualificationInputSchema).max(100),
  testimonials: z.array(teamTestimonialInputSchema).max(100),
}).strict().superRefine((value, context) => {
  if (value.isPublished && !value.publicationAuthorized) {
    context.addIssue({ code: "custom", path: ["publicationAuthorized"], message: "Confirme a autorização da profissional antes de publicar o perfil." });
  }
  const qualificationIds = value.qualifications.flatMap((item) => item.id ? [item.id] : []);
  const testimonialIds = value.testimonials.flatMap((item) => item.id ? [item.id] : []);
  if (new Set(qualificationIds).size !== qualificationIds.length) {
    context.addIssue({ code: "custom", path: ["qualifications"], message: "Existem formações repetidas." });
  }
  if (new Set(testimonialIds).size !== testimonialIds.length) {
    context.addIssue({ code: "custom", path: ["testimonials"], message: "Existem testemunhos repetidos." });
  }
});

export type TeamProfileUpdateInput = z.infer<typeof teamProfileUpdateSchema>;

export type PublicTeamProfile = {
  professionalId: number;
  slug: string;
  name: string;
  specialty: string;
  bio: string | null;
  avatar: string | null;
  displayOrder: number;
  services: Array<{ id: number; name: string; duration: number; price: number }>;
  qualifications: Array<{
    kind: typeof teamQualificationKinds[number];
    title: string;
    issuer: string | null;
    completedYear: number | null;
    description: string | null;
  }>;
  testimonials: Array<{
    authorDisplayName: string;
    quote: string;
    sourceLabel: string | null;
  }>;
};
