async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/json')) return res.json();
  return res;
}

export const api = {
  listDocuments: () => request('/api/documents'),
  getDocument: (id) => request(`/api/documents/${id}`),
  watchDocumentUrl: (id) => `/api/documents/${id}/events`,
  createDocument: (body) => request('/api/documents', { method: 'POST', body: JSON.stringify(body) }),
  updateDocument: (id, body) =>
    request(`/api/documents/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteDocument: (id) => request(`/api/documents/${id}`, { method: 'DELETE' }),
  duplicateDocument: (id) => request(`/api/documents/${id}/duplicate`, { method: 'POST' }),
  starDocument: (id) => request(`/api/documents/${id}/star`, { method: 'PATCH' }),

  listFolders: () => request('/api/folders'),
  createFolder: (body) => request('/api/folders', { method: 'POST', body: JSON.stringify(body) }),
  updateFolder: (id, body) =>
    request(`/api/folders/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteFolder: (id) => request(`/api/folders/${id}`, { method: 'DELETE' }),

  listVersions: (docId) => request(`/api/versions/${docId}`),
  getVersion: (docId, versionId) => request(`/api/versions/${docId}/${versionId}`),
  renameVersion: (docId, versionId, name) =>
    request(`/api/versions/${docId}/${versionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  restoreVersion: (docId, versionId) =>
    request(`/api/versions/${docId}/${versionId}/restore`, { method: 'POST' }),
  nameVersion: (docId, name) =>
    request(`/api/versions/${docId}/name`, { method: 'POST', body: JSON.stringify({ name }) }),

  importFile: (file, folderId) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('folderId', folderId || 'root');
    return request('/api/import', { method: 'POST', body: fd });
  },

  exportUrl: (id, format) => `/api/export/${id}/${format}`,

  /** Fetch export as a file download; throws on API/JSON errors instead of saving them. */
  async downloadExport(id, format) {
    const res = await fetch(`/api/export/${id}/${format}`);
    const type = res.headers.get('content-type') || '';
    if (!res.ok) {
      let message = res.statusText || 'Export failed';
      try {
        if (type.includes('application/json')) {
          const data = await res.json();
          message = data.error || message;
        } else {
          message = (await res.text()) || message;
        }
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
    if (type.includes('application/json')) {
      const data = await res.json();
      throw new Error(data.error || 'Export returned JSON instead of a file');
    }
    const blob = await res.blob();
    let filename = `${format}-export.${format}`;
    const disposition = res.headers.get('content-disposition') || '';
    const match = /filename="([^"]+)"/i.exec(disposition);
    if (match?.[1]) filename = match[1];
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  getNotes: () => request('/api/notes'),
  createNote: (body) => request('/api/notes/notes', { method: 'POST', body: JSON.stringify(body) }),
  updateNote: (id, body) =>
    request(`/api/notes/notes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteNote: (id) => request(`/api/notes/notes/${id}`, { method: 'DELETE' }),
  createTask: (body) => request('/api/notes/tasks', { method: 'POST', body: JSON.stringify(body) }),
  updateTask: (id, body) =>
    request(`/api/notes/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTask: (id) => request(`/api/notes/tasks/${id}`, { method: 'DELETE' }),

  aiHistory: (docId) => request(`/api/ai/history/${docId}`),
  aiPrompt: (body) => request('/api/ai/prompt', { method: 'POST', body: JSON.stringify(body) }),
};
