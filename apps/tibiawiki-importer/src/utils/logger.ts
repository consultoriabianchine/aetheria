export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Logger estruturado do importador.
 * Formato: [LEVEL] timestamp [tag] mensagem
 */
export class Logger {
  private level: LogLevel;

  constructor(verbose = false) {
    this.level = verbose ? LogLevel.DEBUG : LogLevel.INFO;
  }

  setVerbose(verbose: boolean) {
    this.level = verbose ? LogLevel.DEBUG : LogLevel.INFO;
  }

  debug(tag: string, message: string) {
    this.log(LogLevel.DEBUG, 'DEBUG', tag, message);
  }

  info(tag: string, message: string) {
    this.log(LogLevel.INFO, 'INFO', tag, message);
  }

  warn(tag: string, message: string) {
    this.log(LogLevel.WARN, 'WARN', tag, message);
  }

  error(tag: string, message: string) {
    this.log(LogLevel.ERROR, 'ERROR', tag, message);
  }

  private log(level: LogLevel, label: string, tag: string, message: string) {
    if (level < this.level) return;
    const time = new Date().toISOString();
    const tagPart = tag ? ` [${tag}]` : '';
    console.log(`[${label}]${tagPart} ${message}`);
    void time;
  }
}