export default {
  header: {
    eyebrowPhone: 'Sign in · Water · NY',
    eyebrowCode: 'Code',
    heroPhone: {
      line1: 'Welcome',
      line2: '',
      line2Accent: 'back',
    },
    heroCode: {
      line1: 'We sent',
      line2: 'your ',
      line2Accent: 'code',
    },
    subtitlePhone:
      'Ultra-fast delivery, straight to your door. Start with your phone number.',
    subtitleCode: 'We sent a 6-digit code to {{phone}}. Enter it when it arrives.',
    yourPhoneFallback: 'your phone',
  },
  guest: {
    browse: 'Browse without an account →',
  },
  form: {
    eyebrowSignIn: 'Sign in',
    eyebrowCode: 'Code',
  },
  referralBadge: 'Signing up with:',
  firstLogin: {
    detected: 'First sign-in detected — tell us your name to create your account.',
    nameLabel: 'Your name',
    namePlaceholder: 'John Smith',
    nameRequired: 'Enter your name to create your account',
    nameRequiredCode: 'Enter your name to create the account',
    dobLabel: 'Date of birth · optional',
    dobPlaceholder: 'DD/MM/YYYY',
    dobHint: 'So we can wish you a happy birthday 🎂',
  },
  errors: {
    loginFailed: "We couldn't sign you in",
    sendCodeFailed: "We couldn't send the code",
    invalidCode: 'Invalid code',
  },
  actions: {
    signIn: 'Sign in →',
    sendCode: 'Send code →',
    verify: 'Verify →',
  },
  codeStep: {
    sentTo: 'We sent a code to',
    useAnotherNumber: '← Use another number',
    codeLabel: 'Code (6 digits)',
    resend: 'Resend code',
    resendIn: 'Resend in {{seconds}}s',
    resending: 'Resending…',
  },
  whatsappFailure: {
    sendFailed: {
      eyebrow: 'WhatsApp unavailable',
      message: "We couldn't send you the code over WhatsApp right now. Please:",
      bullets: {
        installed: 'Check that you have WhatsApp installed',
        retryLater: 'Try again in a few minutes',
      },
    },
    rateLimited: {
      eyebrow: 'Heavy traffic',
      message: "There's heavy traffic right now. Try again in 30 seconds.",
    },
    recipientInvalid: {
      eyebrow: 'Invalid number',
      message: "That number doesn't look valid. Check it and try again.",
    },
    notReachable: {
      eyebrow: 'No WhatsApp',
      message: "We couldn't find WhatsApp on this number. Want us to call you?",
    },
    escalated: {
      eyebrow: 'WhatsApp unavailable',
      message:
        "We're still having trouble reaching WhatsApp. Try again later or write to support.",
    },
    supportBullet: 'Or write to support: {{email}}',
    retry: 'Retry',
    retryIn: 'Retry in {{seconds}}s',
    retrying: 'Retrying…',
    callSupport: 'Call support',
    contactSupport: 'Contact support',
  },
  referralLanding: {
    eyebrow: 'Invitation',
    codeEyebrow: 'Code',
    invalidTitle: 'Invalid',
    invalidTitleAccent: 'code.',
    invalidHelp:
      "Check the link. If it still doesn't work, ask your promoter to resend the code.",
    goToLogin: 'Sign in to Udash',
    invitedByPrefix: '',
    invitedBySuffix: ' invited you',
    subtitle:
      'Create your account with this code and join Udash — your corner store at your door.',
    createAccount: 'Create account with this code →',
  },
}
