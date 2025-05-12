document.addEventListener('DOMContentLoaded', () => {
  // Tab switching functionality
  const tabs = document.querySelectorAll('.popup-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      document.querySelectorAll('.popup-tab-content').forEach(content => {
        content.classList.remove('active');
      });
      document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');
    });
  });

  // Search functionality for inventory
  const searchInput = document.getElementById('inventory-search');
  searchInput.addEventListener('input', () => {
    const searchTerm = searchInput.value.toLowerCase().trim();
    filterInventory(searchTerm);
  });

  // Load inventory notes
  loadInventory();

  // Clear inventory button
  document.getElementById('clear-inventory').addEventListener('click', () => {
    if (confirm('Are you sure you want to permanently delete all hidden notes?')) {
      chrome.storage.local.set({ inventory: [] }, () => {
        loadInventory();
      });
    }
  });

  // Export notes button
  document.getElementById('export-notes').addEventListener('click', exportAllNotes);

  // Import notes button
  document.getElementById('import-notes').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });

  // Handle file selection for import
  document.getElementById('import-file').addEventListener('change', handleFileImport);
});

function filterInventory(searchTerm) {
  const inventoryList = document.getElementById('inventory-list');
  const inventoryNotes = inventoryList.querySelectorAll('.inventory-note');

  let hasVisibleNotes = false;
  inventoryNotes.forEach(note => {
    const title = note.querySelector('.note-title')?.textContent.toLowerCase() || '';
    const hostname = note.querySelector('.note-hostname').textContent.toLowerCase();
    const content = note.querySelector('.hidden-note-content').textContent.toLowerCase();
    
    const matches = title.includes(searchTerm) || 
                    content.includes(searchTerm) || 
                    hostname.includes(searchTerm);
    
    if (matches) {
      note.style.display = '';
      hasVisibleNotes = true;
    } else {
      note.style.display = 'none';
    }
  });

  if (!hasVisibleNotes) {
    inventoryList.innerHTML = '<p>No notes match your search.</p>';
  } else if (inventoryList.children[0]?.tagName === 'P') {
    loadInventory();
  }
}

function loadInventory() {
  chrome.storage.local.get(['inventory'], (data) => {
    const inventory = data.inventory || [];
    const inventoryList = document.getElementById('inventory-list');
    inventoryList.innerHTML = '';

    if (inventory.length === 0) {
      inventoryList.innerHTML = '<p>No hidden notes in inventory.</p>';
      return;
    }

    inventory.forEach((note, index) => {
      const noteElement = document.createElement('div');
      noteElement.className = 'inventory-note';
      noteElement.innerHTML = `
        <div class="inventory-note-content">
          ${note.title ? `<div class="note-title"><strong>${note.title}</strong></div>` : ''}
          <div class="hidden-note-content" style="display: none;">${note.content || 'Empty Note'}</div>
          <small class="note-hostname">From: ${new URL(note.url).hostname}</small>
          <small>Hidden on: ${new Date(note.hiddenDate).toLocaleString()}</small>
        </div>
        <div class="inventory-note-actions">
          <button class="restore-note" data-index="${index}">Restore</button>
          <button class="delete-note" data-index="${index}">Delete</button>
        </div>
      `;
      inventoryList.appendChild(noteElement);
    });

    document.querySelectorAll('.restore-note').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = e.target.dataset.index;
        restoreNote(index);
      });
    });

    document.querySelectorAll('.delete-note').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = e.target.dataset.index;
        deleteNote(index);
      });
    });
  });
}

function restoreNote(index) {
  chrome.storage.local.get(['inventory'], (data) => {
    const inventory = data.inventory || [];
    if (index >= 0 && index < inventory.length) {
      const noteToRestore = inventory[index];
      
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'restoreNote',
          note: noteToRestore
        });
      });
      
      inventory.splice(index, 1);
      chrome.storage.local.set({ inventory }, () => {
        loadInventory();
      });
    }
  });
}

