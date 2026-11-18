import postgres from 'postgres';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import path from "path";

const excelFile = "ro-crate-metadata-call.xlsx";
const filesRoot = path.join(process.cwd(), "files");

function getAllFiles(dir, result = []) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            getAllFiles(fullPath, result);
        } else {
            result.push(fullPath);
        }
    }

    return result;
}

// filename -> relative path
const fileMap = new Map();

for (const file of getAllFiles(filesRoot)) {
    const fileName = path.basename(file);

    fileMap.set(
        fileName,
        path.relative(process.cwd(), file).replace(/\\/g, "/")
    );
}

const workbook = XLSX.readFile(excelFile);
const sheet = workbook.Sheets["Files"];

if (!sheet) {
    throw new Error('Workbook is missing the "Files" sheet.');
}

const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: ""
});

for (const row of rows) {
    const fileName =
        row.item_record_file_file_name?.trim();

    if (!fileName) continue;

    const relativePath = fileMap.get(fileName);

    if (relativePath) {
        row["@id"] = relativePath;
    }
}

workbook.Sheets["Files"] =
    XLSX.utils.json_to_sheet(rows);

const objectsSheet = workbook.Sheets["Objects"];

if (!objectsSheet) {
    throw new Error('Workbook is missing the "Objects" sheet.');
}

const objectRange = XLSX.utils.decode_range(objectsSheet["!ref"]);
let objectFileNameColumn = -1;
let hasPartColumn = -1;

for (let column = objectRange.s.c; column <= objectRange.e.c; column++) {
    const header = objectsSheet[
        XLSX.utils.encode_cell({ r: objectRange.s.r, c: column })
    ]?.v;

    if (header === "item_record_file_file_name") {
        objectFileNameColumn = column;
    } else if (header === "isRef_hasPart") {
        hasPartColumn = column;
    }
}

if (objectFileNameColumn === -1) {
    throw new Error('Objects sheet is missing the "item_record_file_file_name" column.');
}

if (hasPartColumn === -1) {
    hasPartColumn = objectRange.e.c + 1;
    objectsSheet[XLSX.utils.encode_cell({
        r: objectRange.s.r,
        c: hasPartColumn
    })] = { t: "s", v: "isRef_hasPart" };
    objectRange.e.c = hasPartColumn;
    objectsSheet["!ref"] = XLSX.utils.encode_range(objectRange);
}

const fileIdsByName = new Map();

for (const row of rows) {
    const fileName = row.item_record_file_file_name?.trim();
    const fileId = row["@id"]?.trim();

    if (!fileName || !fileId) continue;

    const fileIds = fileIdsByName.get(fileName) || [];
    fileIds.push(fileId);
    fileIdsByName.set(fileName, fileIds);
}

let matchedObjects = 0;

for (let rowIndex = objectRange.s.r + 1; rowIndex <= objectRange.e.r; rowIndex++) {
    const fileName = objectsSheet[
        XLSX.utils.encode_cell({ r: rowIndex, c: objectFileNameColumn })
    ]?.v?.toString().trim();
    const fileIds = fileName ? fileIdsByName.get(fileName) : undefined;

    if (fileIds?.length) {
        const cellAddress = XLSX.utils.encode_cell({
            r: rowIndex,
            c: hasPartColumn
        });
        objectsSheet[cellAddress] = {
            ...objectsSheet[cellAddress],
            t: "s",
            v: fileIds.length === 1 ? fileIds[0] : `[${fileIds.join(",")}]`
        };
        matchedObjects++;
    }
}

XLSX.writeFile(workbook, excelFile);

console.log(`Files sheet updated; mapped ${matchedObjects} Objects rows.`);