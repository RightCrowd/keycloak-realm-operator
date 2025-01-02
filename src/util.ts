import { Console } from "node:console";
import process from "node:process";

type ConsoleInstance = InstanceType<typeof Console>

export class Logger extends Console {
  constructor(private readonly scope: string) {
    super(process.stdout, process.stderr);
  }

  // deno-lint-ignore no-explicit-any
  private format(message: string, extraData?: any) {
    return JSON.stringify({
      scope: this.scope,
      timestamp: new Date().toISOString(),
      message,
      ...extraData
    })
  }

  override log(message: string, extraData?: unknown) {
    super.log(this.format(message, extraData));
  }

  override info(message: string, extraData?: unknown) {
    super.error(this.format(message, extraData));
  }

  override error(message: string, extraData?: unknown) {
    super.error(this.format(message, extraData));
  }

  override warn(message: string, extraData?: unknown) {
    super.warn(this.format(message, extraData));
  }
}
