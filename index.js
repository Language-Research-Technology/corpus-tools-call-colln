import postgres from 'postgres';
import oni from 'oni-ocfl';
import vocabs from 'language-data-commons-vocabs';
import excel from 'ro-crate-excel';
import rocrate from 'ro-crate';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
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

function sourceProperties(record) {
  return Object.fromEntries(Object.entries(record)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => [`call:${key}`, value instanceof Date ? value.toISOString() :
      typeof value === 'object' ? JSON.stringify(value) : value]));
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
    if (record[nameField] != null) entity.name = record[nameField];
    return [String(record.id), add(entity)];
  }));

  const people = entities(data.contributors, 'person', 'Person', 'full_name');
  const places = entities(data.places, 'place', 'Place', 'name');
  const licences = new Map(data.licences.map(record => {
    const id = typeof record.link === 'string' && /^https?:\/\//i.test(record.link) ? record.link : entityId('licence', record.id);
    const entity = { '@id': id, '@type': 'ldac:DataReuseLicense', ...sourceProperties(record) };
    if (record.name != null) entity.name = record.name;
    if (record.license_and_permission_details != null) entity.description = record.license_and_permission_details;
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
    if (language.full_language_name != null) entity.name = language.full_language_name;
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
    if (record.title != null) entity.name = record.title;
    if (record.language_series_number != null) entity.inLanguage = ref(requireEntity(languageBySeries, record.language_series_number, 'item language'));
    if (record.licence_id != null) entity.license = ref(requireEntity(licences, record.licence_id, 'item licence'));
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
    const nameEntity = add({ '@id': entityId('contributor-name', name.id), '@type': 'PropertyValue', ...sourceProperties(name), name: name.name, propertyID: name.name_type });
    crate.addValues(person, 'call:nameVariant', ref(nameEntity));
  }
  for (const name of data.languageNames) {
    const language = requireEntity(languages, name.language_id, 'language name');
    const nameEntity = add({ '@id': entityId('language-name', name.id), '@type': 'PropertyValue', ...sourceProperties(name), name: name.name });
    crate.addValues(language, 'call:nameVariant', ref(nameEntity));
  }
  for (const role of data.contributorRoles) {
    const item = requireEntity(items, role.item_record_id, 'contributor role item');
    const person = requireEntity(people, role.contributor_id, 'contributor role person');
    if (role.role_type == null) throw new Error(`Contributor role ${role.id}: missing role type`);
    const relation = add({ '@id': entityId('contributor-role', role.id), '@type': 'Role', roleName: role.role_type, contributor: ref(person), ...sourceProperties(role) });
    crate.addValues(item, 'contributor', ref(relation));
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
    items: await sql`SELECT r.*, activities.name AS activity, publishers.name AS publisher, record_formats.name AS record_format, types.name AS type FROM item_records r LEFT JOIN activities ON activities.id = r.activity_id LEFT JOIN publishers ON publishers.id = r.publisher_id LEFT JOIN record_formats ON record_formats.id = r.record_format_id LEFT JOIN types ON types.id = r.type_id ORDER BY r.id`,
    contributors: await sql`SELECT * FROM contributors ORDER BY id`,
    contributorNames: await sql`SELECT * FROM contributor_names ORDER BY id`,
    languages: await sql`SELECT * FROM languages ORDER BY id`,
    languageNames: await sql`SELECT * FROM language_names ORDER BY id`,
    places: await sql`SELECT * FROM places ORDER BY id`,
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
    const workbookCrate = new ROCrate(metadata, { array: true, link: true });
    const workbook = new Workbook({ crate: workbookCrate });
    await workbook.crateToWorkbook();
    await workbook.workbook.xlsx.writeFile('ro-crate-metadata.xlsx');
    logger.info('Wrote ro-crate-metadata.xlsx');
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