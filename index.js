import postgres from 'postgres';
import oni from 'oni-ocfl';
import vocabs from 'language-data-commons-vocabs';
import excel from 'ro-crate-excel';
import rocrate from 'ro-crate';
import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { itemId } from './item-id.js';

const { Collector, generateArcpId } = oni;
const { languageProfileURI } = vocabs;
const { Workbook } = excel;
const { ROCrate } = rocrate;

export function createRunLogger(directory = process.env.CALL_LOG_DIR || 'logs') {
  mkdirSync(directory, { recursive: true });
  const filename = `export-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.log`;
  const logPath = path.resolve(directory, filename);
  const descriptor = openSync(logPath, 'wx');
  const log = (level, message) => {
    writeSync(descriptor, `${new Date().toISOString()} ${level} ${message}\n`);
    const output = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
    output(message);
  };
  return {
    path: logPath,
    info: message => log('INFO', message),
    warn: message => log('WARN', message),
    error: message => log('ERROR', message),
    close: () => closeSync(descriptor)
  };
}

export function repositoryPath(cliPath, envPath) {
  return path.resolve(cliPath || envPath || path.join(path.dirname(fileURLToPath(import.meta.url)), 'ocfl-repo'));
}

export function configureCollector(collector) {
  collector.namespace = collector.namespace || 'callcolln';
  collector.repoPath = repositoryPath(collector.opts.repoPath, process.env.CALL_OCFL_REPO_PATH);
  return collector.opts.template || null;
}

export function fileDirectories(env = process.env) {
  return {
    itemFiles: env.CALL_ITEM_RECORD_FILES_DIR || path.join('files', 'item_record_files'),
    coverImages: env.CALL_COVER_IMAGE_DIR || path.join('files', 'cover_images')
  };
}

export function outputDirectory(env = process.env) {
  return env.CALL_OUTPUT_DIR || 'output';
}

export function rorCachePath(env = process.env) {
  return env.CALL_ROR_CACHE_PATH || path.join(path.dirname(fileURLToPath(import.meta.url)), 'ror-cache.json');
}

