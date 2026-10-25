const { spawnSync } = require("node:child_process");
const { readdirSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const biome = path.join(root, "node_modules/@biomejs/biome/bin/biome");
const sources = [
  "kinopoisk-kinokino.user.js",
  ...readdirSync(__dirname).map((name) => `scripts/${name}`),
];
const checks = [
  ...sources.map((file) => ["--check", file]),
  [biome, "format", "."],
  [biome, "lint", "--error-on-warnings", "."],
  ["--test", "tests/userscript.test.cjs"],
];

for (const args of checks) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}
