import { Console } from "node:console";
import process from "node:process";

export type DeepPartial<T> = T extends object ? {
    [P in keyof T]?: DeepPartial<T[P]>;
  }
  : T;

type ConsoleInstance = InstanceType<typeof Console>;

export class Logger extends Console {
  constructor(private readonly scope: string) {
    super(process.stdout, process.stderr);
  }

  // deno-lint-ignore no-explicit-any
  private format(message: string, extraData: any, level: string) {
    return JSON.stringify({
      scope: this.scope,
      timestamp: new Date().toISOString(),
      message,
      level,
      ...extraData,
    });
  }

  override log(message: string, extraData?: unknown) {
    super.log(this.format(message, extraData, "debug"));
  }

  override info(message: string, extraData?: unknown) {
    super.error(this.format(message, extraData, "info"));
  }

  override error(message: string, extraData?: unknown) {
    super.error(this.format(message, extraData, "error"));
  }

  override warn(message: string, extraData?: unknown) {
    super.warn(this.format(message, extraData, "warn"));
  }
}
