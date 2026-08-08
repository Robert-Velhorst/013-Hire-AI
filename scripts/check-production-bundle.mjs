import fs from "node:fs";
import path from "node:path";

const outputPath = path.resolve("dist", "public", "index.html");
const maximumShellBytes = 25 * 1024;

if (!fs.existsSync(outputPath)) {
  throw new Error(`Production shell was not found at ${outputPath}.`);
}

const html = fs.readFileSync(outputPath, "utf8");
const bytes = Buffer.byteLength(html);
const forbiddenMarkers = [
  "manus-runtime",
  "__MANUS_HOST_DEV__",
  "data-jscodex-",
];
const marker = forbiddenMarkers.find((candidate) => html.includes(candidate));

if (marker) {
  throw new Error(`Production shell contains development instrumentation: ${marker}.`);
}
if (bytes > maximumShellBytes) {
  throw new Error(`Production shell is ${bytes} bytes; the limit is ${maximumShellBytes} bytes.`);
}

console.log(`Production shell check passed: ${bytes} bytes and no development instrumentation.`);