function deleteNote(index) {
  if (confirm('Are you sure you want to permanently delete this note?')) {
    chrome.storage.local.get(['inventory'], (data) => {
      const inventory = data.inventory || [];
      if (index >= 0 && index < inventory.length) {
        inventory.splice(index, 1);
        chrome.storage.local.set({ inventory }, () => {
          loadInventory();
        });
      }
    });
  }
}

function exportAllNotes() {
  showStatus('Exporting notes...', 'success');
  
  chrome.storage.local.get(null, (data) => {
    try {
      // Filter and validate the data
      const exportData = {};
      for (const key in data) {
        if (key.startsWith('notes_') || key === 'inventory') {
          if (isValidNotesData(data[key])) {
            exportData[key] = data[key];
          }
        }
      }

      if (Object.keys(exportData).length === 0) {
        showStatus('No notes found to export', 'error');
        return;
      }

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sticky-notes-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 100);
      
      showStatus('Notes exported successfully!', 'success');
    } catch (error) {
      console.error('Export error:', error);
      showStatus('Failed to export notes: ' + error.message, 'error');
    }
  });
}

function handleFileImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  const statusElement = document.getElementById('import-status');
  statusElement.textContent = 'Reading file...';
  statusElement.className = 'status-message';
  statusElement.style.display = 'block';

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const importedData = JSON.parse(e.target.result);
      
      if (!isValidImportData(importedData)) {
        showStatus('Invalid notes file format', 'error');
        return;
      }

      if (!confirm('This will overwrite your current notes. Continue?')) {
        showStatus('Import canceled', 'error');
        return;
      }

      statusElement.textContent = 'Importing notes...';
      
      // First get current data to backup
      chrome.storage.local.get(null, (currentData) => {
        try {
          // Prepare clean import
          const cleanImport = {};
          for (const key in importedData) {
            if ((key.startsWith('notes_') || key === 'inventory') && isValidNotesData(importedData[key])) {
              cleanImport[key] = importedData[key];
            }
          }

          if (Object.keys(cleanImport).length === 0) {
            showStatus('No valid notes found in file', 'error');
            return;
          }

          // Clear existing data and set new data
          chrome.storage.local.clear(() => {
            chrome.storage.local.set(cleanImport, () => {
              showStatus('Notes imported successfully! Reloading...', 'success');
              
              // Reload the page to see changes
              setTimeout(() => {
                chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                  if (tabs[0]) {
                    chrome.tabs.reload(tabs[0].id);
                  }
                });
              }, 1500);
            });
          });
        } catch (error) {
          console.error('Import error:', error);
          showStatus('Failed to import notes: ' + error.message, 'error');
        }
      });
    } catch (error) {
      console.error('File parse error:', error);
      showStatus('Invalid JSON file: ' + error.message, 'error');
    }
  };
  
  reader.onerror = () => {
    showStatus('Error reading file', 'error');
  };
  
  reader.readAsText(file);
  event.target.value = '';
}

function isValidNotesData(data) {
  if (!data) return false;
  if (Array.isArray(data)) {
    // Inventory or notes array
    return data.every(item => 
      typeof item === 'object' && 
      (item.content !== undefined || item.title !== undefined)
    );
  }
  return false;
}

function isValidImportData(data) {
  if (!data || typeof data !== 'object') return false;
  for (const key in data) {
    if (key.startsWith('notes_') || key === 'inventory') {
      if (!isValidNotesData(data[key])) return false;
    }
  }
  return true;
}

function showStatus(message, type) {
  const statusElement = document.getElementById('import-status');
  statusElement.textContent = message;
  statusElement.className = `status-message ${type}`;
  statusElement.style.display = 'block';
  
  if (type === 'success') {
    setTimeout(() => {
      statusElement.style.display = 'none';
    }, 3000);
  }
}