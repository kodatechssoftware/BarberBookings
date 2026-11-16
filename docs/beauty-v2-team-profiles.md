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

## Fase 2 — imagens de certificados

A migration `0033_team_profile_certificate_documents.sql` acrescenta metadados de imagens privadas sem alterar ou publicar qualificações existentes. O MVP aceita apenas JPG, PNG e WebP até 10 MB. O backend confirma o conteúdo real, limita a descodificação a 40 milhões de píxeis, corrige orientação, redimensiona para um máximo de 2400 px, converte para WebP até 3 MB e não transporta EXIF/GPS para o derivado.

Checksum SHA-256 canónico da migration: `08fc4d8b015e2975e79c0ef57d524607e2e9d16c6bb4f86c133115185492ede8`.

A tabela de metadados da fase 2 ativa RLS sem políticas e revoga explicitamente todos os privilégios de `PUBLIC`, `anon` e `authenticated` sobre a tabela e a sequência. A própria migration valida privilégios efetivos, incluindo os herdados por membership, e faz rollback se algum acesso permanecer. Esta proteção é local aos novos objetos e não altera as default ACLs globais do projeto Supabase.

O original recebido nunca é guardado. PDF, SVG, HTML, imagens animadas e caminhos fornecidos pelo browser são recusados. Os caminhos são UUID aleatórios e não incluem nomes ou outros dados pessoais. Uma qualificação continua válida sem imagem; publicar a qualificação nunca publica automaticamente o certificado.

### Bucket privado

Criar manualmente, no projeto Supabase do ambiente certo, um bucket chamado exatamente `beauty-team-certificates`:

1. Storage → New bucket;
2. manter **Public bucket** desligado;
3. limitar o tamanho do objeto a 3 MB (o limite de entrada de 10 MB é aplicado antes, na API);
4. permitir apenas `image/webp`, porque o backend nunca envia o original;
5. não criar políticas de leitura para `anon` ou `authenticated` — a aplicação usa autenticação própria e o backend é o único cliente do Storage;
6. configurar `SUPABASE_URL` e preferencialmente `SUPABASE_SECRET_KEY` no serviço backend; `SUPABASE_SERVICE_ROLE_KEY` é apenas fallback legado;
7. nunca criar variáveis `VITE_*` com estas credenciais.

O bucket deve existir antes de ativar `teamProfiles` com uploads. A ausência de configuração devolve 503 e não afeta o perfil textual.

### Publicação e acesso

- Só `team.manage_global`, a flag `teamProfiles` e a localização ativa permitem gerir imagens.
- Um documento fica público apenas quando perfil, qualificação e documento estão publicados e autorizados.
- A rota pública volta a validar esses estados e a localização antes de emitir um URL Supabase assinado por 60 segundos.
- Revogar a publicação bloqueia novos URLs imediatamente; um URL já emitido expira no máximo ao fim desses 60 segundos.
- O audit log guarda IDs, tamanho e estado, nunca o caminho Storage, URL assinado, hash ou conteúdo.

### Substituição, limpeza e recuperação

O novo objeto é processado e gravado antes de substituir atomicamente o documento atual. O anterior passa a `pending_delete`; falhas de Storage nunca repõem um documento removido na página pública. O endpoint administrativo e `npm run certificates:cleanup -- [locationId]` repetem de forma idempotente a remoção de registos `uploading`, `failed` ou `pending_delete` antigos, sem tocar no documento atual. A limpeza é explícita e não depende de cron em memória.

Backups PostgreSQL não contêm objetos do Supabase Storage. Antes de uma operação destrutiva, exportar separadamente o bucket e o respetivo inventário. Na recuperação, restaurar primeiro a BD e depois os objetos nos mesmos paths; documentos sem objeto permanecem privados/indisponíveis até serem substituídos. Não reutilizar um backup de outro estabelecimento.

### Limitações do MVP

- Não existe antivírus de documentos porque não são aceites documentos originais; o conteúdo é integralmente descodificado e reconstruído como imagem WebP.
- A aplicação não oculta informação visível dentro da fotografia. O Admin recebe um aviso e deve confirmar que não há números, assinaturas, moradas ou dados privados antes de autorizar.
- Não há PDF, OCR, versão original ou transformação Supabase paga.
