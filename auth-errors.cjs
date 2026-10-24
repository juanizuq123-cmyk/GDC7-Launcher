'use strict';
const messages = Object.freeze({
  NOT_CONFIGURED: 'Falta registrar la aplicación GDC7 y configurar su Client ID público.',
  APP_ACCESS_PENDING: 'Falta confirmar el acceso de la aplicación GDC7 a los servicios de Minecraft.',
  INVALID_CONFIG: 'La configuración de acceso de GDC7 no es válida. Revisá CUENTA-MICROSOFT.md.',
  STORAGE_UNAVAILABLE: 'El almacenamiento protegido del sistema no está disponible. No guardamos la sesión en texto plano.',
  STORAGE_ERROR: 'No se pudo leer o guardar la sesión protegida. Cerrá sesión y volvé a intentarlo.',
  LOGOUT_FAILED: 'No se pudo borrar la sesión guardada. Reintentá Cerrar sesión antes de salir.',
  BUSY: 'Ya hay una operación de cuenta en curso.',
  CANCELLED: 'Acceso cancelado. No se completó una nueva sesión.',
  EXPIRED: 'El código de Microsoft caducó. Iniciá sesión otra vez.',
  REAUTH_REQUIRED: 'Microsoft requiere iniciar sesión otra vez. La sesión anterior dejó de ser válida.',
  DENIED: 'No se autorizó el acceso a GDC7.',
  APP_REJECTED: 'Microsoft o Minecraft rechazó la aplicación. Revisá su registro y permiso de acceso.',
  XBOX_ACCOUNT: 'La cuenta necesita un perfil Xbox. Completá su configuración en el sitio oficial de Xbox.',
  XBOX_RESTRICTED: 'Xbox no permite este acceso. Revisá las restricciones regionales o de la familia en tu cuenta.',
  NO_GAME: 'Esta cuenta no tiene acceso autorizado a Minecraft Java. Comprobá la cuenta y su licencia o suscripción.',
  NO_PROFILE: 'No se encontró un perfil de Minecraft Java. Revisá tu perfil en el sitio oficial de Minecraft.',
  PROFILE_CHANGED: 'La renovación devolvió otro perfil. Iniciá sesión otra vez para confirmar la cuenta.',
  NETWORK: 'No se pudo conectar de forma segura con los servicios de la cuenta. Revisá la conexión y reintentá.',
  RESPONSE: 'El servicio de la cuenta devolvió una respuesta no válida.',
  NO_SESSION: 'No hay una sesión guardada para renovar.',
  IDENTITY_INCOMPLETE: 'La sesión no devolvió el identificador Xbox necesario para arrancar. Volvé a iniciar sesión y revisá el acceso de la aplicación.'
});
class AuthError extends Error { constructor(code) { super(messages[code] || messages.RESPONSE); this.name = 'AuthError'; this.code = Object.hasOwn(messages, code) ? code : 'RESPONSE'; } }
function publicError(error) { const code = error instanceof AuthError ? error.code : 'NETWORK'; return { code, message: messages[code] }; }
module.exports = { AuthError, publicError };
