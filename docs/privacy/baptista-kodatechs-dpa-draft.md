# Rascunho de Acordo de Tratamento de Dados (DPA)

> **Estado: RASCUNHO — NÃO REVISTO NEM APROVADO JURIDICAMENTE.**
>
> Este documento organiza as responsabilidades técnicas identificadas na plataforma. Não substitui aconselhamento jurídico nem deve ser assinado antes de os campos pendentes serem preenchidos e validados pelas partes.

## 1. Partes

### Responsável pelo tratamento

- **Nome comercial:** Baptista Barber Shop
- **Morada:** R. Cmte. Agatão Lança 28, 4640-142 Baião, Portugal
- **Contacto de privacidade:** +351 916 852 841
- **Identificação legal/fiscal:** `[PENDENTE]`
- **Representante legal e cargo:** `[PENDENTE]`

### Subcontratante

- **Nome:** KodaTechs
- **Morada e identificação legal/fiscal:** `[PENDENTE]`
- **Contacto para privacidade e incidentes:** `[PENDENTE]`
- **Representante legal e cargo:** `[PENDENTE]`

O Baptista determina as finalidades e os meios essenciais do tratamento dos dados dos seus clientes. A KodaTechs trata esses dados exclusivamente por conta e segundo instruções documentadas do Baptista, para fornecer, manter, proteger e operar a plataforma. A KodaTechs não pode utilizar os dados dos clientes para finalidades próprias.

## 2. Objeto, duração, natureza e finalidade

O objeto do tratamento é a prestação e operação da plataforma de marcações e gestão do Baptista, incluindo alojamento, manutenção, suporte, segurança, notificações transacionais, continuidade e backups.

O tratamento mantém-se durante a vigência do serviço e, após o seu termo, apenas pelo tempo necessário para devolver ou eliminar os dados segundo as instruções do Baptista, os ciclos de backup e eventuais obrigações legais aplicáveis.

- **Data de início e duração contratual:** `[PENDENTE]`
- **Contrato principal/ordem de serviço a que este DPA fica associado:** `[PENDENTE]`
- **Instruções de devolução ou eliminação no termo:** `[PENDENTE]`

As operações podem incluir recolha, receção, organização, armazenamento, consulta, alteração, transmissão a subprocessadores autorizados, cópia de segurança, recuperação, anonimização, devolução e eliminação.

## 3. Titulares e categorias de dados

### Titulares

- clientes e potenciais clientes do Baptista;
- profissionais, administradores e outros utilizadores autorizados da plataforma;
- pessoas que contactem o Baptista relativamente a marcações ou direitos de privacidade.

### Dados tratados

- nome, telefone e email opcional;
- dados da marcação: serviço, profissional, localização, data, hora, estado e histórico;
- valores, extras, método de pagamento e informação financeira operacional;
- preferências e notas internas de atendimento;
- comunicações transacionais, estados de entrega e identificadores dos fornecedores;
- dados técnicos de sessão, segurança, auditoria, prevenção de abuso e recuperação;
- dados de acesso dos utilizadores administrativos, protegidos segundo o modelo técnico da aplicação.

Não está autorizada a introdução de dados de saúde ou de outras categorias especiais nos campos livres da plataforma sem uma decisão específica, base legal adequada e salvaguardas adicionais.

## 4. Instruções e obrigações do subcontratante

A KodaTechs compromete-se a:

1. tratar os dados apenas mediante instruções documentadas do Baptista, incluindo quanto a transferências internacionais;
2. informar o Baptista caso considere que uma instrução viola a legislação aplicável;
3. limitar o acesso a pessoas que dele necessitem para as funções autorizadas;
4. assegurar compromissos de confidencialidade adequados às pessoas autorizadas;
5. implementar e manter medidas técnicas e organizativas proporcionais ao risco;
6. não vender, explorar ou reutilizar os dados dos clientes para finalidades próprias;
7. manter registos suficientes para demonstrar o cumprimento das obrigações acordadas.

## 5. Segurança

As medidas técnicas atualmente identificadas incluem, conforme aplicável:

- TLS nas ligações externas e proteção dos dados em trânsito;
- palavras-passe armazenadas através de hash e controlo de sessões;
- `SESSION_SECRET` obrigatório e com pelo menos 32 caracteres em Production;
- autenticação e autorização administrativas;
- separação de ambientes e princípio de menor privilégio;
- registos de auditoria e estados técnicos de notificações;
- validação e limitação de inputs;
- backups diários, retenção operacional de 14 dias e testes de restauro em ambiente isolado;
- proteção contra duplicação e concorrência no processamento de notificações;
- gestão de incidentes, atualizações e correções de segurança.

