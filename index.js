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

const entities = [...workbook.crate.entities()];

function buildLookup(field, type) {
  const lookup = new Map();

  for (const entity of entities) {
    const value = entity[field];
    const types = Array.isArray(entity["@type"])
      ? entity["@type"]
      : [entity["@type"]];

    if (
      typeof value === "string" &&
      value &&
      types.includes(type) &&
      typeof entity["@id"] === "string"
    ) {
      lookup.set(value.trim(), entity["@id"]);
    }
  }

  return lookup;
}

const filesByName = buildLookup("item_record_file_file_name", "File");
const coverImagesByName = buildLookup("cover_image_file_name", "File");
const placesByName = new Map([
  ...buildLookup("name", "Place"),
  ...buildLookup("place", "Place")
]);

function setReference(entity, property, value, lookup, array = false) {
  const key = typeof value === "string" ? value.trim() : "";
  const targetId = key && lookup.get(key);

  if (targetId) {
    const ref = { "@id": targetId };
    entity[property] = array ? [ref] : ref;
  } else if (
    entity[property] &&
    JSON.stringify(entity[property]).includes("object Object")
  ) {
    delete entity[property];
  }
}

for (const entity of entities) {
  setReference(
    entity,
    "hasPart",
    entity.item_record_file_file_name,
    filesByName,
    true
  );
  setReference(
    entity,
    "image",
    entity.cover_image_file_name,
    coverImagesByName,
    true
  );
  setReference(
    entity,
    "call:placeOfOrigin",
    entity.place_of_origin,
    placesByName
  );
  setReference(
    entity,
    "call:placeOfPublication",
    entity.place_of_publication,
    placesByName
  );
  entity.place_of_publication = undefined;
}

for (const entity of workbook.crate.entities()) {
  if (entity.item_record_file_file_name) {
    console.log(
      entity["@id"],
      entity.item_record_file_file_name
    );
  }
}

function fixRef(ref) {
  if (!ref) return ref;

  if (typeof ref === "string") {
    return { "@id": ref };
  }

  if (
    typeof ref === "object" &&
    ref["@id"]
  ) {

    if (typeof ref["@id"] === "string") {
      return ref;
    }

    if (
      typeof ref["@id"] === "object" &&
      ref["@id"]["@id"]
    ) {
      return {
        "@id": ref["@id"]["@id"]
      };
    }
  }

  return ref;
}

function fixRefArray(value) {
  if (!value) return value;

  if (Array.isArray(value)) {
    return value.map(fixRef);
  }

  return fixRef(value);
}

for (const entity of workbook.crate.entities()) {

  //
  // Fix reference corruption
  //

  if (entity.hasPart) {
    entity.hasPart =
      fixRefArray(entity.hasPart);
  }

  if (entity.image) {
    entity.image =
      fixRefArray(entity.image);
  }

  if (entity.license) {
    entity.license =
      fixRefArray(entity.license);
  }

  if (entity.publisher) {
    entity.publisher =
      fixRefArray(entity.publisher);
  }

  if (entity.inLanguage) {
    entity.inLanguage =
      fixRefArray(entity.inLanguage);
  }

  //
  // Repository Objects
  //

  if (
    entity["@id"] &&
    String(entity["@id"]).startsWith("#object_")
  ) {

    entity["@type"] = [
      "RepositoryObject"
    ];

    entity.conformsTo = {
      "@id":
        "https://w3id.org/ldac/profile#Object"
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

    if (
      typeof entity.keyword ===
      "string"
    ) {

      entity.keywords =
        entity.keyword
          .split(",")
          .map(v => v.trim())
          .filter(Boolean);

      delete entity.keyword;
    }

    if (
      typeof entity.subject ===
      "string"
    ) {

      entity.subject =
        entity.subject
          .split(",")
          .map(v => ({
            "@type": "Thing",
            name: v.trim()
          }));
    }

    if (
      typeof entity.sponsors ===
      "string"
    ) {

      entity.sponsor =
        entity.sponsors
          .split(",")
          .map(v => ({
            "@type":
              "Organization",
            name: v.trim()
          }));

      delete entity.sponsors;
    }
  }

  //
  // Files
  //

  if (
    entity.item_record_file_file_name
  ) {

    entity["@type"] = "File";

    entity.name =
      entity.item_record_file_file_name;

    entity.encodingFormat =
      entity.item_record_file_content_type;

    entity.contentSize =
      entity.item_record_file_file_size;

    entity.dateModified =
      entity.item_record_file_updated_at;
  }

  if (
    entity.cover_image_file_name
  ) {

    entity["@type"] = "File";

    entity.name =
      entity.cover_image_file_name;

    entity.encodingFormat =
      entity.cover_image_content_type;

    entity.contentSize =
      entity.cover_image_file_size;

    entity.dateModified =
      entity.cover_image_updated_at;
  }

  //
  // Languages
  //

  if (
    entity.full_language_name
  ) {

    entity["@type"] =
      "Language";

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

    entity["@type"] =
      "Organization";

    entity.identifier =
      entity.publisher_id;
  }

  //
  // Places
  //

  if (
    entity["@id"] &&
    String(entity["@id"]).startsWith(
      "#place_"
    )
  ) {

    entity["@type"] = "Place";
  }

  //
  // Licences
  //

  if (
    entity.licence_id ||
    entity[
      "ldac:allowTextIndex"
    ] !== undefined
  ) {

    entity["@type"] =
      "ldac:DataReuseLicense";

    if (
      entity.allowTextIndex &&
      entity[
        "ldac:allowTextIndex"
      ] === undefined
    ) {

      entity[
        "ldac:allowTextIndex"
      ] =
        entity.allowTextIndex;

      delete entity.allowTextIndex;
    }
  }
}

const root =
  workbook.crate.rootDataset;

root["@type"] = [
  "Dataset",
  "RepositoryCollection"
];

root.name =
  root.name ||
  "CALL Collection";

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
