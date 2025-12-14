type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const levelOrder: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50
};

const envLevel = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as LogLevel;
const currentLevel: LogLevel = envLevel in levelOrder ? envLevel : 'info';

const shouldLog = (level: LogLevel): boolean => levelOrder[level] >= levelOrder[currentLevel];

const format = (level: LogLevel, message: string, meta?: Record<string, unknown>): string => {
  const payload = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...meta
  };
  return JSON.stringify(payload);
};

const log = (level: LogLevel, message: string, meta?: Record<string, unknown>): void => {
  if (!shouldLog(level)) return;
  const line = format(level, message, meta);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
};

export const logger = {
  trace: (msg: string, meta?: Record<string, unknown>) => { log('trace', msg, meta); },
  debug: (msg: string, meta?: Record<string, unknown>) => { log('debug', msg, meta); },
  info: (msg: string, meta?: Record<string, unknown>) => { log('info', msg, meta); },
  warn: (msg: string, meta?: Record<string, unknown>) => { log('warn', msg, meta); },
  error: (msg: string, meta?: Record<string, unknown>) => { log('error', msg, meta); }
};
