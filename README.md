# Exam Reviewer Studio

Upload an exam questionnaire and answer key to create a printable reviewer.

## Run it

```powershell
npm.cmd install
npm.cmd start
```

Open http://localhost:3000.

The app supports TXT, CSV, DOCX, and text-based PDF files. For best matching, number questions and answer-key entries consistently, for example `1. What is HTML?` and `1. Hypertext Markup Language`.

## Optional Gemini extraction

To use AI cleanup for messy documents, copy `.env.example` to `.env`, then put your key there:

```powershell
Copy-Item .env.example .env
# Edit .env and replace the placeholder key, then:
npm.cmd start
```

The API key remains on the server; it is never sent to the browser.
