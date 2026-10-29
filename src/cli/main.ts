import { run } from "./runner";

async function main(): Promise<void> {
  process.exit(await run(process.argv.slice(2)));
}

void main();