As partes devem rever estas medidas periodicamente e após alterações materiais ao serviço ou ao risco.

## 6. Subprocessadores

A prestação atual pode envolver:

| Subprocessador | Função |
| --- | --- |
| Supabase | Base de dados PostgreSQL e serviços associados |
| Render | Alojamento e execução da aplicação |
| Meta / WhatsApp | Comunicações transacionais de marcações |
| Resend | Email transacional e fallback |
| Cloudflare | Serviços de rede e armazenamento R2 dos backups |

- **Modelo de autorização dos subprocessadores e prazo de aviso para alterações:** `[PENDENTE DE ACORDO]`
- **Confirmação dos DPA/termos aceites nas contas efetivamente usadas:** `[PENDENTE DE VALIDAÇÃO CONTRATUAL]`

A KodaTechs deve impor a cada subprocessador obrigações de proteção materialmente equivalentes às aplicáveis ao tratamento delegado, manter um registo atualizado e informar o Baptista sobre alterações segundo o modelo que vier a ser acordado.

## 7. Direitos dos titulares

A KodaTechs deve assistir o Baptista, na medida tecnicamente possível e tendo em conta a natureza do tratamento, em pedidos de acesso, retificação, apagamento, limitação, oposição e portabilidade.

Se a KodaTechs receber diretamente um pedido relativo a dados controlados pelo Baptista, deve encaminhá-lo para o contacto acordado sem responder em nome do Baptista, salvo instrução documentada ou obrigação legal.

- **Canal operacional entre Baptista e KodaTechs para pedidos:** `[PENDENTE]`
- **Procedimento de identificação do titular e distribuição de responsabilidades:** `[PENDENTE]`

## 8. Incidentes de segurança

A KodaTechs deve comunicar ao Baptista, sem demora injustificada, qualquer violação de dados pessoais de que tenha conhecimento e fornecer progressivamente a informação disponível sobre natureza, categorias afetadas, consequências prováveis e medidas adotadas.

- **Contacto operacional para incidentes:** `[PENDENTE]`
- **Prazo interno de escalamento e formato da comunicação:** `[PENDENTE]`

A decisão sobre notificar a autoridade de controlo ou os titulares pertence ao Baptista enquanto responsável, salvo obrigação legal diretamente aplicável à KodaTechs.

## 9. Retenção, devolução e eliminação

Durante o contrato aplica-se a política documentada em `docs/privacy/baptista-retention-policy.md`, sem prejuízo de obrigações legais superiores.

No termo do serviço, o Baptista escolhe entre devolução e eliminação dos dados, salvo conservação exigida por lei. A eliminação deve abranger cópias ativas e respeitar o ciclo documentado dos backups.

- **Prazo para exportação/devolução após o termo:** `[PENDENTE]`
- **Formato da exportação:** `[PENDENTE]`
- **Prazo final de eliminação após instrução válida:** `[PENDENTE]`
- **Forma de confirmação da eliminação:** `[PENDENTE]`

## 10. Auditoria e cooperação

A KodaTechs deve disponibilizar informação razoavelmente necessária para demonstrar o cumprimento deste DPA e cooperar com auditorias proporcionais, sujeitas a confidencialidade, segurança e ausência de perturbação indevida do serviço.

- **Periodicidade, antecedência, âmbito e custos de auditoria:** `[PENDENTE DE ACORDO]`

A cooperação inclui, quando aplicável, avaliações de impacto, consultas com autoridades e resposta a incidentes ou pedidos de titulares.

## 11. Transferências internacionais

Não devem ocorrer transferências internacionais sem fundamento e salvaguardas adequados. Os termos dos fornecedores consultados incluem DPA e, em alguns casos, cláusulas contratuais-tipo ou adendas de transferência, mas a aplicabilidade às contas concretas ainda tem de ser confirmada.

- **Entidades contratuais, regiões e mecanismos aplicáveis a cada fornecedor:** `[PENDENTE DE VALIDAÇÃO CONTRATUAL]`
- **Necessidade de avaliação de impacto de transferência e medidas suplementares:** `[PENDENTE DE VALIDAÇÃO JURÍDICA]`

## 12. Lei aplicável, responsabilidade e assinaturas

- **Lei, foro, responsabilidade, vigência e prevalência contratual:** `[PENDENTE DE REVISÃO JURÍDICA]`
- **Data de entrada em vigor:** `[PENDENTE]`

### Pelo Baptista Barber Shop

- Nome: `[PENDENTE]`
- Cargo: `[PENDENTE]`
- Data e assinatura: `[PENDENTE]`
### Pela KodaTechs

- Nome: `[PENDENTE]`
- Cargo: `[PENDENTE]`
- Data e assinatura: `[PENDENTE]`
