# Task: choose unambiguous distractors for fill-in-the-blank vocabulary questions

You are checking a Japanese high-school English vocabulary app. Each line of your input TSV is one question:

`key <TAB> sentence with (___) <TAB> correct answer <TAB> candidate distractors separated by " | "`

The student sees the sentence and 4 choices (the correct answer + 3 distractors) and must pick the word that fills the blank.
Choices are shown in dictionary/base form; if the blank needs an inflected form (past tense, plural, -ing, etc.), the student mentally inflects it. So judge each candidate **as if correctly inflected**.

## Your job
For every line, pick up to **6** candidates that are **clearly wrong** in the blank — a fluent English teacher would agree without hesitation that the sentence becomes wrong or nonsensical with that word (meaning or grammar), so there is exactly one correct answer.

REJECT a candidate (do not pick it) if, correctly inflected, it would produce a sentence that is acceptable or even arguably acceptable, e.g.:
- "The most (expensive) cake in the shop has real gold." → reject *sweet* (the most sweet/sweetest cake… is fine).
- "She (unfold) the old map and spread it out." → reject *examine*.
- "Tomatoes (grow) very well in the hot sun." → reject *sell*.
- determiners/pronouns that also fit ("(___) small key was on the table" → reject my/your/their/another/its/his/her/our/which/what as they work as well).
When in doubt, REJECT. Being strict is the whole point.

Prefer distractors that are clearly wrong because of **meaning** (still the same part of speech, so the question is not trivially solved by grammar alone).

If fewer than 3 candidates are clearly wrong, add your own distractors (common English words of similar difficulty and the same part of speech) until you have at least 3, and mark the line with "x": true.

## Output
Write a JSON Lines file (one JSON object per input line, same order, every line included) to the output path you were given:
`{"k": "<key>", "d": ["word1", "word2", ...]}` (add `"x": true` only when you added your own words).
Copy candidate words exactly as written in the input (same spelling and case). Do not include the correct answer.

Work through the whole file carefully; do not skip lines or produce placeholders. When done, verify the output has exactly as many lines as the input (e.g. `wc -l`), then reply with only: the number of lines written and the number of lines marked "x".

## Also flag weak example sentences
If the sentence itself is a poor test of the correct answer — the correct answer reads oddly in it, or a much more natural word would obviously be expected instead (e.g. "My shoes are (dry) now after the long rain." — *wet* is the natural word) — add `"bad": "<short reason in English>"` to that line's object. Do not flag sentences just because several unrelated words could grammatically fit; flag only when the correct answer itself is unnatural or misleading.
