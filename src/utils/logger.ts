export type LogLevel = 'info' | 'warn' | 'error' | 'success';

function timestamp(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, message: string, data?: unknown): void {
  const prefix = {
    info: '[INFO]',
    warn: '[WARN]',
    error: '[ERROR]',
    success: '[OK]',
  }[level];

  const line = `${timestamp()} ${prefix} ${message}`;
  if (level === 'error') {
    console.error(line, data !== undefined ? data : '');
  } else {
    console.log(line, data !== undefined ? data : '');
  }
}

export const logger = {
  info: (msg: string, data?: unknown) => log('info', msg, data),
  warn: (msg: string, data?: unknown) => log('warn', msg, data),
  error: (msg: string, data?: unknown) => log('error', msg, data),
  success: (msg: string, data?: unknown) => log('success', msg, data),
};
