import { ArrowLeft, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { shopBranding } from "@/lib/branding";
import { LAST_BOOKING_RETENTION_DAYS } from "@/lib/last-booking-storage";

const pendingBusinessDecisions = [
  "Identificação legal completa, morada e contactos do Baptista Barber Shop",
  "Email ou outro canal dedicado a pedidos de privacidade",
  "Validação jurídica final das bases legais propostas",
  "Prazos de conservação por categoria e obrigações fiscais aplicáveis",
  "DPA, regiões de tratamento e mecanismos de transferências internacionais",
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
          <p><strong className="text-white">Responsável pelo tratamento:</strong> Baptista Barber Shop.</p>
          <p><strong className="text-white">Identificação legal completa, morada e contactos:</strong> [PENDENTE DE VALIDAÇÃO DO NEGÓCIO]</p>
          <p><strong className="text-white">Contacto de privacidade:</strong> [DECISÃO DO NEGÓCIO — email ou canal para exercício de direitos]</p>
          <p><strong className="text-white">Subcontratante tecnológico:</strong> KodaTechs.</p>
          <p>A KodaTechs fornece, mantém e opera a plataforma tecnológica por conta do Baptista Barber Shop e segundo as suas instruções. Não utiliza os dados dos clientes para finalidades próprias.</p>
        </Section>

        <Section title="2. Dados tratados">
          <p>Para gerir marcações podem ser tratados nome, número de telemóvel, email opcional, serviço, profissional, localização, data, hora, estado da marcação, valores, extras, método de pagamento e histórico de alterações.</p>
          <p>O backoffice permite guardar notas operacionais sobre preferências de atendimento. Não devem ser registados dados de saúde nem outra informação sensível.</p>
          <p>Para segurança e entrega de notificações são ainda tratados identificadores técnicos, estados de envio, registos de auditoria, sessões administrativas e links de gestão da marcação.</p>
        </Section>

        <Section title="3. Finalidades e bases legais">
          <p>As bases legais seguintes são uma proposta operacional baseada no tratamento atualmente identificado e aguardam validação jurídica e do negócio:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>criação e gestão de marcações: execução de contrato ou diligências pré-contratuais solicitadas pelo cliente;</li>
            <li>confirmações, alterações, cancelamentos e lembretes transacionais: execução do serviço e/ou interesse legítimo do Baptista, sujeito a validação;</li>
            <li>segurança, registos técnicos e prevenção de abuso: interesse legítimo na proteção da plataforma, dos clientes e do negócio;</li>
            <li>dados necessários para faturação ou outras obrigações aplicáveis: cumprimento de obrigação legal, quando aplicável.</li>
          </ul>
          <p>O fluxo atual não autoriza marketing. Uma utilização futura para fins promocionais deverá ser separada das comunicações transacionais e ter informação e fundamento próprios.</p>
        </Section>

        <Section title="4. WhatsApp e email">
          <p>O telemóvel pode ser utilizado para comunicações operacionais da marcação através do WhatsApp. O email opcional pode ser utilizado como alternativa quando o envio por WhatsApp não for possível.</p>
          <p>Estas mensagens são transacionais: incluem confirmações, alterações, cancelamentos e lembretes relacionados com a marcação. O atual mecanismo não deve ser reutilizado para marketing.</p>
          <p>Não foi identificado um fluxo de campanhas promocionais nesta versão da aplicação. Uma utilização futura para marketing exigirá informação, escolha e fundamento próprios, quando legalmente necessários.</p>
        </Section>

        <Section title="5. Conservação">
          <p><strong className="text-white">Prazos da base de dados e logs:</strong> [DECISÃO DO NEGÓCIO — definir por categoria e validar obrigações fiscais]</p>
          <p>A preferência guardada neste browser para repetir uma marcação é removida automaticamente após {LAST_BOOKING_RETENTION_DAYS} dias. Os backups operacionais têm atualmente uma janela técnica de retenção de 14 dias.</p>
        </Section>

        <Section title="6. Fornecedores e destinatários">
          <p>A KodaTechs pode recorrer aos seguintes subcontratantes posteriores, de acordo com os serviços efetivamente utilizados em Production:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li><strong className="text-white">Supabase:</strong> alojamento e operação da base de dados PostgreSQL;</li>
            <li><strong className="text-white">Render:</strong> alojamento e execução da aplicação;</li>
            <li><strong className="text-white">Meta / WhatsApp:</strong> envio e estado de comunicações transacionais;</li>
            <li><strong className="text-white">Resend:</strong> envio de emails transacionais e de fallback;</li>
            <li><strong className="text-white">Cloudflare:</strong> serviços de rede e armazenamento dos backups operacionais em R2;</li>
            <li><strong className="text-white">GitHub Actions:</strong> automatização operacional dos backups, com processamento temporário durante a execução.</li>
          </ul>
          <p><strong className="text-white">DPA, regiões e garantias de transferência:</strong> [PENDENTE DE VALIDAÇÃO CONTRATUAL E JURÍDICA]</p>
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
