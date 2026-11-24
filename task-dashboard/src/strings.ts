// User-facing strings (Spanish). Centralized so copy can be reviewed in one place.
export const strings = {
  app: {
    name: 'T.A.S.K.',
    tagline: 'Soporte que te deja seguir',
  },
  auth: {
    loginTitle: 'Iniciar sesión',
    loginError: 'Correo o contraseña incorrectos. Verifica tus datos.',
    sessionExpired: 'Tu sesión venció. Inicia sesión de nuevo.',
  },
  tickets: {
    createTitle: '¿En qué podemos ayudarte?',
    createSubmit: 'Enviar solicitud',
    createSubmitting: 'Enviando…',
    createSuccess: 'Tu solicitud se creó correctamente.',
    createError: 'No se pudo crear el ticket.',
    detailTitle: 'Detalle de la solicitud',
    description: 'Descripción del problema',
    deviceAndLocation: 'Dispositivo y ubicación',
    resolutionNotes: 'Notas de resolución',
    attachments: 'Archivos adjuntos',
    history: 'Historial',
    rateService: 'Califica el servicio',
    ratingHint: 'Selecciona una calificación de 1 a 5.',
    download: 'Descargar',
    downloading: 'Descargando…',
    downloadError: 'No se pudo descargar el archivo.',
    privacyNotice:
      'Los datos personales se tratan conforme al aviso de privacidad de la institución (LFPDPPP).',
    maxFiles: 'Solo puedes adjuntar hasta 5 archivos.',
    maxFileSize: 'El archivo supera los 10 MB.',
    invalidFormat: 'Formato no permitido (PDF, PNG, JPG, TXT).',
  },
  common: {
    cancel: 'Cancelar',
    close: 'Cerrar',
    retry: 'Reintentar',
    loading: 'Cargando…',
  },
} as const