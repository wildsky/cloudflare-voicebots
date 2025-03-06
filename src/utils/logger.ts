/* 
 * A colorful logger that includes the caller’s file, line number, and function.
 */

const RESET = "\x1b[0m";
const BRIGHT = "\x1b[1m";

/** ANSI color codes for different log levels */
enum LogColors {
  DEBUG = "\x1b[34m", // Blue
  INFO = "\x1b[32m",  // Green
  WARN = "\x1b[33m",  // Yellow
  ERROR = "\x1b[31m", // Red
  FATAL = "\x1b[35m", // Magenta
}

/** Log levels in ascending order of severity */
enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  FATAL = "FATAL",
}

/** Options for customizing logger behavior */
interface LoggerOptions {
  /** Minimum level to actually print to console */
  minLevel?: LogLevel;
  /** If true, show the function/class name in log output */
  showFunctionName?: boolean;
  /** If true, show file name + line number in log output */
  showFileAndLine?: boolean;
}

export class SimpleLogger {
  private minLevel: LogLevel;
  private showFunctionName: boolean;
  private showFileAndLine: boolean;

  constructor(options: LoggerOptions = {}) {
    this.minLevel = options.minLevel ?? LogLevel.DEBUG;
    this.showFunctionName = options.showFunctionName ?? true;
    this.showFileAndLine = options.showFileAndLine ?? true;
  }

  /** 
   * Retrieves details about the caller from the stack trace 
   * so we can log file:line and function/class name.
   */
  private getCallerDetails(): {
    functionName?: string;
    fileAndLine?: string;
  } {
    const error = new Error();
    // The stack might look something like:
    //
    // Error
    //    at FancyLogger.getCallerDetails (FancyLogger.ts:xx:yy)
    //    at FancyLogger.debug (FancyLogger.ts:xx:yy)
    //    at SomeOtherClass.someMethod (someFile.ts:aa:bb)
    //
    // We'll parse the 3rd or 4th line to figure out the real caller.
    
    const stack = error.stack?.split("\n") ?? [];
    // The 0th line is "Error"
    // The 1st line is "    at FancyLogger.getCallerDetails (FancyLogger.ts:xx:yy)"
    // The 2nd line is "    at FancyLogger.<someMethod> (FancyLogger.ts:xx:yy)"
    // The 3rd line *might* be the user-level call site.
    // We'll try the 3rd or 4th line to see where it belongs:
    const callerLine = stack[3] || stack[2] || "";

    const functionMatch = callerLine.match(/at (.*?) \(/);
    const functionName = functionMatch?.[1]?.trim();

    const fileAndLineMatch = callerLine.match(/\(([^)]+)\)/);
    const fileAndLine = fileAndLineMatch?.[1]?.trim();

    return { functionName, fileAndLine };
  }

  /** Returns whether a log level should be printed based on minLevel setting */
  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR, LogLevel.FATAL];
    const currentIndex = levels.indexOf(level);
    const minIndex = levels.indexOf(this.minLevel);
    return currentIndex >= minIndex;
  }

  private log(level: LogLevel, color: string, message: unknown, ...args: unknown[]) {
    if (!this.shouldLog(level)) return;

    const { functionName, fileAndLine } = this.getCallerDetails();
    let outputParts: string[] = [];

    // [LEVEL]
    outputParts.push(`${BRIGHT}${color}[${level}]${RESET}`);

    // (functionName)
    if (this.showFunctionName && functionName) {
      outputParts.push(`${color}${functionName}${RESET}`);
    }

    // (file:line)
    if (this.showFileAndLine && fileAndLine) {
      outputParts.push(`${color}${fileAndLine}${RESET}`);
    }

    // Main log message
    outputParts.push(`${color}${message}${RESET}`);

    const output = outputParts.join(" ");

    // Print to console with any extra args
    console.log(output, ...args);
  }

  /* Log level methods */

  debug(message: unknown, ...args: unknown[]): void {
    this.log(LogLevel.DEBUG, LogColors.DEBUG, message, ...args);
  }
  
  info(message: unknown, ...args: unknown[]): void {
    this.log(LogLevel.INFO, LogColors.INFO, message, ...args);
  }
  
  warn(message: unknown, ...args: unknown[]): void {
    this.log(LogLevel.WARN, LogColors.WARN, message, ...args);
  }
  
  error(message: unknown, ...args: unknown[]): void {
    this.log(LogLevel.ERROR, LogColors.ERROR, message, ...args);
  }
  
  fatal(message: unknown, ...args: unknown[]): void {
    this.log(LogLevel.FATAL, LogColors.FATAL, message, ...args);
  }
}

export const logger = new SimpleLogger({
  minLevel: LogLevel.DEBUG,
  showFunctionName: true,
  showFileAndLine: true,
});