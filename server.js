const express = require('express');
const multer = require('multer');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');
const { jsonrepair } = require('jsonrepair');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
const PORT = process.env.PORT || 3000;
let geminiModel;

app.use(express.static('public'));

function clean(value = '') {
  return value.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

async function textFromFile(file) {
  const name = file.originalname.toLowerCase();
  if (/\.(txt|csv|md)$/i.test(name)) return file.buffer.toString('utf8');
  if (/\.docx$/i.test(name)) return (await mammoth.extractRawText({ buffer: file.buffer })).value;
  if (/\.pdf$/i.test(name)) return (await pdf(file.buffer)).text;
  throw new Error(`${file.originalname}: use a TXT, CSV, DOCX, or text-based PDF file.`);
}

function parseKey(source) {
  const answers = new Map();
  clean(source).split('\n').forEach(line => {
    const match = line.match(/^\s*(\d+)\s*(?:[.)\-:;]|,)\s*(?:answer\s*[:\-]?\s*)?(.+?)\s*$/i);
    if (match) answers.set(Number(match[1]), match[2].replace(/^\(?[A-D]\)?\s*[-.:]?\s*/i, '').trim() || match[2].trim());
  });
  return answers;
}

function parseQuestions(source) {
  const text = clean(source);
  const starts = [...text.matchAll(/^\s*(\d+)\s*[.)]\s+(.+)/gm)];
  if (!starts.length) return [];
  return starts.map((match, index) => {
    const end = starts[index + 1]?.index ?? text.length;
    let block = text.slice(match.index, end).replace(/^\s*\d+\s*[.)]\s*/, '').trim();
    const options = [];
    block = block.replace(/(?:^|\n)\s*([A-D])\s*[.)]\s*(.+?)(?=(?:\n\s*[A-D]\s*[.)])|$)/gis, (_, label, choice) => {
      options.push({ label: label.toUpperCase(), text: clean(choice) });
      return '';
    });
    return { number: Number(match[1]), question: clean(block), options };
  }).filter(item => item.question);
}

function buildReviewer(examText, keyText) {
  const questions = parseQuestions(examText);
  const answers = parseKey(keyText);
  if (!questions.length) throw new Error('No numbered questions were found. Format questions as “1. Your question”.');
  if (!answers.size) throw new Error('No numbered answers were found in the key. Format key entries as “1. Answer”.');
  return questions.map(item => ({
    ...item,
    answer: answers.get(item.number) || 'Answer not found in supplied key',
    matched: answers.has(item.number)
  }));
}

