import pc from 'picocolors';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export class Logger {
  private level: LogLevel = 'info';

  constructor(level: LogLevel = 'info') {
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.level === 'debug') {
      console.log(pc.gray(`[DEBUG] ${message}`), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.level === 'debug' || this.level === 'info') {
      console.log(pc.cyan(`[INFO]  ${message}`), ...args);
    }
  }

  success(message: string, ...args: unknown[]): void {
    if (this.level !== 'silent') {
      console.log(pc.green(`✓ ${message}`), ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.level !== 'silent') {
      console.warn(pc.yellow(`⚠ ${message}`), ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.level !== 'silent') {
      console.error(pc.red(`✗ ${message}`), ...args);
    }
  }
}

export const logger = new Logger(process.env.DEBUG ? 'debug' : 'info');
