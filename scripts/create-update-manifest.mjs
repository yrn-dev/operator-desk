import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(project, "release");
const cliProject = path.resolve(project, "..", "Operator");
const desktop = JSON.parse(await readFile(path.join(project, "package.json"), "utf8"));
const cliPackage = JSON.parse(await readFile(path.join(cliProject, "package.json"), "utf8"));
const desktopNotes = await readFile(path.join(project, "CHANGELOG.md"), "utf8");
const cliNotes = await readFile(path.join(cliProject, "CHANGELOG.md"), "utf8");

function section(markdown, heading) {
  const start = markdown.indexOf(heading);
  if (start < 0) throw new Error(`Release notes not found: ${heading}`);
  const bodyStart = markdown.indexOf("\n", start) + 1;
  const level = heading.startsWith("## ") ? "## " : "# ";
  const next = markdown.indexOf(`\n${level}`, bodyStart);
  return markdown.slice(bodyStart, next < 0 ? undefined : next).trim().slice(0, 600);
}

async function sha512(file) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(path.join(releaseDir, file))) hash.update(chunk);
  return hash.digest("base64");
}

async function asset(file) {
  return { url: `https://opr.pzero.kz/download/${file}`, sha512: await sha512(file) };
}

const desktopHeading = `# Operator Desktop ${desktop.version}`;
const cliHeading = `## [${cliPackage.version}]`;
const manifest = {
  cli: {
    version: cliPackage.version,
    packageName: cliPackage.name,
    note: section(cliNotes, cliHeading),
  },
  desktop: {
    version: desktop.version,
    notes: section(desktopNotes, desktopHeading),
    packages: {
      win32: await asset(`Operator-${desktop.version}-win-x64.exe`),
      linux: {
        appimage: await asset(`Operator-${desktop.version}-linux-x86_64.AppImage`),
        deb: await asset(`Operator-${desktop.version}-linux-amd64.deb`),
        pacman: await asset(`Operator-${desktop.version}-linux-x64.pacman`),
      },
    },
  },
};

await mkdir(path.join(releaseDir, desktop.version), { recursive: true });
await writeFile(path.join(releaseDir, "operator-updates.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Создан ${path.join(releaseDir, "operator-updates.json")}`);
