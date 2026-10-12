import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { barberBusinessCopy } from "../../shared/business/copy/barber.pt";
import { beautyBusinessCopy } from "../../shared/business/copy/beauty.pt";
import { formatBusinessCopy } from "../../shared/business/copy/types";

function collectShape(value: unknown): unknown {
  if (typeof value === "string") return "string";
  if (Array.isArray(value)) return value.map(collectShape);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, collectShape(child)]),
    );
  }
  return typeof value;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectStrings);
  }
  return [];
}

test("Barber and Beauty implement the complete typed business copy contract", () => {
  assert.deepEqual(collectShape(beautyBusinessCopy), collectShape(barberBusinessCopy));
  assert.ok(collectStrings(barberBusinessCopy).every((value) => value.trim().length > 0));
  assert.ok(collectStrings(beautyBusinessCopy).every((value) => value.trim().length > 0));
});

test("Barber Admin and Agenda keep the existing terminology", () => {
  const { admin, agenda } = barberBusinessCopy;
  assert.equal(admin.team.heading, "Equipa de Barbeiros");
  assert.equal(admin.team.add, "Adicionar Barbeiro");
  assert.equal(admin.schedules.establishmentBaseHeading, "Horário base da barbearia");
  assert.equal(admin.compensation.workspaceRentModel, "Aluguer fixo de cadeira");
  assert.equal(agenda.professional.allFilter, "Todos os barbeiros");
  assert.equal(agenda.professional.filterPlaceholder, "Filtrar barbeiro");
  assert.equal(agenda.professional.label, "Barbeiro");
});

test("Beauty Admin and Agenda use neutral professional and establishment terminology", () => {
  const { admin, agenda } = beautyBusinessCopy;
  assert.equal(admin.team.heading, "Equipa de Profissionais");
  assert.equal(admin.team.add, "Adicionar Profissional");
  assert.equal(admin.schedules.establishmentBaseHeading, "Horário base do estabelecimento");
  assert.equal(admin.compensation.workspaceRentModel, "Renda fixa de espaço");
  assert.equal(admin.extras.followCompensation, "Segue a regra de compensação do profissional");
  assert.equal(agenda.professional.allFilter, "Todos os profissionais");
  assert.equal(agenda.professional.filterPlaceholder, "Filtrar profissional");
  assert.equal(agenda.professional.label, "Profissional");
});

