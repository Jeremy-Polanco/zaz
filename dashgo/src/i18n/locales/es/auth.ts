export default {
  header: {
    eyebrowPhone: 'Ingresar · Agua · NY',
    eyebrowCode: 'Código',
    heroPhone: {
      line1: 'Bienvenido',
      line2: 'de ',
      line2Accent: 'vuelta',
    },
    heroCode: {
      line1: 'Mandamos',
      line2: 'tu ',
      line2Accent: 'código',
    },
    subtitlePhone:
      'Entrega ultrarrápida, directo a tu puerta. Empieza con tu número de teléfono.',
    subtitleCode: 'Mandamos un código de 6 dígitos a {{phone}}. Dímelo cuando llegue.',
    yourPhoneFallback: 'tu teléfono',
  },
  guest: {
    browse: 'Explorar sin cuenta →',
  },
  form: {
    eyebrowSignIn: 'Ingresar',
    eyebrowCode: 'Código',
  },
  referralBadge: 'Registrándote con:',
  firstLogin: {
    detected: 'Primer ingreso detectado — dinos cómo te llamas para crear tu cuenta.',
    nameLabel: 'Tu nombre',
    namePlaceholder: 'Juan Pérez',
    nameRequired: 'Poné tu nombre para crear tu cuenta',
    nameRequiredCode: 'Poné tu nombre para crear la cuenta',
    dobLabel: 'Fecha de nacimiento · opcional',
    dobPlaceholder: 'DD/MM/AAAA',
    dobHint: 'Para saludarte en tu cumpleaños 🎂',
  },
  errors: {
    loginFailed: 'No pudimos iniciar sesión',
    sendCodeFailed: 'No pudimos mandar el código',
    invalidCode: 'Código inválido',
  },
  actions: {
    signIn: 'Entrar →',
    sendCode: 'Enviar código →',
    verify: 'Verificar →',
  },
  codeStep: {
    sentTo: 'Mandamos un código a',
    useAnotherNumber: '← Usar otro número',
    codeLabel: 'Código (6 dígitos)',
    resend: 'Reenviar código',
    resendIn: 'Reenviar en {{seconds}}s',
    resending: 'Reenviando…',
  },
  whatsappFailure: {
    sendFailed: {
      eyebrow: 'WhatsApp no disponible',
      message: 'No pudimos enviarte el código por WhatsApp ahora mismo. Por favor:',
      bullets: {
        installed: 'Verificá que tenés WhatsApp instalado',
        retryLater: 'Probá de nuevo en unos minutos',
      },
    },
    rateLimited: {
      eyebrow: 'Mucho tráfico',
      message: 'Hay alto tráfico ahora. Probá en 30 segundos.',
    },
    recipientInvalid: {
      eyebrow: 'Número inválido',
      message: 'El número no parece válido. Revisalo y probá de nuevo.',
    },
    notReachable: {
      eyebrow: 'Sin WhatsApp',
      message: 'No detectamos WhatsApp en este número. ¿Querés que te llamemos?',
    },
    escalated: {
      eyebrow: 'WhatsApp no disponible',
      message:
        'Seguimos teniendo problemas para llegar a WhatsApp. Probá de nuevo más tarde o escribinos a soporte.',
    },
    supportBullet: 'O escribinos a soporte: {{email}}',
    retry: 'Reintentar',
    retryIn: 'Reintentar en {{seconds}}s',
    retrying: 'Reintentando…',
    callSupport: 'Llamar a soporte',
    contactSupport: 'Contactar soporte',
  },
  referralLanding: {
    eyebrow: 'Invitación',
    codeEyebrow: 'Código',
    invalidTitle: 'Código',
    invalidTitleAccent: 'no válido.',
    invalidHelp:
      'Revisá el link. Si sigue sin funcionar, pedile al promotor que te reenvíe el código.',
    goToLogin: 'Entrar a Udash',
    invitedByPrefix: 'Te invitó ',
    invitedBySuffix: '',
    subtitle: 'Creá tu cuenta usando este código y súmate a Udash — tu colmado al timbre.',
    createAccount: 'Crear cuenta con este código →',
  },
}
