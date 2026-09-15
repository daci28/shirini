export const DEFAULT_PANEL_USERNAME = 'admin';
export const DEFAULT_PANEL_PASSWORD = 'admin';

type PanelCredentialSettings = {
  webAdminUsername?: unknown;
  webAdminPassword?: unknown;
};

/** Returns configured credentials while preserving the documented admin/admin default. */
export const getPanelCredentials = (settings: PanelCredentialSettings) => {
  const configuredUsername = typeof settings.webAdminUsername === 'string'
    ? settings.webAdminUsername.trim()
    : '';
  const configuredPassword = typeof settings.webAdminPassword === 'string'
    ? settings.webAdminPassword
    : '';

  return {
    username: configuredUsername || DEFAULT_PANEL_USERNAME,
    password: configuredPassword || DEFAULT_PANEL_PASSWORD,
  };
};

/**
 * Never serialize credential material to the browser. Telegram's bot token is
 * write-only as well: callers receive only an explicit `hasTelegramBotToken`
 * status flag from the server.
 */
export const omitPanelPassword = <T extends object>(settings: T): Omit<T, 'webAdminPassword' | 'webAdminPasswordHash' | 'telegramBotToken'> => {
  const {
    webAdminPassword: _password,
    webAdminPasswordHash: _passwordHash,
    telegramBotToken: _telegramBotToken,
    ...safeSettings
  } = settings as T & {
    webAdminPassword?: unknown;
    webAdminPasswordHash?: unknown;
    telegramBotToken?: unknown;
  };
  return safeSettings as Omit<T, 'webAdminPassword' | 'webAdminPasswordHash' | 'telegramBotToken'>;
};
