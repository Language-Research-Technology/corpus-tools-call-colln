# CALL Corpus RO-Crate Export Specification

## Goal

Adapt `index.js` to export the CALL PostgreSQL database as one corpus RO-Crate in an OCFL repository, following the [COOEE exporter](https://github.com/Language-Research-Technology/corpus-tools-cooee). Use `Collector` from `oni-ocfl` to create the corpus object and add its metadata to `corpus.crate`. Each `item_records` row becomes a `RepositoryObject` in that one corpus crate, not a separate OCFL object or crate.

The RO-Crate replaces the spreadsheet as the primary output. Preserve the metadata and relationships currently represented in the workbook, and add links to the corresponding files where those relationships exist in the source database. Generate a spreadsheet of this ro-crate using the ro-crate-excel library as well.

## Current Source and Reference

- The current exporter reads `CALL_PG_URL`, with its existing production connection behavior, and writes `ro-crate-metadata.xlsx`.
- The Objects worksheet selects all `item_records` columns and joins licences, activities, publishers, languages, record formats, types, keywords, subjects, sponsors, and three categories of places.
- The People worksheet contains contributors and their name variants. ObjectPersonRole represents item-contributor-role relationships. Languages contains languages and their names; Licenses contains licence metadata.
- The original spreadsheet exporter had no Places worksheet or file mapping. Places were represented only as names on Objects. Item and cover file names are stored in `item_records` and matched to local folders as described below.
- COOEE creates a `Collector`, calls `coll.newObject(coll.templateCrateDir)`, populates `corpus.crate` and `corpus.rootDataset`, assigns repository objects to `pcdm:hasMember`, and calls `corpus.addToRepo()` once. It uses collection and object language-data-commons profiles and stable ARCP IDs.

## Output and Lifecycle

1. Connect to PostgreSQL using `CALL_PG_URL`. Keep credentials out of output, logs, and crate metadata.
2. Configure `Collector` with the repository, scratch, namespace, and template settings required by the installed `oni-ocfl` version. Follow COOEE's command-line conventions where applicable, without requiring its Excel input.
3. Create one corpus object from the configured template, obtain `corpus.crate` and `corpus.rootDataset`, retain applicable template metadata and files, and mint the collection identifier using the collector's conventions.
4. Type the root as `Dataset` and `RepositoryCollection`, and apply the language-data-commons Collection profile. Represent every source item as a `RepositoryObject` conforming to the Object profile, with a namespace-prefixed ARCP `@id` following `arcp://name,<namespace>/<full_language_name>_<AIATSIS_area><AIATSIS_district>/<language_series_number>/<year_of_entry>/<accession_number>`. Add the items to the root's `pcdm:hasMember`.
5. Add contextual entities and file entities to the same corpus crate, connect them to their source items, and write the corpus through `corpus.addToRepo()` once. Follow the collector's supported file-ingest API when copying local files into the OCFL object.
6. Generate a spreadsheet from the completed RO-Crate using `ro-crate-excel`, rather than constructing an independent workbook directly from database rows. Document the spreadsheet output location and command or API used.
7. Close the database connection on both success and failure. Report failures clearly and return a nonzero exit status; do not silently publish an incomplete export.

## Identity and Data Mapping

Construct each `RepositoryObject` `@id` with `generateArcpId`, using the configured collection namespace. Match the item to its language by `language_series_number` and form the first path segment by concatenating `full_language_name`, `_`, `AIATSIS_area`, and `AIATSIS_district`, with no separator between area and district. Follow it with the item's `language_series_number`, `year_of_entry`, and `accession_number` as separate path segments. For example, namespace `callcolln`, language `Language` with area `A` and district `1`, and item components `001`, `2020`, `02` produce `arcp://name,callcolln/Language_A1/001/2020/02`. Preserve meaningful formatting, including leading zeroes, and URI-encode each complete path segment separately. Use this same ID for collection membership and every relationship that references the item. Keep the item primary key as an identifier or explicitly defined source property, not as a substitute for the prescribed `@id`.

Require a language name and all three item ID components; reject missing values or collisions before publication. Treat absent area or district as an empty string, retaining the underscore after the language name. Where series `0` has no language row, preserve the existing English fallback, producing a first segment of `English_`. Report the affected source item IDs and do not silently merge records. Changes to the language name, area, district, or item components change the item's ID; re-exporting existing data therefore changes item identities and references.

For languages, use the configured collection namespace and `language_series_number` for the entity ID; use PostgreSQL IDs only to resolve source relationships. For contributors, places, and relationship entities, use deterministic, distinct IDs based on source primary keys and the configured collection namespace, consistent with COOEE's `generateArcpId` conventions. For licences, retain the link-or-source-ID rule below. Do not derive identity solely from titles or names: these may be missing, duplicated, or changed. Repeated references to the same source record must resolve to one entity; different source records must not be merged merely because their names match. Keep the source ID as an identifier or explicitly defined source property.

| Source | Crate representation | Required relationships and values |
| --- | --- | --- |
| `item_records` | One `RepositoryObject` per row, identified by a namespace-prefixed ARCP ID with language metadata and the three item components | Preserve title as `name`, source ID, and the remaining non-null exported record metadata. Link the object to its files and related entities below. |
| `contributors`, `contributor_names` | One `Person` per contributor | Preserve `full_name` as `name`, other exported contributor fields, and all name variants with their `name_type`. Handle contributors with no names and ignore or report orphan name rows rather than crashing. |
| `item_record_contributor_roles`, `roles` | Item-to-person relationships with role information | Preserve every source association and its `role_type`, including multiple roles for the same item and person. Use role entities or documented role-specific properties so the role remains associated with the correct person and item. |
| `languages`, `language_names` | One `Language` entity per language | Preserve the full language name, source fields, and all language names. Link each item through the existing `item_records.language_series_number` to `languages.language_series_number`. |
| `places`, `item_record_places` | One `Place` entity per place | Link all associated places to their item while preserving each `place_type`, including Place of Origin, Location of Original, and Place of Publication. Do not use the current `MAX` aggregation, which can discard associations. |
| `licences` | Licence entity using its link as `@id` when usable, otherwise a stable source-based ID | Preserve name, permission details, `metadataIsPublic`, and `allowTextIndex`; link each item's licence. Retain the current `ldac:DataReuseLicense` type where appropriate. |
| Keywords, subjects, sponsors | Item metadata or referenced entities | Preserve all values and their associations; use arrays, not comma-delimited or bracket-encoded strings. Do not drop values containing commas. |
| Activities, publishers, record formats, types | Item metadata or referenced entities | Preserve the existing joined values and the original source fields, with clear, documented mappings. |
| `item_records.item_record_file_file_name`, `item_records.cover_image_file_name` | `File` entities linked to their owning items | Match each filename recursively in its respective local folder. Link item files with `hasPart`. Include only cover images in an `original` folder and link each cover to its item through both `hasPart` and `image`; preserve shared associations. |

Use RO-Crate and language-data-commons terms where their meaning fits. Define any CALL-specific properties in the crate's JSON-LD context with stable IRIs and document their source and meaning. Preserve non-null values from the existing `r.*`, contributor, language, and licence exports, including dates and booleans, without converting them into spreadsheet formatting. Document any deliberate exclusions or transformations and their rationale. Avoid publishing credentials, private filesystem paths, or metadata prohibited by the source access policy.

## Files and Missing Data

- Search `files/item_record_files` and `files/cover_images` recursively for exact, case-sensitive matches to their respective `item_records` filename columns. For covers, consider only files within a directory named `original` under `files/cover_images`; exclude other versions. Include all matching originals if more than one exists. Allow directory paths to be configured; do not follow symbolic links. Log missing eligible matches as errors and continue.
- Add each included cover image to its `RepositoryObject` using both `hasPart` and `image` references to the same `File` entity. Reuse that entity when the cover is shared by multiple items.
- For an available and permitted file, create one stable crate-relative `File` entity, include its content in the corpus object, and link it to each associated `RepositoryObject`, using the appropriate `hasPart`/file relationship consistently with the chosen profile. Preserve available file metadata such as name, media type, and source identifier. Ensure crate paths are unique and do not escape the crate.
- Preserve associations to shared files without duplicating or overwriting content. Do not represent an inaccessible or missing file as locally present. Where permitted, preserve its known metadata and source association as a clearly identified non-local reference; otherwise report it without exposing restricted information.
- Log each missing filename and its item identifier, report the total, and mark the export as incomplete while continuing with available files. An inaccessible source directory or another fatal error still stops the export. Records with no associated files must still produce repository objects.
- Omit absent optional values rather than creating invalid references. For orphaned relationships, report the affected IDs and do not create dangling references. Ensure references to entities within the crate resolve to entities in its graph.

## Verification and Acceptance

- Automated tests with representative database fixtures verify one corpus object and exactly one `RepositoryObject` per item, including duplicate or missing titles and records without files. Assert each item's exact language-prefixed `@id`, its use in membership and item references, missing area/district handling, and preservation of meaningful component formatting.
- Test missing ID components, duplicate resulting IDs, and collisions with other crate entities; each must produce an actionable error and prevent publication.
- Verify that contributor name variants, multiple contributor roles, all three place categories and multiple places of the same category, languages and their names, licences, keywords, subjects, sponsors, and other currently exported fields survive the mapping without loss or accidental merging.
- Verify one-to-many and shared file relationships, file content and paths, and missing/inaccessible file handling. Verify that only original cover images are included, each is referenced by both `hasPart` and `image`, and a filename with no eligible original is logged as missing. Verify missing references are logged and the completed export is identified as incomplete.
- Export the same fixture twice with unchanged ID components and namespace and verify stable entity IDs and relationships. Validate the generated `ro-crate-metadata.json`, graph references, collection membership, applicable profiles, and the resulting OCFL object using available RO-Crate and OCFL validation tools.
- Verify that `ro-crate-excel` produces a readable spreadsheet from the completed crate and that representative item IDs, contextual entities, and relationships are present in its output.
- Document prerequisites, configuration, ID component mappings, file-source assumptions, commands, crate and spreadsheet output locations, access restrictions, validation, and migration from the existing spreadsheet workflow in `README.md`.

## Decisions To Confirm Before Implementation

- Which local files and metadata are permitted to be exported under the source access policy?
- Which corpus template, collection namespace, repository and scratch locations, and collection metadata should be used?
- Which existing fields are private or restricted, and is an explicit metadata-only export needed when files are unavailable?
- Which exact role and place-type properties best match the applicable language-data-commons profile? Document the chosen mapping without losing source role/type values.