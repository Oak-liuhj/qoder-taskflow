// Route explicit file metadata, never prose or shell commands.
export function documentFormat(path) {
  const ext = typeof path === 'string' ? path.split(/[\\/]/).at(-1).split('.').at(-1).toLowerCase() : '';
  return ['md', 'markdown'].includes(ext) ? 'markdown' : ['xls', 'xlsx', 'csv', 'tsv'].includes(ext) ? 'excel' : ['doc', 'docx'].includes(ext) ? 'word' : ['ppt', 'pptx'].includes(ext) ? 'powerpoint' : ext === 'pdf' ? 'pdf' : null;
}
export function documentPath(value) {
  return typeof value === 'string' && value.length <= 4096 && !/[\u0000-\u001f]/.test(value) && (!/^[a-z][a-z\d+.-]*:/i.test(value) || /^[a-z]:[\\/]/i.test(value)) && documentFormat(value) ? value : null;
}
export function normalizeDocuments(input) {
  return [...new Set([input.filePath, ...(Array.isArray(input.files) ? input.files : [])].filter(documentPath))].slice(0, 20).map(path => ({ path, format: documentFormat(path) }));
}
