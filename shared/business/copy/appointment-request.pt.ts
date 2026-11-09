export const APPOINTMENT_REQUEST_PUBLIC_COPY = {
  homePrimaryAction: "Pedir marcação",
  pageTitle: "Faça o seu pedido de marcação",
  pageIntroduction: "Escolha os serviços, os profissionais e o horário que prefere.",
  loadingForm: "A preparar o formulário...",
  unavailable: "Neste momento, este estabelecimento não está a aceitar pedidos de marcação online.",
  services: {
    titleSingle: "Serviço",
    titleMultiple: "Serviços",
    instructionSingle: "Escolha o serviço que pretende realizar.",
    instructionMultiple: "Escolha os serviços que pretende realizar. Pode combinar vários serviços no mesmo pedido.",
    chooseSingle: "Escolha um serviço",
    addAnother: "Adicionar outro serviço",
    selectedSingle: "Serviço selecionado",
    selectedMultiple: "Serviços selecionados",
    allSelectedDescription: "Pode continuar para escolher a data e o horário.",
    loading: "A carregar os serviços...",
    professionalLabel: "Profissional",
    professionalPlaceholder: "Escolher profissional",
  },
  schedule: {
    title: "Data e horário",
    instruction: "Escolha o dia e o horário que lhe dão mais jeito.",
    availableTimes: "Horários disponíveis",
    available: "Disponível",
    selected: "Selecionado",
    chooseServiceTitle: "Escolha primeiro um serviço",
    chooseServiceDescription: "Os horários aparecem depois de escolher os serviços e os profissionais.",
    chooseProfessionalsTitle: "Escolha os profissionais",
    chooseProfessionalsDescription: "Indique quem deverá realizar cada serviço para consultarmos a disponibilidade conjunta.",
    loading: "A consultar os horários disponíveis...",
    errorTitle: "Não foi possível consultar os horários",
    errorDescription: "Tente novamente dentro de alguns instantes.",
    emptyTitle: "Sem horários disponíveis",
    emptyDescription: "Não encontramos um horário que permita realizar todos os serviços neste dia. Experimente outra data.",
    totalDuration: "Duração prevista",
    totalPrice: "Total",
    execution: {
      title: "Como prefere realizar os serviços?",
      description: "Escolha entre realizar os serviços por ordem ou, quando possível, ao mesmo tempo.",
      sequential: "Sequencial",
      sequentialDescription: "Um serviço depois do outro",
      parallel: "Em simultâneo",
      parallelDescription: "Serviços compatíveis ao mesmo tempo",
    },
  },
  customer: {
    title: "Os seus dados",
    instruction: "Preencha os seus dados para que a equipa possa analisar o pedido.",
    name: "Nome",
    email: "Email",
    optional: "opcional",
    phone: "Telemóvel",
  },
  reviewSingle: "Confirme o serviço, o profissional, a data e o horário pretendidos.",
  reviewMultiple: "Confirme os serviços, os profissionais, a data e o horário pretendidos.",
  approvalNotice: "A marcação fica sujeita a confirmação. A equipa irá analisar o pedido antes de o aprovar.",
  submit: "Enviar pedido de marcação",
  submitting: "A enviar o pedido...",
  validationTitle: "Reveja o pedido",
  validationDescription: "Escolha os serviços, os profissionais, a data e o horário e preencha os dados de contacto.",
  submitErrorTitle: "Não foi possível enviar o pedido",
  submitErrorDescription: "Verifique os dados e tente novamente.",
  submitErrors: {
    rateLimited: "Foram efetuados demasiados pedidos. Aguarde alguns minutos e tente novamente.",
    invalidTime: "Escolha um horário futuro e tente novamente.",
    unavailableTime: "O horário deixou de estar disponível. Escolha outra opção.",
    conflict: "Um dos profissionais já tem uma marcação neste período. Escolha outro horário.",
    unavailableSelection: "Um dos serviços ou profissionais deixou de estar disponível. Reveja o pedido.",
    featureUnavailable: "Neste momento, não é possível pedir vários serviços na mesma marcação.",
    parallelUnavailable: "Estes serviços já não podem ser realizados em simultâneo. Escolha a opção sequencial ou reveja os profissionais.",
  },
  success: {
    title: "Pedido enviado com sucesso!",
    description: "A equipa recebeu o seu pedido e irá analisar a disponibilidade.",
    notice: "A marcação só ficará confirmada depois de o pedido ser aprovado.",
    backHome: "Voltar à página inicial",
  },
  proposal: {
    eyebrow: "Alteração ao pedido",
    title: "Proposta de novo horário",
    description: "A equipa sugeriu outro horário para o seu pedido de marcação.",
    availabilityNotice: "Ao aceitar, a disponibilidade será verificada novamente. A marcação só fica confirmada se o horário continuar disponível.",
    validUntil: "Pode responder até",
    unavailableTitle: "Ligação indisponível",
    unavailableDescription: "Esta ligação não é válida, expirou ou já não está disponível.",
    inactive: "Esta proposta já não está disponível para resposta.",
    reject: "Não aceitar este horário",
    accept: "Aceitar novo horário",
    submitting: "A enviar a resposta...",
    acceptedTitle: "Marcação confirmada",
    acceptedDescription: "O novo horário foi aceite e a sua marcação ficou confirmada.",
    rejectedTitle: "Proposta recusada",
    rejectedDescription: "A equipa recebeu a sua resposta. O pedido continua sem uma marcação confirmada.",
    responseError: "Não foi possível enviar a resposta. Tente novamente.",
  },
} as const;

export function resolvePublicBookingPrimaryAction(
  appointmentRequestsActive: boolean,
  immediateBookingLabel: string,
) {
  return appointmentRequestsActive
    ? APPOINTMENT_REQUEST_PUBLIC_COPY.homePrimaryAction
    : immediateBookingLabel;
}

export function requestReviewText(serviceCount: number) {
  return serviceCount === 1
    ? APPOINTMENT_REQUEST_PUBLIC_COPY.reviewSingle
    : APPOINTMENT_REQUEST_PUBLIC_COPY.reviewMultiple;
}
