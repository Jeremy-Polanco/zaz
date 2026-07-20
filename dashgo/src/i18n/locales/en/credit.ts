export default {
  eyebrow: 'My account',
  title: {
    lead: 'My',
    accent: 'credit.',
  },
  subtitle: 'Available balance for your orders.',
  summary: {
    available: 'Available',
    balance: 'Balance',
    limit: 'Limit',
    dueDate: 'Due date',
  },
  overdueBanner: 'Account overdue — pay off your debt to keep using the app.',
  pendingBalance: 'Outstanding balance',
  payNow: 'Pay now →',
  movementsHeading: 'My transactions',
  movement: {
    meta: '{{date}} · {{type}}',
  },
  movementType: {
    grant: 'Credit granted',
    charge: 'Charge',
    reversal: 'Reversal',
    payment: 'Payment received',
    adjustment: 'Adjustment',
    adjustment_increase: 'Adjustment +',
    adjustment_decrease: 'Adjustment -',
  },
  noAccount: {
    title: 'No credit account',
    body: "You don't have an active credit account.\nContact the administrator.",
  },
  empty: {
    title: 'No transactions',
    body: 'Your credit history will appear here.',
  },
  pay: {
    eyebrow: 'Credit payment',
    title: {
      lead: 'Pay off my',
      accent: 'debt.',
    },
    subtitle:
      'Pay your outstanding balance by card. Once confirmed, your credit is freed up instantly.',
    errorTitle: 'Error',
    startError: "We couldn't start the payment",
    locked: {
      title: 'Account locked',
      body: 'Your account is overdue. Pay off your debt to keep using the app.',
    },
    amountLabel: 'Amount to pay',
    dueDate: 'Due date: {{date}}',
    payButton: 'Pay {{amount}} →',
    stripeNote:
      'Processed by Stripe. Your card details are never stored on our servers.',
    success: {
      title: 'Payment received',
      body: 'Thank you. Taking you back to your credit…',
    },
    noDebt: {
      eyebrow: 'No outstanding balance',
      title: 'You have no debt\nto pay.',
      body: 'Your credit account is up to date.',
      back: 'Back to credit →',
    },
  },
}