async function improveWithGemini(examText, keyText) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini is required for this app. Add GEMINI_API_KEY to the .env file, then restart the server.');
  if (!geminiModel) {
    const modelsResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models', { headers: { 'x-goog-api-key': apiKey } });
    if (!modelsResponse.ok) throw new Error(`Gemini model discovery failed (API status ${modelsResponse.status}). Check the server API key and its Gemini API access.`);
    const models = (await modelsResponse.json()).models || [];
    const usable = models.filter(model => (model.supportedGenerationMethods || model.supportedActions || []).includes('generateContent'));
    const preferred = ['models/gemini-3.5-flash', 'models/gemini-3.6-flash', 'models/gemini-3-flash-preview', 'models/gemini-flash-latest'];
    /*geminiModel = preferred.find(name => usable.some(model => model.name === name)) || usable[0]?.name;*/
    geminiModel = 'models/gemini-3.5-flash-lite';
    if (!geminiModel) throw new Error('No Gemini model with generateContent access is available for this API key.');
    console.log(`Using Gemini model: ${geminiModel}`);
  }
  const prompt = `You are an exacting educational-content designer. Turn this exam questionnaire and answer key into polished STUDY NOTES, matching this card pattern:
Title: "Knowledge Discovery Tools"
Study sentence: "The structured tools and collections that support finding, evaluating, and applying knowledge are known as Library sources."
Key note: "Library sources = Structured tools supporting knowledge discovery"

Return JSON only in this exact shape: {"course":{"code":"ITE3","description":"Elective Research"},"cards":[{"number":1,"title":"short concept title","lead":"A revised declarative study sentence before the answer ","highlight":"the correct answer text","tail":" after the answer.","keyNote":"short memory aid starting with the answer or concept"}]}.

Rules:
1. Extract ONLY actual exam questions, never school vision/mission text, instructions, signatures, headers, or page labels.
2. The questionnaire may have no printed question numbers. In that case, number questions sequentially in their visual/text order, starting at 1.
3. Extract choices where present. Label choices A, B, C, D in their listed order if labels were lost during DOCX extraction.
4. The answer key may be a bare sequential list (for example A, B, C...) followed by explicit entries like 34.C. Match bare answers to question order beginning with question 1, then use explicit numbering where given.
5. Use each answer-key letter to resolve the correct choice text. The highlight MUST be that answer text, never only its letter.
6. Rewrite each question as a concise, grammatically complete DECLARATIVE study sentence. Put every word before the correct answer in lead, the correct answer alone in highlight, and any final punctuation or words in tail.
7. Give every card a useful short title and a concise Key memory note. Do not show answer choices, multiple-choice labels, original question wording, or "Answer:" in the result.
8. Preserve facts. Do not invent missing answers. Return every question you can reliably identify.
9. Read the exam header to extract course.code and course.description. Use the actual subject/course line, not the exam type, college, semester, or school name.

QUESTIONNAIRE:\n${examText.slice(0, 60000)}\n\nANSWER KEY:\n${keyText.slice(0, 30000)}`;
  const request = () => fetch(`https://generativelanguage.googleapis.com/v1beta/${geminiModel}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } })
  });
  let response;
  let lastNetworkError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await request();
      if (response.status !== 503) break;
    } catch (error) {
      lastNetworkError = error;
      console.error(`Gemini network attempt ${attempt + 1} failed: ${error.cause?.code || error.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
  }
  if (!response) throw new Error(`Could not connect to Gemini after 3 attempts (${lastNetworkError?.cause?.code || 'network error'}). Please try again shortly.`);
  if (!response.ok) {
    const detail = await response.text();
    console.error(`Gemini API error ${response.status}: ${detail.slice(0, 500)}`);
    throw new Error(response.status === 503 ? 'Gemini is temporarily busy. Please click Create reviewer again in a moment.' : `Gemini could not process these files (API status ${response.status}). Check the server API key, its Gemini API access, and quota.`);
  }
  const data = await response.json();
  const rawJson = (data.candidates?.[0]?.content?.parts?.[0]?.text || '{}')
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    try {
      parsed = JSON.parse(jsonrepair(rawJson));
    } catch {
      throw new Error('Gemini returned an incomplete reviewer response. Please click Create reviewer again.');
    }
  }
  const cards = Array.isArray(parsed) ? parsed : parsed.cards;
  if (!Array.isArray(cards) || !cards.length) throw new Error('Gemini returned no usable study-note cards.');
  return {
    course: { code: clean(parsed.course?.code), description: clean(parsed.course?.description) },
    cards: cards.map(item => ({
      title: clean(item.title), lead: clean(item.lead),
      highlight: clean(item.highlight), tail: clean(item.tail), keyNote: clean(item.keyNote)
    }))
  };
}

app.post('/api/reviewer', upload.fields([{ name: 'exam', maxCount: 1 }, { name: 'key', maxCount: 1 }]), async (req, res) => {
  try {
    const exam = req.files?.exam?.[0], key = req.files?.key?.[0];
    if (!exam || !key) throw new Error('Upload both the exam questionnaire and answer key.');
    const [examText, keyText] = await Promise.all([textFromFile(exam), textFromFile(key)]);
    const reviewer = await improveWithGemini(examText, keyText);
    res.json({ ...reviewer, source: 'Gemini study-note generation' });
  } catch (error) {
    res.status(400).json({ error: error.message || 'The reviewer could not be created.' });
  }
});

app.use((error, req, res, next) => res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Files must be 12 MB or smaller.' : error.message }));
app.listen(PORT, () => console.log(`Exam Reviewer Studio is running at http://localhost:${PORT}`));
