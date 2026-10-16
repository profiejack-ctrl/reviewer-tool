(() => {
  const button = document.getElementById('generate');
  const error = document.getElementById('error');
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function renderStudyNotes(cards, course, source) {
    const title = [course?.code, course?.description].filter(Boolean).join(' – ') || 'Exam Reviewer';
    document.getElementById('reviewerTitle').textContent = title;
    document.getElementById('reviewerInfo').textContent = `${cards.length} study notes`;
    document.getElementById('cards').innerHTML = cards.map(card => `
      <article class="card">
        <h3>${escapeHtml(card.title)}</h3>
        <p class="study-sentence">${escapeHtml(card.lead)} <span class="highlight">${escapeHtml(card.highlight)}</span>${escapeHtml(card.tail)}</p>
        <div class="key-note"><b>Key:</b> ${escapeHtml(card.keyNote)}</div>
      </article>`).join('');
    const reviewer = document.getElementById('reviewer');
    reviewer.style.display = 'block';
    reviewer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Capture phase overrides the older question-and-answer renderer without
  // changing the file-upload behavior above.
  button.addEventListener('click', async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const exam = document.getElementById('exam').files[0];
    const key = document.getElementById('key').files[0];
    if (!exam || !key) return;
    button.disabled = true;
    button.textContent = 'Gemini is creating reviewer...';
    error.textContent = '';
    try {
      const form = new FormData();
      form.append('exam', exam);
      form.append('key', key);
      const response = await fetch('/api/reviewer', { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      renderStudyNotes(result.cards, result.course, result.source);
    } catch (caught) {
      error.textContent = caught instanceof TypeError && caught.message === 'Failed to fetch'
        ? 'Cannot reach the app server. Restart it and open http://localhost:3000.'
        : caught.message;
    } finally {
      button.disabled = false;
      button.textContent = 'Create reviewer';
    }
  }, true);
})();