test("Barber B3 copy preserves services, categories, team associations and schedules", () => {
  const { admin } = barberBusinessCopy;
  assert.equal(admin.services.heading, "Serviços Disponíveis");
  assert.equal(admin.services.createTitle, "Novo Serviço");
  assert.equal(admin.services.create, "Criar Serviço");
  assert.equal(admin.services.associateDescription, "Configure o preço e a duração aplicáveis apenas nesta loja.");
  assert.equal(admin.categories.manage, "Gerir categorias");
  assert.equal(admin.team.servicesPerformedLabel, "Serviços que executa");
  assert.equal(admin.team.associatedApiSuccess, "Barbeiro associado. Configure os serviços e horários nesta loja.");
  assert.equal(admin.schedules.locationProfessionalTrigger, "Horário nesta loja");
  assert.equal(admin.schedules.establishmentClosedDay, "Loja fechada neste dia.");
  assert.deepEqual(admin.schedules.weekdayLabels, ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"]);
});

test("Beauty B3 copy uses professional and establishment terminology end-to-end", () => {
  const { admin } = beautyBusinessCopy;
  assert.equal(admin.services.associateDescription, "Configure o preço e a duração aplicáveis apenas neste estabelecimento.");
  assert.equal(admin.services.associateAction, "Associar neste estabelecimento");
  assert.equal(admin.team.addMemberTitle, "Adicionar Profissional à Equipa");
  assert.equal(admin.team.servicesPerformedLabel, "Serviços que executa");
  assert.equal(admin.team.associatedApiSuccess, "Profissional associado. Configure os serviços e horários neste estabelecimento.");
  assert.equal(admin.team.invalidProfessional, "Profissional inválido.");
  assert.equal(admin.team.professionalNotFound, "Profissional não encontrado");
  assert.equal(admin.team.invalidServiceForProfessional, "Serviço inválido para este profissional.");
  assert.equal(admin.schedules.locationProfessionalTrigger, "Horário neste estabelecimento");
  assert.equal(admin.schedules.establishmentClosedDay, "Estabelecimento fechado neste dia.");
  assert.equal(admin.compensation.workspaceRentModel, "Renda fixa de espaço");
});

test("Barber B4 copy preserves Dashboard and report terminology", () => {
  const { dashboard, reports } = barberBusinessCopy.admin;
  assert.equal(dashboard.busiestProfessional, "Barbeiro mais ocupado");
  assert.equal(dashboard.professionalShare, "Parte dos barbeiros");
  assert.equal(dashboard.professionalPerformance, "Desempenho por barbeiro");
  assert.equal(reports.professionalLabel, "Barbeiro");
  assert.equal(reports.expensesTitle, "Despesas da Barbearia");
  assert.equal(reports.workbook.settlementsSheet, "Acertos com Barbeiros");
  assert.equal(reports.workbook.workspaceRent, "Aluguer de cadeira (€)");
});

test("Beauty B4 copy uses neutral Dashboard and report terminology", () => {
  const { dashboard, reports } = beautyBusinessCopy.admin;
  assert.equal(dashboard.busiestProfessional, "Profissional mais ocupado");
  assert.equal(dashboard.professionalShare, "Parte dos profissionais");
  assert.equal(dashboard.professionalPerformance, "Desempenho por profissional");
  assert.equal(reports.professionalLabel, "Profissional");
  assert.equal(reports.expensesTitle, "Despesas do Estabelecimento");
  assert.equal(reports.financeExcelHelp,
    "O Excel combina este valor com a receita concluída e os pagamentos estimados aos profissionais.");
  assert.equal(reports.compensationWorkspaceRent, "Renda fixa de espaço");
  assert.equal(reports.workbook.settlementsSheet, "Acertos com Profissionais");
  assert.equal(reports.workbook.workspaceRent, "Renda de espaço (€)");
  assert.equal(reports.workbook.establishmentValue, "Valor do estabelecimento (€)");
});

test("Barber B5A keeps cancellation, reschedule and professional invite wording", () => {
  const { publicCycle } = barberBusinessCopy;
  assert.equal(publicCycle.cancellation.professionalLabel, "Barbeiro");
  assert.equal(publicCycle.reschedule.assistedDescription,
    "Para reagendar esta marcação, contacte a barbearia.");
  assert.equal(publicCycle.invite.createAccessTitle, "Criar acesso de barbeiro");
  assert.equal(publicCycle.invite.backend.created,
    "Convite criado. Envie este link ao barbeiro para definir a palavra-passe.");
  assert.match(publicCycle.invite.accessScopeDescription, /Não concede acesso administrativo/);
});

test("Beauty B5A uses neutral terminology and explains professional invite scope", () => {
  const { publicCycle } = beautyBusinessCopy;
  assert.equal(publicCycle.cancellation.professionalLabel, "Profissional");
  assert.equal(publicCycle.reschedule.assistedDescription,
    "Para reagendar esta marcação, contacte o estabelecimento.");
  assert.equal(publicCycle.reschedule.backend.professionalUnavailable,
    "Este profissional já não executa o serviço desta marcação.");
  assert.equal(publicCycle.invite.createAccessTitle, "Criar acesso de Profissional");
  assert.equal(publicCycle.invite.backend.created,
    "Convite criado. Envie este link ao profissional para definir a palavra-passe.");
  assert.match(publicCycle.invite.accessScopeDescription, /Não concede acesso administrativo/);
});

test("B5B communication copy preserves Barber wording and provides neutral Beauty fallbacks", () => {
  assert.equal(barberBusinessCopy.communications.professionalLabel, "Barbeiro");
  assert.equal(barberBusinessCopy.communications.professionalUnavailable, "Barbeiro indisponível");
  assert.equal(barberBusinessCopy.communications.establishmentFallback, "Barbearia");
  assert.match(barberBusinessCopy.communications.inboundAutoReply.otherQuestions, /contacte diretamente a barbearia/);

  assert.equal(beautyBusinessCopy.communications.professionalLabel, "Profissional");
  assert.equal(beautyBusinessCopy.communications.professionalUnavailable, "Profissional indisponível");
  assert.equal(beautyBusinessCopy.communications.establishmentFallback, "Estabelecimento");
  assert.match(beautyBusinessCopy.communications.inboundAutoReply.otherQuestions, /contacte diretamente o estabelecimento/);
  assert.doesNotMatch(
    JSON.stringify(beautyBusinessCopy.communications),
    /Baptista|Powerhouse|barbeiro|barbeiros|barbearia/i,
  );
});

test("Barber Booking keeps the existing public wording", () => {
  const copy = barberBusinessCopy.booking;
  assert.deepEqual(copy.steps, ["Barbeiro", "Serviço", "Data e hora", "Detalhes"]);
  assert.equal(copy.professional.heading, "Seleciona o barbeiro");
  assert.equal(copy.professional.description, "Escolhe com quem queres marcar.");
  assert.equal(copy.professional.anyAvailable, "Qualquer barbeiro livre");
  assert.equal(copy.service.emptyProfessional, "Este barbeiro não tem serviços disponíveis para marcação online.");
  assert.equal(copy.dateTime.establishmentClosed, "A barbearia está fechada neste dia. Escolha outro dia com horários disponíveis.");
  assert.equal(copy.confirmation.deliveryFallbackWithoutEmail,
    "Se não receber a confirmação nos próximos minutos, contacte diretamente a barbearia.");
  assert.equal(copy.navigation.backPreviousAria, "Voltar ao passo anterior");
  assert.equal(copy.validation.exposeServerErrorMessage, true);
});

test("Beauty Booking uses neutral professional and establishment wording", () => {
  const copy = beautyBusinessCopy.booking;
  assert.deepEqual(copy.steps, ["Serviço", "Profissional", "Data e hora", "Detalhes"]);
  assert.equal(copy.professional.heading, "Selecione o profissional");
  assert.equal(copy.professional.anyAvailable, "Qualquer profissional disponível");
  assert.equal(copy.locations.description,
    "Escolha o estabelecimento para consultar os profissionais, serviços e horários disponíveis.");
  assert.equal(copy.dateTime.establishmentClosed,
    "O estabelecimento está fechado neste dia. Escolha outro dia com horários disponíveis.");
  assert.equal(copy.validation.exposeServerErrorMessage, false);

  const publicCopy = JSON.stringify(beautyBusinessCopy);
  assert.doesNotMatch(
    publicCopy,
    /Baptista|Powerhouse|barbeiro|barbeiros|barbearia|aluguer de cadeira/i,
  );
});

test("Booking templates format dynamic values without assembling domain sentences", () => {
  assert.equal(
    formatBusinessCopy(beautyBusinessCopy.booking.validation.phoneInvalid, {
      phoneLengthLabel: "9 dígitos",
      countryLabel: "Portugal",
    }),
    "Confirme que o número tem 9 dígitos para Portugal.",
  );
  assert.equal(
    formatBusinessCopy(beautyBusinessCopy.booking.confirmation.reserved, {
      customerName: "Maria",
      date: "10 de outubro",
      time: "14:30",
    }),
    "Obrigado, Maria. O seu horário está reservado para 10 de outubro às 14:30h.",
  );
});

test("Booking source contains no forbidden Beauty output literals outside known internal identifiers", () => {
  const source = readFileSync("client/src/pages/Booking.tsx", "utf8");
  const withoutKnownInternalReferences = source
    .split(/\r?\n/)
    .filter((line) => ![
      "fabio-baptista-avatar.jpg",
      "baptista:lastBooking",
      "name.includes(\"baptista\")",
    ].some((allowed) => line.toLowerCase().includes(allowed.toLowerCase())))
    .join("\n");

  assert.doesNotMatch(
    withoutKnownInternalReferences,
    /Baptista|Powerhouse|barbeiro|barbeiros|barbearia|aluguer de cadeira/i,
  );
});

test("B3 backend public responses resolve professional wording through typed runtime copy", () => {
  const source = readFileSync("server/routes.ts", "utf8");
  const teamStart = source.indexOf("// === BARBERS MGMT ===");
  const teamEnd = source.indexOf('app.patch("/api/barbers/:id/reset-password"', teamStart);
  const scheduleStart = source.indexOf('app.get("/api/barbers/:id/availability"');
  const scheduleEnd = source.indexOf("// === APPOINTMENTS ===", scheduleStart);
  const publicTeamRoutes = source.slice(teamStart, teamEnd);
  const publicScheduleRoutes = source.slice(scheduleStart, scheduleEnd);

  assert.ok(teamStart >= 0 && teamEnd > teamStart);
  assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart);
  assert.match(publicTeamRoutes, /message: TEAM_PUBLIC_COPY\.invalidProfessional/);
  assert.match(publicTeamRoutes, /message: TEAM_PUBLIC_COPY\.associatedApiSuccess/);
  assert.match(publicTeamRoutes, /getTeamValidationMessage\(error\)/);
  assert.doesNotMatch(publicTeamRoutes, /message:\s*["'`]([^"'`]*(?:barbeiro|barbearia|aluguer de cadeira))/i);
  assert.doesNotMatch(publicScheduleRoutes, /message:\s*["'`]([^"'`]*(?:barbeiro|barbearia|aluguer de cadeira))/i);

  const sharedSchemas = readFileSync("shared/routes.ts", "utf8");
  assert.match(sharedSchemas, /Indique o nome do barbeiro/);
  assert.match(source, /issue\.path\[0\] === "name"/);
  assert.match(source, /TEAM_PUBLIC_COPY\.validationNameRequired/);
});

test("B4 Dashboard and final Excel output resolve public domain wording through BusinessCopy", () => {
  const adminSource = readFileSync("client/src/pages/Admin.tsx", "utf8");
  const chartSource = readFileSync("client/src/components/admin/DashboardChartCard.tsx", "utf8");
  const serverSource = readFileSync("server/routes.ts", "utf8");
  const dashboardStart = adminSource.indexOf("function TodayOverviewPanel");
  const dashboardEnd = adminSource.indexOf("function getBarberAvatar", dashboardStart);
  const dashboardSectionStart = adminSource.indexOf('ref={businessDashboardRef}');
  const dashboardSectionEnd = adminSource.indexOf('<TabsContent value="appointments"', dashboardSectionStart);
  const reportsStart = adminSource.indexOf('<TabsContent value="reports"');
  const reportsEnd = adminSource.indexOf("</TabsContent>", reportsStart);
  const finalWorkbookStart = serverSource.indexOf("// The accounting export deliberately replaces");
  const finalWorkbookEnd = serverSource.indexOf("// === SEED DATA ===", finalWorkbookStart);
  const ownWorkbookStart = serverSource.indexOf("if (isBarberSession)");
  const ownWorkbookEnd = serverSource.indexOf("const summarySheet", ownWorkbookStart);
  const publicSources = [
    adminSource.slice(dashboardStart, dashboardEnd),
    adminSource.slice(dashboardSectionStart, dashboardSectionEnd),
    adminSource.slice(reportsStart, reportsEnd),
    chartSource,
    serverSource.slice(finalWorkbookStart, finalWorkbookEnd),
    serverSource.slice(ownWorkbookStart, ownWorkbookEnd)
      .replace(/ResumoDiarioBarbeiro|ResumoPorServicoBarbeiro|DetalheBarbeiro/g, ""),
  ].join("\n");

  assert.ok(dashboardStart >= 0 && dashboardEnd > dashboardStart);
  assert.ok(reportsStart >= 0 && reportsEnd > reportsStart);
  assert.ok(finalWorkbookStart >= 0 && finalWorkbookEnd > finalWorkbookStart);
  assert.match(adminSource, /adminCopy\.dashboard\.professionalFilterPlaceholder/);
  assert.match(adminSource, /adminCopy\.reports\.professionalLabel/);
  assert.match(serverSource, /REPORT_PUBLIC_COPY\.workbook\.settlementsSheet/);
  assert.match(serverSource, /REPORT_PUBLIC_COPY\.compensationWorkspaceRent/);
  const forbiddenPublicLiterals = publicSources
    .split(/\r?\n/)
    .filter((line) => /["'`][^"'`]*(?:Baptista|Powerhouse|barbeiro|barbeiros|barbearia|aluguer de cadeira)[^"'`]*["'`]/i.test(line));
  assert.deepEqual(forbiddenPublicLiterals, []);
});

test("B5A public-cycle surfaces and backend responses resolve domain wording through BusinessCopy", () => {
  const cancellationSource = readFileSync("client/src/pages/Cancellation.tsx", "utf8");
  const rescheduleSource = readFileSync("client/src/pages/Reschedule.tsx", "utf8");
  const inviteSource = readFileSync("client/src/pages/BarberInvite.tsx", "utf8");
  const adminSource = readFileSync("client/src/pages/Admin.tsx", "utf8");
  const serverSource = readFileSync("server/routes.ts", "utf8");
  const inviteStart = serverSource.indexOf('app.post("/api/barbers/:id/invite"');
  const inviteEnd = serverSource.indexOf("// === SERVICE CATEGORIES MGMT ===", inviteStart);
  const rescheduleStart = serverSource.indexOf('app.post("/api/appointments/reschedule/:token"');
  const publicCycleEnd = serverSource.indexOf('app.get("/api/admin/dashboard"', rescheduleStart);
  const adminInviteStart = adminSource.indexOf("const handleCreateBarberInvite");
  const adminInviteEnd = adminSource.indexOf("const loadCustomerHistory", adminInviteStart);
  const adminInviteDialogMarker = adminSource.indexOf("inviteCopy.adminConfirmTitle");
  const adminInviteDialogStart = adminSource.lastIndexOf("<ConfirmAction", adminInviteDialogMarker);
  const adminInviteDialogEnd = adminSource.indexOf("</ConfirmAction>", adminInviteDialogStart);
  const publicSources = [
    cancellationSource,
    rescheduleSource,
    inviteSource,
    adminSource.slice(adminInviteStart, adminInviteEnd),
    adminSource.slice(adminInviteDialogStart, adminInviteDialogEnd),
    serverSource.slice(inviteStart, inviteEnd),
    serverSource.slice(rescheduleStart, publicCycleEnd),
  ].join("\n");

  assert.ok(inviteStart >= 0 && inviteEnd > inviteStart);
  assert.ok(rescheduleStart >= 0 && publicCycleEnd > rescheduleStart);
  assert.match(cancellationSource, /copy\.cancellation\.professionalLabel/);
  assert.match(cancellationSource, /role="alert"/);
  assert.match(rescheduleSource, /copy\.reschedule\.assistedDescription/);
  assert.match(inviteSource, /copy\.accessScopeDescription/);
  assert.match(inviteSource, /htmlFor="invite-password"/);
  assert.match(serverSource.slice(inviteStart, inviteEnd), /PUBLIC_CYCLE_COPY\.invite\.backend/);
  assert.match(serverSource.slice(rescheduleStart, publicCycleEnd), /PUBLIC_CYCLE_COPY\.reschedule\.backend/);
  assert.match(serverSource.slice(rescheduleStart, publicCycleEnd), /PUBLIC_CYCLE_COPY\.cancellation\.backend/);

  const forbiddenPublicLiterals = publicSources
    .split(/\r?\n/)
    .filter((line) => /["'`][^"'`]*(?:Baptista|Powerhouse|barbeiro|barbeiros|barbearia|aluguer de cadeira)[^"'`]*["'`]/i.test(line))
    .filter((line) => !/["'`](?:barber|\/api\/barbers|\/api\/barber-invites|\/barber-invite)/i.test(line));
  assert.deepEqual(forbiddenPublicLiterals, []);
});

test("B5B communication surfaces resolve domain wording through typed server copy", () => {
  const emailSource = readFileSync("server/email.ts", "utf8");
  const whatsappSource = readFileSync("server/whatsapp.ts", "utf8");
  const notificationsSource = readFileSync("server/appointment-notifications.ts", "utf8");
  const routesSource = readFileSync("server/routes.ts", "utf8");
  const createdNotificationStart = routesSource.indexOf("async function sendBookingCreatedNotification");
  const communicationRoutesEnd = routesSource.indexOf("async function getBarberWorkingPeriods", createdNotificationStart);
  const publicSources = [
    emailSource,
    whatsappSource,
    notificationsSource,
    routesSource.slice(createdNotificationStart, communicationRoutesEnd),
  ].join("\n");

  assert.ok(createdNotificationStart >= 0 && communicationRoutesEnd > createdNotificationStart);
  assert.match(emailSource, /resolvedBusinessConfig\.copy\.communications/);
  assert.match(whatsappSource, /resolvedBusinessConfig\.copy\.communications/);
  assert.match(notificationsSource, /professionalName: copy\.professionalUnavailable/);
  assert.match(routesSource.slice(createdNotificationStart, communicationRoutesEnd),
    /COMMUNICATIONS_COPY\.professionalUnavailable/);

  const forbiddenPublicLiterals = publicSources
    .split(/\r?\n/)
    .filter((line) => /["'`][^"'`]*(?:Baptista|Powerhouse|barbeiro|barbeiros|barbearia)[^"'`]*["'`]/i.test(line))
    .filter((line) => !/barberName|MetaAppointmentTemplateParams|barberName:/i.test(line));
  assert.deepEqual(forbiddenPublicLiterals, []);
});
