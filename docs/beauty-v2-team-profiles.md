# Beauty v2 — perfis públicos da equipa

## Fase 1

A funcionalidade `teamProfiles` acrescenta perfis públicos explicitamente controlados por localização sem alterar os profissionais, serviços ou páginas públicas existentes quando a flag está desligada.

- A identidade, fotografia, biografia e especialidade continuam em `barbers`.
- Os serviços continuam exclusivamente em `barber_services` e `service_locations`.
- `barber_public_profiles` controla slug, ordem, autorização e publicação por profissional/localização.
- `barber_qualifications` guarda cursos, formações, diplomas e certificações como metadados estruturados.
- `barber_testimonials` guarda apenas opiniões cuja publicação foi autorizada.
- Todo o conteúdo novo começa não publicado. O perfil e cada conteúdo publicável exigem confirmação explícita de autorização.
- As APIs públicas usam DTOs allowlist e só devolvem perfis e conteúdos publicados na localização ativa.
- Retirar um perfil ou conteúdo de publicação produz efeito imediato, sem apagar o histórico administrativo.

O Admin reutiliza as permissões `team.manage_global` e as associações de localização existentes. A associação de serviços mantém-se no formulário normal da profissional; o editor do perfil limita-se a apresentar esses serviços, evitando uma segunda fonte de verdade.

## Segurança e privacidade

- A feature flag e o master switch são verificados no servidor, inclusive em acessos diretos a `/equipa/:slug`.
- Slugs são únicos por localização.
- Não são publicados email, utilizador, remuneração, custos, documentos, audit metadata sensível ou dados internos.
- Testemunhos e qualificações publicados exigem autorização registada; o audit log regista apenas contagens e estado de publicação.
- O CTA transporta apenas o identificador operacional da profissional. O booking volta a validar serviços, disponibilidade e localização.

## Fase 2 — certificados digitais (pendente)

Fica deliberadamente fora da Fase 1 o carregamento ou publicação de ficheiros originais de diplomas e certificados. Antes de o implementar é necessário aprovar:

1. bucket privado por ambiente, com políticas de acesso e isolamento por localização;
2. uploads autenticados, allowlist de MIME, limites de tamanho, antivírus e remoção de metadados;
3. geração de derivados públicos sem número de documento, assinatura ou outros dados pessoais;
4. URLs assinados com validade curta para originais privados;
5. retenção, eliminação, exportação e prova de consentimento;
6. inclusão explícita nos backups e no procedimento de recuperação;
7. custos de armazenamento, transferência e processamento de imagens/PDF.

Até essa decisão, a aplicação guarda apenas texto estruturado e nunca aceita ou expõe ficheiros de certificados.
