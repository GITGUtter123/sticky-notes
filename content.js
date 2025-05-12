class StickyNoteManager {
  constructor() {
    this.notes = [];
    this.currentUrl = window.location.href;
    this.colorOptions = [
      { class: 'color-yellow', bg: '#ffffa0' },
      { class: 'color-pink', bg: '#ffb6c1' },
      { class: 'color-blue', bg: '#add8e6' },
      { class: 'color-green', bg: '#98fb98' },
      { class: 'color-purple', bg: '#e6e6fa' }
    ];
    this.init();
  }

  init() {
    this.loadNotes();
    this.createAddNoteButton();
    this.addNoteButton.addEventListener('click', () => this.createNewNote());
    
    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'restoreNote') {
        this.restoreNote(request.note);
      }
    });
  }

  createAddNoteButton() {
    this.addNoteButton = document.createElement('div');
    this.addNoteButton.id = 'sticky-notes-add-btn';
    this.addNoteButton.innerHTML = '+';
    this.addNoteButton.title = 'Add New Sticky Note';
    document.body.appendChild(this.addNoteButton);
  }

  createNewNote(content = '', position = null, colorIndex = 0, id = Date.now().toString(), title = '') {
    const note = document.createElement('div');
    note.className = `sticky-note ${this.colorOptions[colorIndex].class}`;
    note.dataset.noteId = id;
    note.style.width = '350px'; // Increased width
    
    note.innerHTML = `
      <div class="sticky-note-header">
        <input type="text" class="sticky-note-title" placeholder="Note title" value="${title}" style="width: 200px; margin-right: 10px;" />
        <div class="sticky-note-color-picker">
          ${this.colorOptions.map((_, i) => 
            `<div class="sticky-note-color ${this.colorOptions[i].class}" data-index="${i}"></div>`
          ).join('')}
        </div>
        <span class="sticky-note-close">×</span>
      </div>
      <textarea class="sticky-note-content" placeholder="Type your note..." style="width: 100%;">${content}</textarea>
    `;

    if (position) {
      note.style.left = `${position.x}px`;
      note.style.top = `${position.y}px`;
    } else {
      note.style.left = `${Math.random() * (window.innerWidth - 350)}px`;
      note.style.top = `${Math.random() * (window.innerHeight - 250)}px`;
    }

    this.makeDraggable(note);

    // Add color picker functionality
    note.querySelectorAll('.sticky-note-color').forEach(colorDot => {
      colorDot.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(colorDot.dataset.index);
        note.className = `sticky-note ${this.colorOptions[index].class}`;
        note.querySelector('textarea').style.backgroundColor = this.colorOptions[index].bg;
        note.querySelector('.sticky-note-title').style.backgroundColor = this.colorOptions[index].bg;
        this.saveNotes();
      });
    });

    // Close button now moves to inventory instead of deleting
    const closeBtn = note.querySelector('.sticky-note-close');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.moveToInventory(note);
    });

    const textarea = note.querySelector('textarea');
    const titleInput = note.querySelector('.sticky-note-title');
    textarea.style.backgroundColor = this.colorOptions[colorIndex].bg;
    titleInput.style.backgroundColor = this.colorOptions[colorIndex].bg;
    textarea.addEventListener('input', () => this.saveNotes());
    titleInput.addEventListener('input', () => this.saveNotes());

    document.body.appendChild(note);
    this.notes.push(note);
    this.saveNotes();

    return note;
  }

  moveToInventory(note) {
    const index = this.notes.indexOf(note);
    if (index > -1) {
      this.notes.splice(index, 1);
      document.body.removeChild(note);
      
      // Save to inventory
      chrome.storage.local.get(['inventory'], (data) => {
        const inventory = data.inventory || [];
        inventory.push({
          id: note.dataset.noteId,
          title: note.querySelector('.sticky-note-title').value,
          content: note.querySelector('textarea').value,
          x: parseInt(note.style.left),
          y: parseInt(note.style.top),
          colorIndex: this.colorOptions.findIndex((_, i) => 
            note.classList.contains(this.colorOptions[i].class)
          ),
          url: this.currentUrl,
          hiddenDate: new Date().toISOString()
        });
        chrome.storage.local.set({ inventory }, () => {
          this.saveNotes();
        });
      });
    }
  }

  restoreNote(noteData) {
    this.createNewNote(
      noteData.content,
      { x: noteData.x, y: noteData.y },
      noteData.colorIndex,
      noteData.id,
      noteData.title
    );
  }

  makeDraggable(note) {
    let isDragging = false;
    let currentX, currentY, initialX, initialY, xOffset = 0, yOffset = 0;

    const dragStart = (e) => {
      initialX = e.clientX - xOffset;
      initialY = e.clientY - yOffset;

      if (e.target === note.querySelector('.sticky-note-header') || 
          e.target === note.querySelector('.sticky-note-title') ||
          e.target.classList.contains('sticky-note-color')) {
        isDragging = true;
      }
    };

    const dragEnd = () => {
      initialX = currentX;
      initialY = currentY;
      isDragging = false;
      this.saveNotes();
    };

    const drag = (e) => {
      if (isDragging) {
        e.preventDefault();
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;

        xOffset = currentX;
        yOffset = currentY;

        note.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
      }
    };

    note.querySelector('.sticky-note-header').addEventListener('mousedown', dragStart);
    document.addEventListener('mouseup', dragEnd);
    document.addEventListener('mousemove', drag);
  }

  saveNotes() {
    const notesData = this.notes.map(note => ({
      id: note.dataset.noteId,
      title: note.querySelector('.sticky-note-title').value,
      content: note.querySelector('textarea').value,
      x: parseInt(note.style.left),
      y: parseInt(note.style.top),
      colorIndex: this.colorOptions.findIndex((_, i) => 
        note.classList.contains(this.colorOptions[i].class)
      )
    }));

    chrome.storage.local.set({
      [`notes_${this.currentUrl}`]: notesData
    });
  }

  loadNotes() {
    chrome.storage.local.get(`notes_${this.currentUrl}`, (data) => {
      const savedNotes = data[`notes_${this.currentUrl}`] || [];
      savedNotes.forEach(noteData => {
        this.createNewNote(
          noteData.content,
          { x: noteData.x, y: noteData.y },
          noteData.colorIndex,
          noteData.id,
          noteData.title
        );
      });
    });
  }
}

// Initialize sticky notes when page loads
window.addEventListener('load', () => {
  new StickyNoteManager();
});