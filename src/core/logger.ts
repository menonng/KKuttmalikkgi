/** 단순 레벨 로거. 빌드 로그가 CI 출력에서도 읽히도록 접두사를 붙인다. */
export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

export class Logger {
  constructor(private level: LogLevel = 'info') {}

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private enabled(level: LogLevel): boolean {
    return ORDER[level] <= ORDER[this.level];
  }

  error(message: string, ...rest: unknown[]): void {
    if (this.enabled('error')) console.error(`[error] ${message}`, ...rest);
  }

  warn(message: string, ...rest: unknown[]): void {
    if (this.enabled('warn')) console.warn(`[warn ] ${message}`, ...rest);
  }

  info(message: string, ...rest: unknown[]): void {
    if (this.enabled('info')) console.log(`[info ] ${message}`, ...rest);
  }

  debug(message: string, ...rest: unknown[]): void {
    if (this.enabled('debug')) console.log(`[debug] ${message}`, ...rest);
  }
}

export const defaultLogger = new Logger();
