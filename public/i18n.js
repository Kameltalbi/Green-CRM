/* Shared language preference and central authentication translations.
   Additional modules can use the same preference without changing authentication. */
(() => {
  const messages = {
    fr: {
      home: 'Ciblix, accueil', language: 'Langue', login: 'Connexion', loginIntro: 'Accédez à votre espace commercial.',
      signup: 'Créer un compte', signupIntro: 'Commencez à organiser vos relations commerciales.',
      professionalEmail: 'Adresse e-mail professionnelle', email: 'Adresse e-mail', emailPlaceholder: 'nom@entreprise.com', password: 'Mot de passe', passwordPlaceholder: 'Votre mot de passe',
      newPassword: 'Nouveau mot de passe', confirmPassword: 'Confirmer le mot de passe', passwordMinimum: 'Au moins 12 caractères', createPasswordPlaceholder: 'Créer un mot de passe', confirmPlaceholder: 'Répétez le mot de passe',
      show: 'Afficher', hide: 'Masquer', showPassword: 'Afficher le mot de passe', hidePassword: 'Masquer le mot de passe',
      forgot: 'Mot de passe oublié ?', signIn: 'Se connecter', createAccount: 'Créer mon compte', noAccount: 'Pas encore de compte ?', hasAccount: 'Déjà un compte ?',
      fullName: 'Nom complet', namePlaceholder: 'Prénom et nom', company: 'Nom de votre entreprise', companyPlaceholder: 'Votre entreprise',
      passwordHint: '12 caractères minimum. Évitez un mot de passe déjà utilisé.', google: 'Continuer avec Google', or: 'ou par e-mail',
      forgotTitle: 'Mot de passe oublié', forgotIntro: 'Recevez un lien pour réinitialiser votre mot de passe.', sendLink: 'Recevoir le lien', backLogin: 'Revenir à la connexion',
      resetSent: 'Si cette adresse correspond à un compte, vous recevrez un lien valable 30 minutes.',
      resetTitle: 'Nouveau mot de passe', resetIntro: 'Choisissez un mot de passe pour retrouver votre espace.', savePassword: 'Enregistrer le mot de passe',
      resetHint: '12 caractères minimum. Vos autres sessions seront déconnectées.', mismatch: 'Les deux mots de passe ne correspondent pas.',
      resetSuccessTitle: 'Votre accès est rétabli.', resetSuccessIntro: 'Votre mot de passe a été modifié.',
      invalidReset: 'Ce lien est invalide ou a expiré. Demandez un nouveau lien de réinitialisation.', requestLink: 'Demander un nouveau lien',
      verifyTitle: 'Vérifiez votre adresse', verifyIntro: 'Ouvrez le lien reçu par e-mail pour activer votre compte.',
      verifyExplanation: 'Lien de vérification envoyé à {email}, si cette adresse est éligible. Vérifiez vos courriers indésirables.',
      yourEmail: 'votre adresse e-mail', resend: 'Renvoyer le lien', verificationHint: 'Lien valable une heure. Votre espace sera créé après vérification.',
      verificationSent: 'Si cette adresse attend une vérification, un nouveau lien a été envoyé.',
      invitationTo: 'Invitation à rejoindre {company}', signupInvited: 'Créez votre accès pour rejoindre {company}.',
      invitationTitle: 'Rejoindre une équipe', invitationFor: 'Invitation pour {email}', invitationIntro: '{company} vous invite à rejoindre son espace Ciblix.',
      invitationExplanation: 'Contacts, notes et relances partagés avec cette équipe.', acceptInvitation: 'Accepter l’invitation', signupJoin: 'Créer mon compte et rejoindre',
      invitationUntil: 'Invitation valable jusqu’au {date}.', wrongAccount: 'Vous êtes connecté avec {email}. Utilisez l’adresse invitée.', changeAccount: 'Utiliser un autre compte',
      invitationUnavailable: 'Invitation indisponible', invitationUnavailableIntro: 'Ce lien ne permet plus de rejoindre l’équipe.', askInvitation: 'Demandez une nouvelle invitation à votre administrateur.',
      welcome: 'Créer votre espace', welcomeIntro: 'Vous en serez l’administrateur.', workspaceHint: 'Vous pourrez ensuite inviter votre équipe.', createWorkspace: 'Créer mon espace',
      expiredTitle: 'Le lien a expiré', expiredIntro: 'Votre adresse n’a pas pu être vérifiée.', verifyAgain: 'Demandez un nouveau lien pour vérifier votre e-mail.',
      loading: 'Chargement…', unavailableTitle: 'Connexion indisponible', unavailableIntro: 'Votre demande n’a pas pu être finalisée.', genericError: 'La demande n’a pas abouti. Vérifiez les informations et réessayez.',
      googleFailed: 'La connexion Google n’a pas abouti.', invalidInvitation: 'Ce lien est invalide ou indisponible.',
      localMail: 'Boîte e-mail de test', localMailLink: 'Ouvrir la boîte de test', localMailExplanation: 'Les liens arrivent dans cette boîte locale, pas dans votre messagerie.',
      privacy: 'Confidentialité', terms: 'Conditions d’utilisation', legal: 'Mentions légales',
      INVALID_EMAIL_OR_PASSWORD: 'Adresse e-mail ou mot de passe incorrect.', EMAIL_NOT_VERIFIED: 'Vérifiez votre adresse e-mail avant de vous connecter.',
      USER_ALREADY_EXISTS: 'Un compte existe déjà avec cette adresse. Connectez-vous ou réinitialisez votre mot de passe.',
      USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Si cette adresse est déjà utilisée, connectez-vous ou réinitialisez votre mot de passe.',
      INVALID_TOKEN: 'Ce lien est invalide ou a expiré. Demandez un nouveau lien.', TOKEN_EXPIRED: 'Ce lien a expiré. Demandez un nouveau lien.',
      PASSWORD_TOO_SHORT: 'Choisissez un mot de passe d’au moins 12 caractères.', PASSWORD_TOO_LONG: 'Le mot de passe doit contenir au maximum 128 caractères.',
      SOCIAL_ACCOUNT_ALREADY_LINKED: 'Ce compte Google est déjà associé à un compte Ciblix.', ACCOUNT_NOT_FOUND: 'Utilisez votre mode de connexion habituel ou demandez une réinitialisation.',
      FAILED_TO_SEND_VERIFICATION_EMAIL: 'L’e-mail n’a pas pu être envoyé. Réessayez dans quelques instants.'
    },
    en: {
      home: 'Ciblix home', language: 'Language', login: 'Sign in', loginIntro: 'Access your sales workspace.',
      signup: 'Create an account', signupIntro: 'Start organizing your business relationships.',
      professionalEmail: 'Work email address', email: 'Email address', emailPlaceholder: 'name@company.com', password: 'Password', passwordPlaceholder: 'Your password',
      newPassword: 'New password', confirmPassword: 'Confirm password', passwordMinimum: 'At least 12 characters', createPasswordPlaceholder: 'Create a password', confirmPlaceholder: 'Repeat your password',
      show: 'Show', hide: 'Hide', showPassword: 'Show password', hidePassword: 'Hide password',
      forgot: 'Forgot password?', signIn: 'Sign in', createAccount: 'Create my account', noAccount: 'New to Ciblix?', hasAccount: 'Already have an account?',
      fullName: 'Full name', namePlaceholder: 'First and last name', company: 'Company name', companyPlaceholder: 'Your company',
      passwordHint: 'At least 12 characters. Choose a password you haven’t used before.', google: 'Continue with Google', or: 'or with email',
      forgotTitle: 'Forgot password', forgotIntro: 'Get a link to reset your password.', sendLink: 'Send reset link', backLogin: 'Back to sign in',
      resetSent: 'If an account exists with this email address, you’ll receive a link valid for 30 minutes.',
      resetTitle: 'New password', resetIntro: 'Choose a password to return to your workspace.', savePassword: 'Save password',
      resetHint: 'At least 12 characters. Your other sessions will be signed out.', mismatch: 'The passwords do not match.',
      resetSuccessTitle: 'Your access is restored.', resetSuccessIntro: 'Your password has been changed.',
      invalidReset: 'This link is invalid or has expired. Request a new password reset link.', requestLink: 'Request a new link',
      verifyTitle: 'Verify your email', verifyIntro: 'Open the link in your email to activate your account.',
      verifyExplanation: 'A verification link will be sent to {email}, if eligible. Check your spam folder.',
      yourEmail: 'your email address', resend: 'Resend link', verificationHint: 'Link valid for one hour. Your workspace will be created after verification.',
      verificationSent: 'If this address is awaiting verification, a new link has been sent.',
      invitationTo: 'Invitation to join {company}', signupInvited: 'Create your account to join {company}.',
      invitationTitle: 'Join a team', invitationFor: 'Invitation for {email}', invitationIntro: '{company} has invited you to its Ciblix workspace.',
      invitationExplanation: 'Share contacts, notes and follow-ups with this team.', acceptInvitation: 'Accept invitation', signupJoin: 'Create my account and join',
      invitationUntil: 'Invitation valid until {date}.', wrongAccount: 'You’re signed in as {email}. Use the invited email address.', changeAccount: 'Use a different account',
      invitationUnavailable: 'Invitation unavailable', invitationUnavailableIntro: 'This link can no longer be used to join the team.', askInvitation: 'Ask your administrator for a new invitation.',
      welcome: 'Create your workspace', welcomeIntro: 'You’ll be its administrator.', workspaceHint: 'You can invite your team afterwards.', createWorkspace: 'Create my workspace',
      expiredTitle: 'This link has expired', expiredIntro: 'Your email address could not be verified.', verifyAgain: 'Request a new link to verify your email address.',
      loading: 'Loading…', unavailableTitle: 'Sign-in unavailable', unavailableIntro: 'Your request could not be completed.', genericError: 'Your request could not be completed. Check your details and try again.',
      googleFailed: 'Google sign-in could not be completed.', invalidInvitation: 'This link is invalid or unavailable.',
      localMail: 'Test email inbox', localMailLink: 'Open test inbox', localMailExplanation: 'Links arrive in this local inbox, not in your personal email.',
      privacy: 'Privacy', terms: 'Terms of use', legal: 'Legal notice',
      INVALID_EMAIL_OR_PASSWORD: 'Incorrect email address or password.', EMAIL_NOT_VERIFIED: 'Verify your email address before signing in.',
      USER_ALREADY_EXISTS: 'An account already exists with this email address. Sign in or reset your password.',
      USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'If this email address is already in use, sign in or reset your password.',
      INVALID_TOKEN: 'This link is invalid or has expired. Request a new link.', TOKEN_EXPIRED: 'This link has expired. Request a new link.',
      PASSWORD_TOO_SHORT: 'Choose a password with at least 12 characters.', PASSWORD_TOO_LONG: 'Your password must contain no more than 128 characters.',
      SOCIAL_ACCOUNT_ALREADY_LINKED: 'This Google account is already linked to a Ciblix account.', ACCOUNT_NOT_FOUND: 'Use your usual sign-in method or request a password reset.',
      FAILED_TO_SEND_VERIFICATION_EMAIL: 'The email could not be sent. Please try again shortly.'
    }
  };
  let language = 'fr';
  try { language = localStorage.getItem('ciblix.language') || language; } catch {}
  const requested = new URLSearchParams(location.search).get('lang');
  if (Object.hasOwn(messages, requested)) { language = requested; try { localStorage.setItem('ciblix.language', language); } catch {} }
  if (!Object.hasOwn(messages, language)) language = 'fr';
  window.CiblixI18n = {
    get language() { return language; },
    t(key, values = {}) { return (messages[language][key] || messages.fr[key] || key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? ''); },
    has(key) { return Object.hasOwn(messages.fr, key); },
    setLanguage(value) { if (!Object.hasOwn(messages, value)) return; language = value; try { localStorage.setItem('ciblix.language', value); } catch {} },
    // Add only links to documents that have actually been published.
    legalLinks: [],
    messages
  };
})();
