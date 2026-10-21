import { ArrowLeft, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { shopBranding } from "@/lib/branding";
import { LAST_BOOKING_RETENTION_DAYS } from "@/lib/last-booking-storage";

const pendingBusinessDecisions = [
  "Identidade legal e contacto do responsável pelo tratamento",
  "Email ou outro canal dedicado a pedidos de privacidade",
  "Base legal final para cada finalidade",
  "Prazos de conservação dos dados da aplicação",
  "Papéis e responsabilidades do Baptista e da KodaTechs",
  "Lista contratual de fornecedores, localizações e transferências internacionais",
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-xl font-bold text-white">{title}</h2>
      <div className="space-y-3 text-sm leading-7 text-gray-300">{children}</div>
    </section>
  );
}

export default function Privacy() {
  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:py-12">
      <article className="mx-auto max-w-3xl space-y-8 rounded-2xl border border-white/10 bg-card p-5 shadow-2xl sm:p-8">
        <header className="space-y-4 border-b border-white/10 pb-6">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-gray-400 transition-colors hover:text-primary">
            <ArrowLeft className="h-4 w-4" />
            Voltar ao início
          </Link>
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 h-7 w-7 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <h1 className="font-display text-3xl font-bold text-white">Política de Privacidade</h1>
              <p className="mt-2 text-sm text-gray-400">Proposta para {shopBranding.name}</p>
            </div>
          </div>
        </header>

        <aside className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
          <p className="font-semibold">Rascunho — não publicar antes da validação do negócio.</p>
          <p className="mt-2">Esta proposta descreve apenas o tratamento identificado na aplicação. Falta decidir e preencher:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {pendingBusinessDecisions.map((decision) => <li key={decision}>{decision}</li>)}
          </ul>
        </aside>

        <Section title="1. Responsável e contacto">
          <p><strong className="text-white">Responsável pelo tratamento:</strong> [DECISÃO DO NEGÓCIO — entidade legal, morada e contactos]</p>
          <p><strong className="text-white">Contacto de privacidade:</strong> [DECISÃO DO NEGÓCIO — email ou canal para exercício de direitos]</p>
          <p><strong className="text-white">Papel da KodaTechs:</strong> [DECISÃO CONTRATUAL — confirmar se atua como subcontratante e em que âmbito]</p>
        </Section>

        <Section title="2. Dados tratados">
          <p>Para gerir marcações podem ser tratados nome, número de telemóvel, email opcional, serviço, profissional, localização, data, hora, estado da marcação, valores, extras, método de pagamento e histórico de alterações.</p>
          <p>O backoffice permite guardar notas operacionais sobre preferências de atendimento. Não devem ser registados dados de saúde nem outra informação sensível.</p>
          <p>Para segurança e entrega de notificações são ainda tratados identificadores técnicos, estados de envio, registos de auditoria, sessões administrativas e links de gestão da marcação.</p>
        </Section>

        <Section title="3. Finalidades e bases legais">
          <p>Os dados são utilizados para criar e gerir marcações, comunicar confirmações, alterações, cancelamentos e lembretes, prestar o serviço, registar pagamentos e proteger a segurança da aplicação.</p>
          <p><strong className="text-white">Bases legais:</strong> [DECISÃO JURÍDICA/NEGÓCIO — confirmar execução de contrato, obrigação legal, interesse legítimo e, quando aplicável, consentimento para cada finalidade]</p>
          <p>Os contactos utilizados para comunicações transacionais não são, por si só, uma autorização para marketing.</p>
        </Section>

        <Section title="4. WhatsApp e email">
          <p>O telemóvel pode ser utilizado para comunicações operacionais da marcação através do WhatsApp. O email opcional pode ser utilizado como alternativa quando o envio por WhatsApp não for possível.</p>
          <p>Não foi identificado um fluxo de campanhas promocionais nesta versão da aplicação. Uma utilização futura para marketing exigirá informação e fundamento próprios.</p>
        </Section>

        <Section title="5. Conservação">
          <p><strong className="text-white">Prazos da base de dados e logs:</strong> [DECISÃO DO NEGÓCIO — definir por categoria e validar obrigações fiscais]</p>
          <p>A preferência guardada neste browser para repetir uma marcação é removida automaticamente após {LAST_BOOKING_RETENTION_DAYS} dias. Os backups operacionais têm atualmente uma janela técnica de retenção de 14 dias.</p>
        </Section>

        <Section title="6. Fornecedores e destinatários">
          <p>A infraestrutura identificada pode envolver Supabase, Render, Meta/WhatsApp, Resend, Cloudflare e GitHub Actions. Google Fonts e, quando utilizados, Google Maps ou Calendar também podem receber dados técnicos de ligação.</p>
          <p><strong className="text-white">Lista final, funções, regiões e garantias de transferência:</strong> [DECISÃO CONTRATUAL — validar fornecedores ativos, contratos e subprocessadores antes de publicar]</p>
        </Section>

        <Section title="7. Direitos">
          <p>Pode solicitar informação e acesso aos seus dados, correção, apagamento quando aplicável, limitação, oposição e portabilidade nos casos previstos no RGPD. Pode ainda apresentar reclamação à Comissão Nacional de Proteção de Dados.</p>
          <p><strong className="text-white">Como exercer os direitos:</strong> [DECISÃO DO NEGÓCIO — inserir contacto, processo de identificação e prazo de resposta]</p>
        </Section>

        <Section title="8. Segurança, cookies e armazenamento local">
          <p>A aplicação utiliza uma sessão necessária para o acesso administrativo e medidas técnicas como ligações seguras, palavras-passe protegidas por hash, controlo de acesso, auditoria e backups.</p>
          <p>O site pode guardar localmente no dispositivo os dados da última marcação para facilitar uma repetição solicitada pelo utilizador. Este registo tem validade limitada e pode ser eliminado através das definições do browser.</p>
        </Section>

        <footer className="border-t border-white/10 pt-5 text-xs leading-6 text-gray-500">
          Última revisão técnica desta proposta: 21 de outubro de 2026. A data de entrada em vigor deve ser definida aquando da aprovação final.
        </footer>
      </article>
    </main>
  );
}