async function loadRorCache(cachePath) {
  try {
    return JSON.parse(await readFile(cachePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function saveRorCache(cachePath, cache) {
  await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
}

// Generic words common to both free-text publisher names and ROR org names; excluded
// when checking whether a match shares a real, distinctive word (see lookupRorId).
const GENERIC_ORG_WORDS = new Set([
  'the', 'and', 'of', 'for', 'inc', 'incorporated', 'ltd', 'limited', 'company', 'co',
  'corporation', 'corp', 'association', 'aboriginal', 'press', 'publishing', 'publishers',
  'publication', 'publications', 'group', 'committee', 'community', 'organisation',
  'organization', 'language', 'centre', 'center', 'council', 'service', 'services',
  'institute', 'school', 'department', 'government', 'university', 'college'
]);

function significantWords(name) {
  return new Set(name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(word => word.length > 2 && !GENERIC_ORG_WORDS.has(word)));
}

// ROR's affiliation-matching endpoint is built for exactly this "does this free-text
// name identify a known organization" question: it flags at most one result per query
// as `chosen` using its own matching algorithm, which is a much stronger signal than
// picking the highest `score` ourselves. But `chosen` alone is still not reliable for
// small or local organizations ROR doesn't actually have: real example seen in this
// project's data, all three "chosen" with high scores: "Korrawinga Aboriginal
// Corporation", "Thangkenharenge Aboriginal Corporation", and "Ngukurr Language
// Centre, Diwurruwurru-jaru Aboriginal Corporation" all confidently matched to ROR's
// entry for "UAL Corporation" (United Airlines' holding company), sharing nothing but
// the generic word "Corporation". Require the match to also share a distinctive,
// non-generic word with one of the organization's own names before trusting it.
export async function lookupRorId(name, fetchImpl = fetch) {
  const url = `https://api.ror.org/v2/organizations?affiliation=${encodeURIComponent(name)}`;
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`ROR API returned ${response.status} for "${name}"`);
  const body = await response.json();
  const chosen = (body.items || []).find(item => item.chosen);
  if (!chosen) return null;
  const sourceWords = significantWords(name);
  const matchedNames = chosen.organization.names || [];
  const plausible = matchedNames.some(matchedName => {
    for (const word of significantWords(matchedName.value)) {
      if (sourceWords.has(word)) return true;
    }
    return false;
  });
  return plausible ? chosen.organization.id : null;
}

// Resolves a ror_id for each publisher with a name, caching results on disk (by
// lowercased name) so repeat exports don't re-query ROR, and so a lookup failure just
// leaves that publisher without a ror_id instead of failing the whole export.
export async function enrichPublisherRorIds(publishers, { cachePath = rorCachePath(), fetchImpl = fetch, logger = console } = {}) {
  const cache = await loadRorCache(cachePath);
  let cacheChanged = false;
  const results = [];
  for (const publisher of publishers) {
    let rorId = null;
    if (hasValue(publisher.name)) {
      const key = publisher.name.trim().toLowerCase();
      if (key in cache) {
        rorId = cache[key];
      } else {
        try {
          rorId = await lookupRorId(publisher.name, fetchImpl);
        } catch (error) {
          logger.warn(`Publisher ${publisher.id}: ROR lookup failed for "${publisher.name}": ${error.message}`);
          rorId = null;
        }
        cache[key] = rorId;
        cacheChanged = true;
      }
    }
    results.push(rorId ? { ...publisher, ror_id: rorId } : publisher);
  }
  if (cacheChanged) await saveRorCache(cachePath, cache);
  return results;
}

const schemaMapping = JSON.parse(readFileSync(new URL('./schema-mapping.json', import.meta.url)));

// Looks up a source column name or free-text value (a role_type, name_type, etc.) in
// schema-mapping.json. Returns undefined, not a call: fallback, so callers can choose
// their own default for an unmapped key.
function mappedProperty(key) {
  return schemaMapping[key];
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== '';
}

function sourceProperties(record) {
  const result = {};
  for (const [key, value] of Object.entries(record)) {
    if (!hasValue(value)) continue;
    const property = mappedProperty(key) || `call:${key}`;
    const normalized = value instanceof Date ? value.toISOString() :
      typeof value === 'object' ? JSON.stringify(value) : value;
    // Several source columns can map to the same crate property (e.g. AIATSIS_area and
    // AIATSIS_district both become call:austlangCode); collect rather than overwrite.
    result[property] = property in result ? [].concat(result[property], normalized) : normalized;
  }
  return result;
}

export function populateCrate(crate, namespace, data, logger = console) {
  const termPrefix = generateArcpId(namespace, 'terms#');
  crate.addContext({ call: termPrefix, pcdm: 'http://pcdm.org/models#', ldac: 'https://w3id.org/ldac/terms#' });
  crate.addProfile(languageProfileURI('Collection'));
  const root = crate.rootDataset;
  root['@type'] = ['Dataset', 'RepositoryCollection'];
  root['name'] = 'CALL Collection';
  root['description'] = 'A collection of language data curated by the Center for Applied Linguistics (CALL).';  
  root['datePublished'] = new Date().toISOString();
  root['license'] = { '@id': 'https://creativecommons.org/licenses/by/4.0/' };
  const usedIds = new Set(crate.getGraph().map(entity => entity['@id']));
  const add = entity => {
    if (usedIds.has(entity['@id'])) throw new Error(`Duplicate crate entity ID: ${entity['@id']}`);
    usedIds.add(entity['@id']);
    crate.addEntity(entity);
    return crate.getEntity(entity['@id']);
  };
  const entityId = (kind, id) => generateArcpId(namespace, [kind, encodeURIComponent(String(id))]);
  const ref = entity => ({ '@id': entity['@id'] });
  const requireEntity = (map, id, label) => {
    const entity = map.get(String(id));
    if (!entity) throw new Error(`Dangling ${label}: ${id}`);
    return entity;
  };
  const entities = (records, kind, type, nameField) => new Map(records.map(record => {
    const entity = { '@id': entityId(kind, record.id), '@type': type, ...sourceProperties(record) };
    if (hasValue(record[nameField])) entity.name = record[nameField];
    return [String(record.id), add(entity)];
  }));

  const people = entities(data.contributors, 'person', 'Person', 'full_name');
  const places = entities(data.places, 'place', 'Place', 'name');
  const publishers = new Map(data.publishers.map(record => {
    // Different publisher rows must not collapse into one crate entity just because
    // they share a ror_id (whether a correct match for the same real organization
    // under different historical names, or two names ROR happened to match to the
    // same entry) - that would merge distinct source records. Only the first row to
    // claim a given ror_id keeps it as @id; later ones fall back to a generated id.
    const id = hasValue(record.ror_id) && !usedIds.has(record.ror_id) ? record.ror_id : entityId('publisher', record.id);
    if (hasValue(record.ror_id) && id !== record.ror_id) {
      logger.warn(`Publisher ${record.id}: ror_id ${record.ror_id} already used by another publisher; using a generated ID instead`);
    }
    const entity = { '@id': id, '@type': 'Organization', ...sourceProperties(record) };
    if (hasValue(record.name)) entity.name = record.name;
    return [String(record.id), add(entity)];
  }));
  const licences = new Map(data.licences.map(record => {
    const id = typeof record.link === 'string' && /^https?:\/\//i.test(record.link) ? record.link : entityId('licence', record.id);
    const entity = { '@id': id, '@type': 'ldac:DataReuseLicense', ...sourceProperties(record) };
    if (hasValue(record.name)) entity.name = record.name;
    if (hasValue(record.license_and_permission_details)) entity.description = record.license_and_permission_details;
    return [String(record.id), add(entity)];
  }));
  const languages = new Map();
  const languageBySeries = new Map();
  const languageSourceBySeries = new Map();
  for (const language of data.languages) {
    if (language.language_series_number == null || String(language.language_series_number).trim() === '') {
      throw new Error(`Language ${language.id}: missing language_series_number`);
    }
    const key = String(language.language_series_number);
    if (languageBySeries.has(key)) throw new Error(`Duplicate language series number: ${key}`);
    const entity = { '@id': entityId('language', key), '@type': 'Language', ...sourceProperties(language) };
    if (hasValue(language.full_language_name)) entity.name = language.full_language_name;
    // AIATSIS_area and AIATSIS_district both map to call:austlangCode; concatenate them directly
    // (e.g. 'N' + '81' -> 'N81') rather than collecting the generic sourceProperties array,
    // matching the language ID convention in item-id.js.
    const austlangCode = `${language.AIATSIS_area ?? ''}${language.AIATSIS_district ?? ''}`;
    if (austlangCode !== '') entity['call:austlangCode'] = austlangCode;
    const stored = add(entity);
    languages.set(String(language.id), stored);
    languageBySeries.set(key, stored);
    languageSourceBySeries.set(key, language);
  }
  if (!languageBySeries.has('0') && data.items.some(record => String(record.language_series_number) === '0')) {
    languageBySeries.set('0', add({
      '@id': entityId('language', '0'),
      '@type': 'Language',
      name: 'English',
      'call:language_series_number': '0'
    }));
    languageSourceBySeries.set('0', { full_language_name: 'English' });
  }
  const items = new Map();
  for (const record of data.items) {
    const language = requireEntity(languageSourceBySeries, record.language_series_number, 'item language');
    const id = generateArcpId(namespace, itemId(record, language));
    if (usedIds.has(id)) throw new Error(`Item ${record.id}: duplicate crate entity ID ${id}`);
    const entity = { '@id': id, '@type': 'RepositoryObject', conformsTo: { '@id': languageProfileURI('Object') }, ...sourceProperties(record) };
    if (hasValue(record.title)) entity.name = record.title;
    if (record.language_series_number != null) entity.inLanguage = ref(requireEntity(languageBySeries, record.language_series_number, 'item language'));
    if (record.licence_id != null) entity.license = ref(requireEntity(licences, record.licence_id, 'item licence'));
    // sourceProperties() already mapped publisher_id to the raw numeric call:publisher value
    // above; replace it with a proper reference, or drop it if the publisher doesn't resolve.
    delete entity.publisher;
    if (record.publisher_id != null) {
      const publisher = publishers.get(String(record.publisher_id));
      if (publisher) entity.publisher = ref(publisher);
      else logger.warn(`Item ${record.id}: publisher ${record.publisher_id} not found; omitting publisher`);
    }
    items.set(String(record.id), add(entity));
    (logger.info || logger.log)(`Created item ${items.size}/${data.items.length}: source ID ${record.id}, crate ID ${id}`);
  }
  root['pcdm:hasMember'] = [...items.values()].map(ref);

  for (const name of data.contributorNames) {
    if (name.contributor_id == null) {
      logger.warn('Skipping contributor name without contributor_id');
      continue;
    }
    const person = requireEntity(people, name.contributor_id, 'contributor name');
    const nameRecord = { '@id': entityId('contributor-name', name.id), '@type': 'PropertyValue', ...sourceProperties(name) };
    if (hasValue(name.name)) nameRecord.name = name.name;
    if (hasValue(name.name_type)) nameRecord.propertyID = name.name_type;
    const nameEntity = add(nameRecord);
    crate.addValues(person, 'call:nameVariant', ref(nameEntity));
    const mapped = mappedProperty(name.name_type);
    if (mapped && hasValue(name.name)) crate.addValues(person, mapped, name.name);
  }
  for (const name of data.languageNames) {
    const language = requireEntity(languages, name.language_id, 'language name');
    const nameRecord = { '@id': entityId('language-name', name.id), '@type': 'PropertyValue', ...sourceProperties(name) };
    if (hasValue(name.name)) nameRecord.name = name.name;
    const nameEntity = add(nameRecord);
    crate.addValues(language, 'call:nameVariant', ref(nameEntity));
  }
  for (const role of data.contributorRoles) {
    const item = requireEntity(items, role.item_record_id, 'contributor role item');
    const person = requireEntity(people, role.contributor_id, 'contributor role person');
    if (role.role_type == null) throw new Error(`Contributor role ${role.id}: missing role type`);
    const relation = add({ '@id': entityId('contributor-role', role.id), '@type': 'Role', roleName: role.role_type, contributor: ref(person), ...sourceProperties(role) });
    crate.addValues(item, mappedProperty(role.role_type) || 'contributor', ref(relation));
  }
  for (const association of data.itemPlaces) {
    const item = requireEntity(items, association.item_record_id, 'place association item');
    const place = requireEntity(places, association.place_id, 'place association place');
    const relation = add({ '@id': entityId('item-place', association.id), '@type': 'PropertyValue', valueReference: ref(place), ...sourceProperties(association) });
    crate.addValues(item, 'call:placeAssociation', ref(relation));
  }
  for (const [collection, property] of [['keywords', 'keywords'], ['subjects', 'about'], ['sponsors', 'sponsor']]) {
    for (const association of data[collection]) {
      const item = requireEntity(items, association.item_record_id, `${collection} item`);
      if (association.name == null || (typeof association.name === 'string' && !association.name.trim())) {
        logger.warn(`Skipping missing ${collection.slice(0, -1)} for item ${association.item_record_id}`);
        continue;
      }
      crate.addValues(item, property, association.name);
    }
  }
  return items;
}

export async function loadData(sql) {
  return {
    items: await sql`SELECT r.*, activities.name AS activity, record_formats.name AS record_format, types.name AS type FROM item_records r LEFT JOIN activities ON activities.id = r.activity_id LEFT JOIN record_formats ON record_formats.id = r.record_format_id LEFT JOIN types ON types.id = r.type_id ORDER BY r.id`,
    contributors: await sql`SELECT * FROM contributors ORDER BY id`,
    contributorNames: await sql`SELECT * FROM contributor_names ORDER BY id`,
    languages: await sql`SELECT * FROM languages ORDER BY id`,
    languageNames: await sql`SELECT * FROM language_names ORDER BY id`,
    places: await sql`SELECT * FROM places ORDER BY id`,
    publishers: await sql`SELECT * FROM publishers ORDER BY id`,
    licences: await sql`SELECT * FROM licences ORDER BY id`,
    contributorRoles: await sql`SELECT ircr.*, roles.role_type FROM item_record_contributor_roles ircr LEFT JOIN roles ON roles.id = ircr.role_id ORDER BY ircr.id`,
    itemPlaces: await sql`SELECT * FROM item_record_places ORDER BY id`,
    keywords: await sql`SELECT irk.item_record_id, keywords.name FROM item_record_keywords irk LEFT JOIN keywords ON keywords.id = irk.keyword_id`,
    subjects: await sql`SELECT irs.item_record_id, subjects.name FROM item_record_subjects irs LEFT JOIN subjects ON subjects.id = irs.subject_id`,
    sponsors: await sql`SELECT irsp.item_record_id, sponsors.name FROM item_record_sponsors irsp LEFT JOIN sponsors ON sponsors.id = irsp.sponsor_id`
  };
}

async function indexFiles(directory) {
  const index = new Map();
  async function visit(relativeDirectory) {
    const entries = await readdir(path.join(directory, relativeDirectory), { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) await visit(relativePath);
      else if (entry.isFile()) {
        const matches = index.get(entry.name) || [];
        matches.push(relativePath);
        index.set(entry.name, matches);
      }
    }
  }
  await visit('');
  return index;
}

export async function attachFiles(corpus, items, records, directories, logger = console) {
  const types = [
    { column: 'item_record_file_file_name', directory: directories.itemFiles, prefix: 'item_record_files', properties: ['hasPart'] },
    { column: 'cover_image_file_name', directory: directories.coverImages, prefix: 'cover_images', properties: ['hasPart', 'image'], originalsOnly: true }
  ];
  const planned = [];
  let missingCount = 0;
  for (const type of types) {
    const referenced = records.filter(record => record[type.column] != null && record[type.column] !== '');
    if (!referenced.length) continue;
    let index;
    try {
      index = await indexFiles(type.directory);
    } catch (error) {
      throw new Error(`Cannot scan ${type.column} directory ${type.directory}: ${error.message}`);
    }
    for (const record of referenced) {
      const name = record[type.column];
      if (typeof name !== 'string' || path.basename(name) !== name || name === '.' || name === '..') {
        throw new Error(`Item ${record.id}: invalid ${type.column} filename: ${name}`);
      }
      const matches = (index.get(name) || []).filter(relativePath =>
        !type.originalsOnly || path.dirname(relativePath).split(path.sep).includes('original'));
      if (matches.length === 0) {
        logger.error(`Item ${record.id}: ${type.column} filename ${JSON.stringify(name)} has 0 matches in ${type.directory}`);
        missingCount++;
        continue;
      }
      const item = items.get(String(record.id));
      if (!item) throw new Error(`Missing crate item for item record ${record.id}`);
      for (const relativePath of matches.sort()) {
        const target = [type.prefix, ...relativePath.split(path.sep)].join('/');
        planned.push({ item, properties: type.properties, source: path.join(type.directory, relativePath), target, name });
      }
    }
  }
  const imported = new Set();
  for (const file of planned) {
    if (!imported.has(file.target)) {
      if (corpus.crate.hasEntity(file.target)) throw new Error(`File ID collides with existing crate entity: ${file.target}`);
      corpus.crate.addEntity({ '@id': file.target, '@type': 'File', name: file.name });
      corpus.importFile(file.source, file.target);
      imported.add(file.target);
    }
    for (const property of file.properties) {
      corpus.crate.addValues(file.item, property, { '@id': file.target });
    }
  }
  return missingCount;
}

async function main(logger) {
  if (!process.env.CALL_PG_URL) throw new Error('CALL_PG_URL is required');
  Collector.mainPackage = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
  const collector = new Collector();
  const template = configureCollector(collector);
  logger.info(`OCFL repository: ${collector.repoPath}`);
  await collector.connect();
  if (collector.sf) await collector.runSiegfried();
  const sql = process.env.NODE_ENV === 'production' ? postgres(process.env.CALL_PG_URL, { ssl: { rejectUnauthorized: false } }) : postgres(process.env.CALL_PG_URL);
  try {
    const data = await sql.begin(async transaction => {
      await transaction`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
      return loadData(transaction);
    });
    if (process.env.CALL_SKIP_ROR_LOOKUP !== 'true') {
      data.publishers = await enrichPublisherRorIds(data.publishers, { logger });
    }
    const corpus = collector.newObject(template);
    corpus.mintArcpId();
    const items = populateCrate(corpus.crate, collector.namespace, data, logger);
    const missingFiles = await attachFiles(corpus, items, data.items, fileDirectories(), logger);
    if (missingFiles) logger.warn(`${missingFiles} file reference(s) missing; the export will be incomplete.`);
    await corpus.addToRepo();
    const stored = collector.repo.object(corpus.id);
    await stored.load();
    const metadata = JSON.parse(await stored.getFile({ logicalPath: 'ro-crate-metadata.json' }).asString());
    const expected = corpus.crate.toJSON();
    if (JSON.stringify(metadata) !== JSON.stringify(expected)) throw new Error('Published OCFL metadata does not match the generated crate');
    const outputDir = outputDirectory();
    mkdirSync(outputDir, { recursive: true });
    const metadataPath = path.join(outputDir, 'ro-crate-metadata.json');
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    logger.info(`Wrote ${metadataPath}`);
    const workbookCrate = new ROCrate(metadata, { array: true, link: true });
    const workbook = new Workbook({ crate: workbookCrate });
    await workbook.crateToWorkbook();
    const workbookPath = path.join(outputDir, 'ro-crate-metadata.xlsx');
    await workbook.workbook.xlsx.writeFile(workbookPath);
    logger.info(`Wrote ${workbookPath}`);
    return missingFiles;
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let logger;
  try {
    logger = createRunLogger();
    logger.info(`Log file: ${logger.path}`);
    logger.info('Starting export');
    const missingFiles = await main(logger);
    if (missingFiles) logger.warn(`Export completed with ${missingFiles} missing file reference(s); output is incomplete.`);
    else logger.info('Export completed');
  } catch (error) {
    if (logger) logger.error(`Export failed: ${error.message}`);
    else console.error(`Cannot start export logging: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (logger) logger.close();
  }
}