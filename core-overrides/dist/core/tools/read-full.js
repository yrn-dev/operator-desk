import { Text } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access as fsAccess, readFile as fsReadFile } from "node:fs/promises";
import { extname } from "node:path";
import { promisify } from "node:util";
import { Type } from "typebox";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.js";
import { resolveReadPath } from "./path-utils.js";
import { getTextOutput, invalidArgText, replaceTabs, shortenPath, str } from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
import { formatSize, truncateHead } from "./truncate.js";

const execFileAsync = promisify(execFile);
const FULL_READ_DEFAULT_MAX_LINES = 10000;
const FULL_READ_DEFAULT_MAX_BYTES = 64 * 1024;
const FULL_READ_MAX_BYTES_CAP = 1024 * 1024;

const readFullSchema = Type.Object({
    path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
    offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
    limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read (default: 10000)" })),
    maxBytes: Type.Optional(Type.Number({ description: "Maximum bytes to return for this chunk (default: 65536, hard cap: 1048576). Increase only when the task needs a larger chunk." })),
});

const defaultReadFullOperations = {
    readFile: (path) => fsReadFile(path),
    access: (path) => fsAccess(path, constants.R_OK),
    execFile: (file, args, options) => execFileAsync(file, args, options),
};

function formatReadFullCall(args, theme) {
    const rawPath = str(args?.file_path ?? args?.path);
    const path = rawPath !== null ? shortenPath(rawPath) : null;
    const offset = args?.offset;
    const limit = args?.limit;
    const invalidArg = invalidArgText(theme);
    let pathDisplay = path === null ? invalidArg : path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
    if (offset !== undefined || limit !== undefined) {
        const startLine = offset ?? 1;
        const endLine = limit !== undefined ? startLine + limit - 1 : "";
        pathDisplay += theme.fg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
    }
    return `${theme.fg("toolTitle", theme.bold("file.read_full"))} ${pathDisplay}`;
}

function trimTrailingEmptyLines(lines) {
    let end = lines.length;
    while (end > 0 && lines[end - 1] === "") {
        end--;
    }
    return lines.slice(0, end);
}

function formatReadFullResult(args, result, options, theme, showImages) {
    const output = getTextOutput(result, showImages);
    const renderedLines = output.split("\n");
    const lines = trimTrailingEmptyLines(renderedLines);
    const maxLines = options.expanded ? lines.length : 16;
    const displayLines = lines.slice(0, maxLines);
    const remaining = lines.length - maxLines;
    let text = `\n${displayLines.map((line) => theme.fg("toolOutput", replaceTabs(line))).join("\n")}`;
    if (remaining > 0) {
        text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")})`;
    }
    const truncation = result.details?.truncation;
    if (truncation?.truncated) {
        text += `\n${theme.fg("warning", `[Chunk truncated at ${formatSize(truncation.maxBytes)}. Continue with offset=${result.details?.nextOffset ?? "next line"}]`)}`;
    }
    const extraction = result.details?.extraction;
    if (extraction?.mode && extraction.mode !== "text") {
        text += `\n${theme.fg("muted", `[Extracted via ${extraction.mode}]`)}`;
    }
    return text;
}

function decodeXmlEntities(text) {
    return text
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#([0-9]+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)));
}

function collapseBlankLines(text) {
    return text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function stripXmlText(xml) {
    const withParagraphs = xml
        .replace(/<\/w:p>/g, "\n")
        .replace(/<w:tab[^>]*\/>/g, "\t")
        .replace(/<text:p[^>]*>/g, "\n")
        .replace(/<\/text:p>/g, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<\/h[1-6]>/gi, "\n");
    const withoutTags = withParagraphs.replace(/<[^>]+>/g, "");
    return collapseBlankLines(decodeXmlEntities(withoutTags));
}

function stripRtfText(rtf) {
    const hexDecoded = rtf.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => {
        try {
            return Buffer.from(hex, "hex").toString("latin1");
        }
        catch {
            return "";
        }
    });
    const plain = hexDecoded
        .replace(/\\par[d]?/g, "\n")
        .replace(/\\tab/g, "\t")
        .replace(/\\[a-z]+-?\d* ?/gi, "")
        .replace(/[{}]/g, "");
    return collapseBlankLines(plain);
}

function looksBinary(buffer) {
    const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
    let suspicious = 0;
    for (const byte of sample) {
        if (byte === 0) {
            return true;
        }
        if ((byte < 7 || (byte > 13 && byte < 32)) && byte !== 9 && byte !== 10 && byte !== 13) {
            suspicious++;
        }
    }
    return suspicious > sample.length * 0.1;
}

async function tryExec(ops, file, args, maxBuffer) {
    try {
        const result = await ops.execFile(file, args, {
            encoding: "utf8",
            maxBuffer,
            windowsHide: true,
        });
        return typeof result?.stdout === "string" ? result.stdout : "";
    }
    catch {
        return "";
    }
}

