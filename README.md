# Flipside

> Work in progress

A dependency-free study app.

Visit [idaries.github.io/flipside](https://idaries.github.io/flipside) to try it.

## Run

Open `index.html` directly, or serve the folder:

```sh
python3 -m http.server 8080
```

Then open http://localhost:8080.

## Features

- Flashcards and multiple-choice sessions
- Optional FSRS spaced repetition on individual decks
- Front-first / back-first study
- Local deck folders
- Quizlet / Anki TSV import and export
- Optional AI-assisted file import and quiz distractors
- Themes, persisted study preferences, card search, a study dashboard, and JSON backup/restore
- Reversible card deletion and drag-and-drop text file import

## Data

Flipside uses browser `localStorage` and does not include a backend. API keys are stored locally by provider and are only sent directly to the selected provider.
