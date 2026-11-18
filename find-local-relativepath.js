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

XLSX.writeFile(workbook, excelFile);

console.log("Files sheet updated.");