async function extractDocumentText(absolutePath, ops) {
    const extension = extname(absolutePath).toLowerCase();
    if (extension === ".docx") {
        const xml = await tryExec(ops, "unzip", ["-p", absolutePath, "word/document.xml"], FULL_READ_MAX_BYTES_CAP * 8);
        if (xml.trim()) {
            return { text: stripXmlText(xml), mode: "docx" };
        }
    }
    if (extension === ".odt") {
        const xml = await tryExec(ops, "unzip", ["-p", absolutePath, "content.xml"], FULL_READ_MAX_BYTES_CAP * 8);
        if (xml.trim()) {
            return { text: stripXmlText(xml), mode: "odt" };
        }
    }
    if (extension === ".pdf") {
        const pdfText = await tryExec(ops, "pdftotext", ["-layout", "-nopgbrk", "-q", absolutePath, "-"], FULL_READ_MAX_BYTES_CAP * 8);
        if (pdfText.trim()) {
            return { text: collapseBlankLines(pdfText), mode: "pdf" };
        }
        const stringText = await tryExec(ops, "strings", ["-n", "6", absolutePath], FULL_READ_MAX_BYTES_CAP * 8);
        if (stringText.trim()) {
            return { text: collapseBlankLines(stringText), mode: "pdf-strings" };
        }
    }
    if (extension === ".rtf") {
        const raw = await ops.readFile(absolutePath);
        return { text: stripRtfText(raw.toString("utf8")), mode: "rtf" };
    }
    const raw = await ops.readFile(absolutePath);
    if (!looksBinary(raw)) {
        return { text: raw.toString("utf8"), mode: "text" };
    }
    const stringText = await tryExec(ops, "strings", ["-n", "6", absolutePath], FULL_READ_MAX_BYTES_CAP * 8);
    if (stringText.trim()) {
        return { text: collapseBlankLines(stringText), mode: "strings" };
    }
    throw new Error("File appears to be binary and no text extraction method succeeded");
}

function renderChunk(text, offset, limit, maxBytes) {
    const allLines = text.replace(/\r/g, "").split("\n");
    const totalLines = allLines.length;
    const startLine = offset ? Math.max(0, offset - 1) : 0;
    if (startLine >= totalLines) {
        throw new Error(`Offset ${offset} is beyond end of file (${totalLines} lines total)`);
    }
    const requestedLimit = Math.max(1, Math.floor(limit ?? FULL_READ_DEFAULT_MAX_LINES));
    const requestedMaxBytes = Math.min(FULL_READ_MAX_BYTES_CAP, Math.max(1024, Math.floor(maxBytes ?? FULL_READ_DEFAULT_MAX_BYTES)));
    const endLine = Math.min(totalLines, startLine + requestedLimit);
    const selectedContent = allLines.slice(startLine, endLine).join("\n");
    const truncation = truncateHead(selectedContent, {
        maxLines: requestedLimit,
        maxBytes: requestedMaxBytes,
    });
    const chunkStart = startLine + 1;
    const chunkEnd = chunkStart + Math.max(truncation.outputLines - 1, 0);
    const remainingAfterChunk = totalLines - (startLine + truncation.outputLines);
    let outputText = truncation.content;
    const notices = [
        `[Lines ${chunkStart}-${chunkEnd} of ${totalLines}, ${formatSize(Buffer.byteLength(text, "utf8"))} total]`,
    ];
    let nextOffset;
    if (remainingAfterChunk > 0) {
        nextOffset = chunkEnd + 1;
        notices.push(`${remainingAfterChunk} more lines remain`);
    }
    if (truncation.truncated) {
        notices.push(`chunk capped at ${formatSize(requestedMaxBytes)}`);
    }
    if (notices.length > 0) {
        outputText += `${outputText ? "\n\n" : ""}${notices.join(". ")}.`;
        if (nextOffset) {
            outputText += ` Use offset=${nextOffset} to continue.`;
        }
    }
    return {
        outputText,
        details: {
            truncation: {
                ...truncation,
                maxBytes: requestedMaxBytes,
            },
            totalLines,
            nextOffset,
        },
    };
}

export function createReadFullToolDefinition(cwd, options) {
    const ops = options?.operations ?? defaultReadFullOperations;
    return {
        name: "read_full",
        label: "file.read_full",
        description: `Read larger chunks of files and extract text from document-style formats. Best for large source files and documents like PDF, DOCX, ODT, and RTF. Returns up to ${FULL_READ_DEFAULT_MAX_LINES} lines or ${formatSize(FULL_READ_DEFAULT_MAX_BYTES)} per call by default, with offset-based continuation.`,
        promptSnippet: "Read large or document-style files with larger chunks and text extraction",
        promptGuidelines: [
            "Read only the needed sections; continue with nextOffset when necessary. Increase maxBytes only when a larger chunk is needed.",
            "Use read_full for PDF, DOCX, ODT, RTF, or binary-ish files that still contain extractable text.",
        ],
        parameters: readFullSchema,
        async execute(_toolCallId, { path, offset, limit, maxBytes }, signal) {
            const absolutePath = resolveReadPath(path, cwd);
            if (signal?.aborted) {
                throw new Error("Operation aborted");
            }
            await ops.access(absolutePath);
            if (signal?.aborted) {
                throw new Error("Operation aborted");
            }
            const extraction = await extractDocumentText(absolutePath, ops);
            if (signal?.aborted) {
                throw new Error("Operation aborted");
            }
            const chunk = renderChunk(extraction.text, offset, limit, maxBytes);
            return {
                content: [{ type: "text", text: chunk.outputText }],
                details: {
                    ...chunk.details,
                    extraction: { mode: extraction.mode },
                },
            };
        },
        renderCall(args, theme, context) {
            const text = context.lastComponent ?? new Text("", 0, 0);
            text.setText(formatReadFullCall(args, theme));
            return text;
        },
        renderResult(result, options, theme, context) {
            const text = context.lastComponent ?? new Text("", 0, 0);
            text.setText(formatReadFullResult(context.args, result, options, theme, context.showImages));
            return text;
        },
    };
}

export function createReadFullTool(cwd, options) {
    return wrapToolDefinition(createReadFullToolDefinition(cwd, options));
}
