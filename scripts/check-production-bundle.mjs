import fs from "node:fs";
import path from "node:path";

const outputPath = path.resolve("dist", "public", "index.html");
const maximumShellBytes = 25 * 1024;
const maximumJavaScriptChunkBytes = 350 * 1024;
const maximumStartupJavaScriptBytes = 600 * 1024;

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

const assetsPath = path.resolve("dist", "public", "assets");
const javascriptChunks = fs.readdirSync(assetsPath)
  .filter((name) => name.endsWith(".js"))
  .map((name) => ({ name, bytes: fs.statSync(path.join(assetsPath, name)).size }))
  .sort((left, right) => right.bytes - left.bytes);
const oversizedChunk = javascriptChunks.find((chunk) => chunk.bytes > maximumJavaScriptChunkBytes);
if (oversizedChunk) {
  throw new Error(
    `Production JavaScript chunk ${oversizedChunk.name} is ${oversizedChunk.bytes} bytes; ` +
      `the limit is ${maximumJavaScriptChunkBytes} bytes.`,
  );
}

const startupAssetNames = [
  ...new Set(
    [...html.matchAll(/(?:src|href)="\/assets\/([^"?]+\.js)"/g)].map((match) => match[1]),
  ),
];
const startupJavaScriptBytes = startupAssetNames.reduce(
  (total, name) => total + fs.statSync(path.join(assetsPath, name)).size,
  0,
);
if (startupJavaScriptBytes > maximumStartupJavaScriptBytes) {
  throw new Error(
    `Production startup JavaScript is ${startupJavaScriptBytes} bytes; ` +
      `the limit is ${maximumStartupJavaScriptBytes} bytes.`,
  );
}

console.log(
  `Production shell check passed: ${bytes} bytes, no development instrumentation, ` +
    `${javascriptChunks.length} JavaScript chunks within ${maximumJavaScriptChunkBytes} bytes, and ` +
    `${startupJavaScriptBytes} startup JavaScript bytes within ${maximumStartupJavaScriptBytes} bytes.`,
);
