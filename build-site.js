import { readFile, writeFile, mkdir, symlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import rocrate from 'ro-crate';
import { roCrateToJSON, renderMultiPage, renderTemplate } from 'ro-crate-static-site';
import { outputDirectory, fileDirectories } from './index.js';

const { ROCrate } = rocrate;
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// The crate's item_record_files/cover_images File entities use paths relative to the
// files/ source directories; symlink them into the output directory so the generated
// site resolves those files without copying them.
async function linkFileDirectory(target, source) {
  const resolvedSource = path.resolve(source);
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) return;
    throw new Error(`${target} already exists and is not a symlink; remove it to rebuild the site`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await symlink(resolvedSource, target);
}

export async function buildSite({ outputDir = outputDirectory() } = {}) {
  const config = JSON.parse(await readFile(path.join(projectRoot, 'site-config.json'), 'utf8'));
  const { itemFiles, coverImages } = fileDirectories();
  await linkFileDirectory(path.join(outputDir, 'item_record_files'), itemFiles);
  await linkFileDirectory(path.join(outputDir, 'cover_images'), coverImages);

  const metadata = JSON.parse(await readFile(path.join(outputDir, 'ro-crate-metadata.json'), 'utf8'));
  const crate = new ROCrate(metadata, { array: true, link: true });
  await crate.resolveContext();
  const crateLite = await roCrateToJSON(crate, config, []);

  const pageTemplates = {};
  async function loadTemplate(relativePath) {
    if (!(relativePath in pageTemplates)) {
      pageTemplates[relativePath] = await readFile(path.join(projectRoot, relativePath), 'utf8');
    }
  }
  await loadTemplate(config.root.template);
  for (const pageDetails of Object.values(crateLite.pages)) {
    await loadTemplate(pageDetails.template);
  }

  const { rootHtml, pages } = await renderMultiPage(crateLite, config, '', { pageTemplates });
  for (const page of pages) {
    const outputPath = path.join(outputDir, page.path);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, page.html, 'utf8');
  }
  await writeFile(path.join(outputDir, 'ro-crate-preview.html'), rootHtml, 'utf8');

  const listsTemplate = await readFile(path.join(projectRoot, 'templates', 'lists.html'), 'utf8');
  const listsHtml = await renderTemplate(crateLite, listsTemplate, config, '');
  await writeFile(path.join(outputDir, 'lists.html'), listsHtml, 'utf8');

  return { outputDir, entityPageCount: pages.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await buildSite();
  console.log(`Wrote ${result.entityPageCount} entity pages, ro-crate-preview.html, and lists.html to ${result.outputDir}`);
}
