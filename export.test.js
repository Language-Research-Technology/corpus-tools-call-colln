import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import oni from 'oni-ocfl';
import rocrate from 'ro-crate';
import { attachFiles, configureCollector, createRunLogger, fileDirectories, outputDirectory, populateCrate, repositoryPath } from './index.js';

const { ROCrate } = rocrate;

test('uses file directories under files and respects overrides', () => {
  assert.deepEqual(fileDirectories({}), {
    itemFiles: path.join('files', 'item_record_files'),
    coverImages: path.join('files', 'cover_images')
  });
  assert.deepEqual(fileDirectories({ CALL_ITEM_RECORD_FILES_DIR: '/custom/items', CALL_COVER_IMAGE_DIR: '/custom/covers' }), {
    itemFiles: '/custom/items',
    coverImages: '/custom/covers'
  });
});

test('defaults the output directory to output and respects an override', () => {
  assert.equal(outputDirectory({}), 'output');
  assert.equal(outputDirectory({ CALL_OUTPUT_DIR: '/custom/output' }), '/custom/output');
});

test('selects and initializes an OCFL repository root', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'call-ocfl-'));
  try {
    oni.Collector.mainPackage = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
    const root = path.join(directory, 'repo');
    assert.equal(repositoryPath(root, '/ignored'), root);
    assert.equal(repositoryPath(undefined, root), root);
    assert.equal(repositoryPath(), path.join(path.dirname(new URL(import.meta.url).pathname), 'ocfl-repo'));
    const collector = new oni.Collector({ repoPath: root, tempPath: directory });
    const template = configureCollector(collector);
    assert.equal(collector.namespace, 'callcolln');
    assert.equal(template, null);
    const corpus = collector.newObject(template);
    corpus.mintArcpId();
    assert.equal(corpus.id, 'arcp://name,callcolln');
    await collector.connect();
    await new oni.Collector({ repoPath: root }).connect();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function fixture() {
  return {
    items: [{ id: 1, title: 'Title', language_series_number: '001', year_of_entry: '2020', accession_number: '02', licence_id: 3, publisher_id: 7 }],
    contributors: [{ id: 2, full_name: 'A Person' }],
    contributorNames: [{ id: 10, contributor_id: 2, name: 'Another name', name_type: 'alias' }],
    languages: [{ id: 4, language_series_number: '001', full_language_name: 'Language', AIATSIS_area: 'A', AIATSIS_district: '1' }],
    languageNames: [{ id: 11, language_id: 4, name: 'Alternate' }],
    places: [{ id: 5, name: 'Place' }, { id: 6, name: 'Other place' }],
    publishers: [{ id: 7, name: 'Publisher' }],
    licences: [{ id: 3, name: 'License', link: 'https://example.org/license' }],
    contributorRoles: [{ id: 12, item_record_id: 1, contributor_id: 2, role_type: 'author' }, { id: 13, item_record_id: 1, contributor_id: 2, role_type: 'speaker' }],
    itemPlaces: [{ id: 14, item_record_id: 1, place_id: 5, place_type: 'Place of Origin' }, { id: 15, item_record_id: 1, place_id: 6, place_type: 'Place of Origin' }],
    keywords: [{ item_record_id: 1, name: 'one, two' }],
    subjects: [], sponsors: []
  };
}

test('preserves item links, name variants, roles, and places in the crate graph', () => {
  const crate = new ROCrate({}, { alwaysAsArray: true, resolveLinks: true });
  populateCrate(crate, 'test', fixture());
  const graph = crate.toJSON()['@graph'];
  const item = graph.find(entity => entity['@id'] === 'arcp://name,test/Language_A1/001/2020/02');
  assert.ok(item);
  assert.deepEqual([].concat(graph.find(entity => [].concat(entity['@type']).includes('RepositoryCollection'))['pcdm:hasMember']), [{ '@id': item['@id'] }]);
  assert.equal(item.contributor.length, 2);
  assert.equal(item['call:placeAssociation'].length, 2);
  assert.deepEqual([].concat(item.keywords), ['one, two']);
  assert.equal(graph.filter(entity => entity['@type']?.includes('Role')).length, 2);
  assert.ok(graph.some(entity => entity['@id'] === 'arcp://name,test/person/2' && entity['call:nameVariant']));
  assert.ok(graph.some(entity => entity['@id'] === 'arcp://name,test/language/001' && entity['call:nameVariant']));
  assert.deepEqual(item.inLanguage, { '@id': 'arcp://name,test/language/001' });
  assert.deepEqual(item.publisher, { '@id': 'arcp://name,test/publisher/7' });
  const publisher = graph.find(entity => entity['@id'] === 'arcp://name,test/publisher/7');
  assert.ok([].concat(publisher['@type']).includes('Organization'));
  assert.equal(publisher.name, 'Publisher');
});

test('warns and omits the publisher link when an item publisher_id does not resolve', () => {
  const data = fixture();
  data.items[0].publisher_id = 999;
  const crate = new ROCrate({}, { alwaysAsArray: true, resolveLinks: true });
  const warnings = [];
  const warn = console.warn;
  try {
    console.warn = message => warnings.push(message);
    populateCrate(crate, 'test', data);
  } finally {
    console.warn = warn;
  }
  const item = crate.toJSON()['@graph'].find(entity => entity['@id'] === 'arcp://name,test/Language_A1/001/2020/02');
  assert.equal('publisher' in item, false);
  assert.ok(warnings.some(message => message.includes('Item 1: publisher 999 not found')));
});

test('uses the configured namespace and preserves escaped item ID components', () => {
  const data = fixture();
  data.items[0].accession_number = '02/3';
  const crate = new ROCrate({}, { alwaysAsArray: true, resolveLinks: true });
  populateCrate(crate, 'callcolln', data);
  const graph = crate.toJSON()['@graph'];
  const id = 'arcp://name,callcolln/Language_A1/001/2020/02%2F3';
  assert.ok(graph.some(entity => entity['@id'] === id));
  const root = graph.find(entity => [].concat(entity['@type']).includes('RepositoryCollection'));
  assert.deepEqual([].concat(root['pcdm:hasMember']), [{ '@id': id }]);
});

test('rejects duplicate item identifiers and dangling relations', () => {
  const data = fixture();
  data.items.push({ ...data.items[0], id: 99 });
  assert.throws(() => populateCrate(new ROCrate({}, { alwaysAsArray: true, resolveLinks: true }), 'test', data), /Item 99: duplicate/);
  data.items.pop();
  data.itemPlaces[0].place_id = 999;
  assert.throws(() => populateCrate(new ROCrate({}, { alwaysAsArray: true, resolveLinks: true }), 'test', data), /Dangling place association place: 999/);
});

test('reports missing optional values and preserves valid metadata', () => {
  const data = fixture();
  data.keywords.push({ item_record_id: 1, name: null });
  data.subjects.push({ item_record_id: 1 }, { item_record_id: 1, name: 'Subject' });
  data.sponsors.push({ item_record_id: 1, name: '  ' }, { item_record_id: 1, name: 'Sponsor' });
  const crate = new ROCrate({}, { alwaysAsArray: true, resolveLinks: true });
  const warnings = [];
  const warn = console.warn;
  try {
    console.warn = message => warnings.push(message);
    populateCrate(crate, 'test', data);
  } finally {
    console.warn = warn;
  }
  const item = crate.toJSON()['@graph'].find(entity => entity['@id'] === 'arcp://name,test/Language_A1/001/2020/02');
  assert.deepEqual([].concat(item.keywords), ['one, two']);
  assert.deepEqual([].concat(item.about), ['Subject']);
  assert.deepEqual([].concat(item.sponsor), ['Sponsor']);
  assert.deepEqual(warnings, [
    'Skipping missing keyword for item 1',
    'Skipping missing subject for item 1',
    'Skipping missing sponsor for item 1'
  ]);
});

test('maps source columns, role types, and name types through schema-mapping.json', () => {
  const data = fixture();
  data.languages[0].ISO_code = 'xx';
  data.contributorRoles[0].role_type = 'Author';
  data.contributorNames[0].name_type = 'First';
  const crate = new ROCrate({}, { alwaysAsArray: true, resolveLinks: true });
  populateCrate(crate, 'test', data);
  const graph = crate.toJSON()['@graph'];
  const item = graph.find(entity => entity['@id'] === 'arcp://name,test/Language_A1/001/2020/02');
  // AIATSIS_area and AIATSIS_district both map to call:austlangCode and are concatenated directly.
  const language = graph.find(entity => entity['@id'] === 'arcp://name,test/language/001');
  assert.equal(language['call:austlangCode'], 'A1');
  assert.equal(language['call:isoCode'], 'xx');
  // A role_type matched in the map ('Author' -> 'author') links under that property, not 'contributor'.
  assert.deepEqual([].concat(item.author).length, 1);
  assert.equal([].concat(item.contributor || []).length, 1);
  // A name_type matched in the map ('First' -> 'givenName') sets that property directly on the person,
  // in addition to the existing call:nameVariant provenance record.
  const person = graph.find(entity => entity['@id'] === 'arcp://name,test/person/2');
  assert.equal(person.givenName, 'Another name');
  assert.ok(person['call:nameVariant']);
});

test('omits null and empty-string source values instead of writing them to crate entities', () => {
  const data = fixture();
  data.items[0].admin_notes = '';
  data.items[0].notes = null;
  data.languages.push({ id: 7, language_series_number: '002', full_language_name: 'Other', AIATSIS_area: '', AIATSIS_district: null });
  data.contributorNames[0].name = '';
  data.contributorNames[0].name_type = 'First';
  data.languageNames[0].name = null;
  const crate = new ROCrate({}, { alwaysAsArray: true, resolveLinks: true });
  populateCrate(crate, 'test', data);
  const graph = crate.toJSON()['@graph'];
  const item = graph.find(entity => entity['@id'] === 'arcp://name,test/Language_A1/001/2020/02');
  assert.equal('call:admin_notes' in item, false);
  assert.equal('call:notes' in item, false);
  const otherLanguage = graph.find(entity => entity['@id'] === 'arcp://name,test/language/002');
  assert.equal('call:austlangCode' in otherLanguage, false);
  const contributorName = graph.find(entity => entity['@id'] === 'arcp://name,test/contributor-name/10');
  assert.equal('name' in contributorName, false);
  // An empty name_type-mapped value is not written to the person either.
  const person = graph.find(entity => entity['@id'] === 'arcp://name,test/person/2');
  assert.equal('givenName' in person, false);
  const languageName = graph.find(entity => entity['@id'] === 'arcp://name,test/language-name/11');
  assert.equal('name' in languageName, false);
});

test('links series zero to English when no language row exists', () => {
  const data = fixture();
  data.items[0].language_series_number = 0;
  data.items.push({ ...data.items[0], id: 2, language_series_number: '0', accession_number: '03' });
  const crate = new ROCrate({}, { alwaysAsArray: true, resolveLinks: true });
  populateCrate(crate, 'test', data);
  const graph = crate.toJSON()['@graph'];
  const english = graph.find(entity => entity['@id'] === 'arcp://name,test/language/0');
  assert.equal(english.name, 'English');
  assert.ok([].concat(english['@type']).includes('Language'));
  for (const id of ['arcp://name,test/English_/0/2020/02', 'arcp://name,test/English_/0/2020/03']) {
    assert.deepEqual(graph.find(entity => entity['@id'] === id).inLanguage, { '@id': english['@id'] });
  }
});

test('uses the existing series zero language and still rejects other missing languages', () => {
  const data = fixture();
  data.items[0].language_series_number = '0';
  data.languages.push({ id: 5, language_series_number: 0, full_language_name: 'English' });
  const crate = new ROCrate({}, { alwaysAsArray: true, resolveLinks: true });
  populateCrate(crate, 'test', data);
  const graph = crate.toJSON()['@graph'];
  assert.deepEqual(graph.find(entity => entity['@id'] === 'arcp://name,test/English_/0/2020/02').inLanguage, { '@id': 'arcp://name,test/language/0' });
  assert.equal(graph.filter(entity => entity['@id'] === 'arcp://name,test/language/0').length, 1);
  data.items[0].language_series_number = '999';
  assert.throws(() => populateCrate(new ROCrate({}, { alwaysAsArray: true, resolveLinks: true }), 'test', data), /Dangling item language: 999/);
});

test('requires a unique language series number for each language', () => {
  const data = fixture();
  data.languages.push({ id: 8, language_series_number: '001', full_language_name: 'Duplicate' });
  assert.throws(() => populateCrate(new ROCrate({}, { alwaysAsArray: true, resolveLinks: true }), 'test', data), /Duplicate language series number: 001/);
  data.languages[1].language_series_number = null;
  assert.throws(() => populateCrate(new ROCrate({}, { alwaysAsArray: true, resolveLinks: true }), 'test', data), /Language 8: missing language_series_number/);
});

test('links and imports nested files and shared covers once', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'call-files-'));
  try {
    const itemFiles = path.join(directory, 'item_record_files');
    const coverImages = path.join(directory, 'cover_images');
    await mkdir(path.join(itemFiles, 'one', 'two'), { recursive: true });
    await mkdir(path.join(coverImages, 'covers', 'original'), { recursive: true });
    await mkdir(path.join(coverImages, 'covers', 'thumbnail'), { recursive: true });
    await writeFile(path.join(itemFiles, 'one', 'two', 'text.txt'), 'text');
    await writeFile(path.join(coverImages, 'covers', 'original', 'cover.jpg'), 'image');
    await writeFile(path.join(coverImages, 'covers', 'thumbnail', 'cover.jpg'), 'thumbnail');
    const data = fixture();
    data.items[0].item_record_file_file_name = 'text.txt';
    data.items[0].cover_image_file_name = 'cover.jpg';
    data.items.push({ ...data.items[0], id: 2, accession_number: '03', item_record_file_file_name: null });
    const crate = new ROCrate({}, { alwaysAsArray: true, resolveLinks: true });
    const items = populateCrate(crate, 'test', data);
    const imports = [];
    await attachFiles({ crate, importFile: (source, target) => imports.push([source, target]) }, items, data.items, { itemFiles, coverImages });
    assert.deepEqual(imports, [
      [path.join(itemFiles, 'one', 'two', 'text.txt'), 'item_record_files/one/two/text.txt'],
      [path.join(coverImages, 'covers', 'original', 'cover.jpg'), 'cover_images/covers/original/cover.jpg']
    ]);
    const graph = crate.toJSON()['@graph'];
    const first = graph.find(entity => entity['@id'] === 'arcp://name,test/Language_A1/001/2020/02');
    const second = graph.find(entity => entity['@id'] === 'arcp://name,test/Language_A1/001/2020/03');
    assert.deepEqual([].concat(first.hasPart), [{ '@id': 'item_record_files/one/two/text.txt' }, { '@id': 'cover_images/covers/original/cover.jpg' }]);
    assert.deepEqual([].concat(first.image), [{ '@id': 'cover_images/covers/original/cover.jpg' }]);
    assert.deepEqual([].concat(second.hasPart), [{ '@id': 'cover_images/covers/original/cover.jpg' }]);
    assert.deepEqual([].concat(second.image), [{ '@id': 'cover_images/covers/original/cover.jpg' }]);
    assert.equal(graph.filter(entity => entity['@id'] === 'cover_images/covers/original/cover.jpg').length, 1);
    assert.ok(!graph.some(entity => entity['@id'] === 'cover_images/covers/thumbnail/cover.jpg'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('links all matching files to every item referencing their names', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'call-files-'));
  try {
    await mkdir(path.join(directory, 'a'));
    await mkdir(path.join(directory, 'b'));
    await writeFile(path.join(directory, 'a', 'same.txt'), 'one');
    await writeFile(path.join(directory, 'b', 'same.txt'), 'two');
    await mkdir(path.join(directory, 'a', 'original'));
    await mkdir(path.join(directory, 'b', 'original'));
    await writeFile(path.join(directory, 'a', 'original', 'cover.jpg'), 'cover one');
    await writeFile(path.join(directory, 'b', 'original', 'cover.jpg'), 'cover two');
    const crate = new ROCrate({}, { alwaysAsArray: true, resolveLinks: true });
    const imports = [];
    const corpus = { crate, importFile: (...args) => imports.push(args) };
    const data = fixture();
    data.items[0].item_record_file_file_name = 'same.txt';
    data.items[0].cover_image_file_name = 'cover.jpg';
    data.items.push({ ...data.items[0], id: 2, accession_number: '03' });
    const items = populateCrate(crate, 'test', data);
    const directories = { itemFiles: directory, coverImages: directory };
    await attachFiles(corpus, items, data.items, directories);
    assert.deepEqual(imports.map(([, target]) => target), [
      'item_record_files/a/same.txt', 'item_record_files/b/same.txt',
      'cover_images/a/original/cover.jpg', 'cover_images/b/original/cover.jpg'
    ]);
    const graph = crate.toJSON()['@graph'];
    for (const id of ['arcp://name,test/Language_A1/001/2020/02', 'arcp://name,test/Language_A1/001/2020/03']) {
      const item = graph.find(entity => entity['@id'] === id);
      assert.deepEqual(item.hasPart, [{ '@id': 'item_record_files/a/same.txt' }, { '@id': 'item_record_files/b/same.txt' }, { '@id': 'cover_images/a/original/cover.jpg' }, { '@id': 'cover_images/b/original/cover.jpg' }]);
      assert.deepEqual(item.image, [{ '@id': 'cover_images/a/original/cover.jpg' }, { '@id': 'cover_images/b/original/cover.jpg' }]);
    }
    assert.equal(graph.filter(entity => entity.name === 'same.txt').length, 2);
    assert.equal(graph.filter(entity => entity.name === 'cover.jpg').length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('reports missing files and imports other matches', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'call-files-'));
  try {
    const crate = new ROCrate({}, { alwaysAsArray: true, resolveLinks: true });
    const imports = [];
    const corpus = { crate, importFile: (...args) => imports.push(args) };
    const items = populateCrate(crate, 'test', fixture());
    const directories = { itemFiles: directory, coverImages: directory };
    await mkdir(path.join(directory, 'original'));
    await mkdir(path.join(directory, 'thumbnail'));
    await writeFile(path.join(directory, 'original', 'cover.jpg'), 'cover');
    await writeFile(path.join(directory, 'thumbnail', 'thumbnail-only.jpg'), 'thumbnail');
    const errors = [];
    const missing = await attachFiles(corpus, items, [{ id: 1, item_record_file_file_name: 'missing.txt', cover_image_file_name: 'cover.jpg' }, { id: 1, item_record_file_file_name: 'missing-again.txt', cover_image_file_name: 'thumbnail-only.jpg' }], directories, { error: message => errors.push(message) });
    assert.equal(missing, 3);
    assert.equal(errors.length, 3);
    assert.match(errors[0], /Item 1: item_record_file_file_name filename "missing.txt" has 0 matches/);
    assert.match(errors[2], /cover_image_file_name filename "thumbnail-only.jpg" has 0 matches/);
    assert.deepEqual(imports, [[path.join(directory, 'original', 'cover.jpg'), 'cover_images/original/cover.jpg']]);
    const item = crate.toJSON()['@graph'].find(entity => entity['@id'] === 'arcp://name,test/Language_A1/001/2020/02');
    assert.deepEqual([].concat(item.hasPart), [{ '@id': 'cover_images/original/cover.jpg' }]);
    assert.deepEqual([].concat(item.image), [{ '@id': 'cover_images/original/cover.jpg' }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('writes run messages and missing file errors to a persistent log', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'call-log-'));
  try {
    const logger = createRunLogger(path.join(directory, 'logs'));
    const crate = new ROCrate({}, { alwaysAsArray: true, resolveLinks: true });
    const items = populateCrate(crate, 'test', fixture(), logger);
    await attachFiles({ crate, importFile: () => assert.fail('Unexpected import') }, items,
      [{ id: 1, item_record_file_file_name: 'missing.txt' }],
      { itemFiles: directory, coverImages: directory }, logger);
    logger.warn('Export is incomplete');
    logger.close();
    const output = await readFile(logger.path, 'utf8');
    assert.match(output, /\d{4}-\d{2}-\d{2}T[^ ]+ INFO Created item 1\/1/);
    assert.match(output, / ERROR Item 1: item_record_file_file_name filename "missing.txt" has 0 matches/);
    assert.match(output, / WARN Export is incomplete/);
    assert.equal(crate.toJSON()['@graph'].find(entity => entity['@id'] === 'arcp://name,test/Language_A1/001/2020/02').hasPart, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});