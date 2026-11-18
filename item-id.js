export function itemId(item, language) {
  if (language?.full_language_name == null || String(language.full_language_name).trim() === '') {
    throw new Error(`Item ${item.id}: missing full_language_name`);
  }
  const area = language.AIATSIS_area ?? language.aiatsis_area ?? '';
  const district = language.AIATSIS_district ?? language.aiatsis_district ?? '';
  const languagePrefix = `${language.full_language_name}_${area}${district}`;
  const fields = ['language_series_number', 'year_of_entry', 'accession_number'];
  return [encodeURIComponent(languagePrefix), ...fields.map(field => {
    const value = item[field];
    if (value === null || value === undefined || String(value).trim() === '') {
      throw new Error(`Item ${item.id}: missing ${field}`);
    }
    const component = String(value);
    if (component === '.' || component === '..') {
      throw new Error(`Item ${item.id}: invalid ${field}`);
    }
    return encodeURIComponent(component);
  })].join('/');
}