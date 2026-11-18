import * as XLSX from "xlsx";
import * as fs from "fs";
import * as roCrateExcel from "ro-crate-excel";

XLSX.set_fs(fs);

const workbook = new roCrateExcel.Workbook();

await workbook.loadExcel(
  "ro-crate-metadata-call.xlsx",
  false
);

await workbook.workbookToCrate();

//
// Enrich generated entities
//

for (const entity of workbook.crate.entities()) {

  //
  // Objects
  //

  if (
    entity["@id"] &&
    entity["@id"].startsWith("#object_")
  ) {

    entity["@type"] = [
      "RepositoryObject"
    ];

    entity.conformsTo = {
      "@id": "https://w3id.org/ldac/profile#Object"
    };

    if (entity.activity) {
      entity.activity = {
        "@type": "DefinedTerm",
        name: entity.activity
      };
    }

    if (entity.type) {
      entity.additionalType = {
        "@type": "DefinedTerm",
        name: entity.type
      };

      delete entity.type;
    }

    if (entity.record_format) {
      entity.recordFormat = {
        "@type": "DefinedTerm",
        name: entity.record_format
      };

      delete entity.record_format;
    }

    if (typeof entity.keyword === "string") {

      entity.keywords = entity.keyword
        .split(",")
        .map(v => v.trim())
        .filter(Boolean);

      delete entity.keyword;
    }

    if (typeof entity.subject === "string") {

      entity.subject = entity.subject
        .split(",")
        .map(v => ({
          "@type": "Thing",
          name: v.trim()
        }));
    }

    if (typeof entity.sponsors === "string") {

      entity.sponsor = entity.sponsors
        .split(",")
        .map(v => ({
          "@type": "Organization",
          name: v.trim()
        }));

      delete entity.sponsors;
    }
  }

  //
  // Files
  //

  if (entity.item_record_file_file_name) {

    entity["@type"] = "File";

    entity.name =
      entity.item_record_file_file_name;

    if (entity.item_record_file_content_type) {
      entity.encodingFormat =
        entity.item_record_file_content_type;
    }

    if (entity.item_record_file_file_size) {
      entity.contentSize =
        entity.item_record_file_file_size;
    }

    if (entity.item_record_file_updated_at) {
      entity.dateModified =
        entity.item_record_file_updated_at;
    }
  }

  //
  // Languages
  //

  if (entity.full_language_name) {

    entity["@type"] = "Language";

    entity.name =
      entity.full_language_name;

    if (entity.names) {
      entity.alternateName =
        entity.names;
    }

    if (entity.ISO_code) {
      entity.identifier =
        entity.ISO_code;
    }
  }

  //
  // Publishers
  //

  if (
    entity.publisher_id &&
    entity.name
  ) {

    entity["@type"] = "Organization";

    entity.identifier =
      entity.publisher_id;
  }

  //
  // Places
  //

  if (
    entity["@id"] &&
    entity["@id"].startsWith("#place_")
  ) {

    entity["@type"] = "Place";
  }

  //
  // Licences
  //

  if (
    entity.licence_id ||
    entity["ldac:allowTextIndex"] !== undefined
  ) {

    entity["@type"] =
      "ldac:DataReuseLicense";

    if (
      entity.allowTextIndex &&
      entity["ldac:allowTextIndex"] === undefined
    ) {

      entity["ldac:allowTextIndex"] =
        entity.allowTextIndex;

      delete entity.allowTextIndex;
    }
  }
}

//
// Root dataset
//

const root =
  workbook.crate.rootDataset;

root["@type"] = [
  "Dataset",
  "RepositoryCollection"
];

root.name =
  root.name ||
  "CALL Collection";

//
// Write crate
//

const json =
  workbook.crate.getJson();

fs.writeFileSync(
  "ro-crate-metadata.json",
  JSON.stringify(
    json,
    null,
    2
  )
);

console.log(
  "ro-crate-metadata.json written"
);