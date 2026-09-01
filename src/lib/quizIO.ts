// ---------------------------------------------------------------------------
// quizIO, text <-> quiz for import / export (the sibling of setlistIO).
// ---------------------------------------------------------------------------
// A plain, hand-writable line format so a quiz round-trips through a file or the
// clipboard and a blank template / worked example can be filled in offline:
//
//   # Quiz title
//
//   Q: What is the capital of Japan?
//   - Tokyo
//   - Osaka
//   - Kyoto
//   A: Tokyo
//
//   Q: 2 + 2?
//   A: 4
//
// A "Q:" line starts a question (the "Q:" is optional, any bare line does too);
// "-" / "*" / "•" lines under it are multiple-choice options; an "A:" line is the
// answer (it highlights the matching option in the widget, if the answer text is
// one of the options). A leading "#" line is the quiz title. Pure: no React, no
// DOM. Mirrors the shape QuizBlock stores, so an export re-imports cleanly.

export interface QuizItem {
  id: string;
  text: string; // the question
  answer: string; // the answer (matched against an option to highlight it, if any)
  options?: string[]; // optional multiple choice
}

const OPTION_RE = /^[-*•]\s+/;
// A leading "Q:" / "Q)" / "Q." / "Q1:" style marker on a question line, stripped.
const Q_PREFIX_RE = /^q\s*\d*\s*[:).]\s*/i;
// A leading "A:" / "Answer:" / "A)" style marker on an answer line.
const A_PREFIX_RE = /^(?:a|ans|answer)\s*[:).]\s*/i;

export function serializeQuiz(title: string, items: QuizItem[]): string {
  const out: string[] = [];
  if (title.trim()) out.push(`# ${title.trim()}`, '');
  items.forEach((it, i) => {
    if (i > 0) out.push('');
    out.push(`Q: ${it.text ?? ''}`.trimEnd());
    for (const opt of it.options ?? []) if (opt.trim()) out.push(`- ${opt.trim()}`);
    if (it.answer && it.answer.trim()) out.push(`A: ${it.answer.trim()}`);
  });
  return out.join('\n') + '\n';
}

export function parseQuiz(text: string): { title: string; items: QuizItem[] } {
  const result: { title: string; items: QuizItem[] } = { title: '', items: [] };
  let n = 0;
  let current: QuizItem | null = null;

  const push = () => {
    if (current && (current.text.trim() || (current.options?.length ?? 0) || current.answer.trim())) {
      if (current.options && current.options.length === 0) delete current.options;
      result.items.push(current);
    }
    current = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    // Title: a leading '#', or the very first bare line before any question.
    if (line.startsWith('#')) {
      if (!result.title) result.title = line.replace(/^#+\s*/, '').trim();
      continue;
    }

    // An option belongs to the question being built.
    if (OPTION_RE.test(line)) {
      if (current) (current.options ??= []).push(line.replace(OPTION_RE, '').trim());
      continue;
    }

    // An answer line closes out the current question's answer.
    if (A_PREFIX_RE.test(line)) {
      if (current) current.answer = line.replace(A_PREFIX_RE, '').trim();
      continue;
    }

    // Anything else starts a new question (an optional "Q:" marker is stripped).
    push();
    current = { id: `q${n++}`, text: line.replace(Q_PREFIX_RE, '').trim(), answer: '', options: [] };
  }
  push();
  return result;
}

// A worked, fill-in template that re-imports cleanly through parseQuiz: it shows
// every shape (multiple choice with an answer, and a plain question + answer).
export const QUIZ_TEMPLATE = `# My quiz

Q: What is the capital of Japan?
- Tokyo
- Osaka
- Kyoto
A: Tokyo

Q: In what year did the Meiji era begin?
- 1853
- 1868
- 1912
A: 1868

Q: Name the tallest mountain in Japan.
A: Mount Fuji

Q: Shinkansen is the Japanese word for what?
A: Bullet train
`;
