import { Resend } from 'resend';
import 'dotenv/config';

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

interface SendConfirmationParams {
  customerName: string;
  customerEmail: string;
  barberName: string;
  serviceName: string;
  startTime: Date;
  cancelToken: string;
}

export async function sendBookingConfirmation({
  customerName,
  customerEmail,
  barberName,
  serviceName,
  startTime,
  cancelToken,
}: SendConfirmationParams) {
  if (!resend) {
    console.error('RESEND_API_KEY not found');
    return;
  }

  const dateStr = startTime.toLocaleDateString('pt-PT', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  
  const timeStr = startTime.toLocaleTimeString('pt-PT', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const cancelUrl = `${process.env.PUBLIC_URL || 'https://' + process.env.REPL_SLUG + '.' + process.env.REPL_OWNER + '.repl.co'}/cancel/${cancelToken}`;

  try {
    const response = await resend.emails.send({
      from: 'Baptista Barber Shop <onboarding@resend.dev>',
      to: customerEmail,
      subject: 'Confirmação de Marcação - Baptista Barber Shop',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #d4af37; text-align: center;">Baptista Barber Shop</h2>
          <p>Olá <strong>${customerName}</strong>,</p>
          <p>A sua marcação foi confirmada com sucesso!</p>
          <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>Barbeiro:</strong> ${barberName}</p>
            <p style="margin: 5px 0;"><strong>Serviço:</strong> ${serviceName}</p>
            <p style="margin: 5px 0;"><strong>Data:</strong> ${dateStr}</p>
            <p style="margin: 5px 0;"><strong>Hora:</strong> ${timeStr}</p>
          </div>
          <p>Morada: Rua Comandante Agatão Lança Nº28</p>
          <p style="margin-top: 30px; font-size: 0.9em; color: #666;">
            Caso não consiga comparecer, por favor utilize o link abaixo para cancelar a sua marcação:
          </p>
          <p style="text-align: center; margin-top: 20px;">
            <a href="${cancelUrl}" style="background-color: #ef4444; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Cancelar Marcação</a>
          </p>
        </div>
      `,
    });
    console.log(`Resend response for ${customerEmail}:`, response);
    if (response.error) {
      console.error(`Resend error for ${customerEmail}:`, response.error);
    } else {
      console.log(`Confirmation email sent to ${customerEmail}`);
    }
  } catch (error) {
    console.error('Error sending confirmation email:', error);
  }
}
