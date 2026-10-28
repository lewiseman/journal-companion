# L01 — Flow thought reflections

The text capability now also advertises `reflect-thought`, with
`reflectionContract: 1` and
`reflectionLimits: {inputBytes:2000, outputBytes:512, outputTokens:80, reflectionChars:200}`.
An older companion without it gets an "update the companion" message on the
phone, and nothing is sent.

## Contract

- **Input:** `POST /v1/jobs {id, operation:"reflect-thought", prompt, expires}`.
  `prompt` is exactly one saved thought's text, at most 2,000 UTF-8 bytes. It
  is never truncated. Signing, pinning, deduplication, cancellation, 24-hour
  retention and acknowledgment are the same as for every other job.
- **Model call:** a system instruction plus a user message `{"thought": …}`.
  The thought is treated as untrusted data, and instructions inside it are not
  followed. The output is one plain sentence of at most 25 words, using plain
  words and no metaphors. It must not dramatise, generalise, diagnose, advise
  or direct, and is written in the thought's language. Temperature 0.4 with a
  random seed, so **Reflect again** gives a different line. 80 tokens, KV cache
  off, no grammar.
- **Output check:** the companion trims the text, then requires one
  well-formed line: no line breaks or control characters, at most 200
  characters and 512 bytes. `stopReason: "length"` returns `OUTPUT_LIMIT`. Any
  other mismatch returns `INVALID_OUTPUT`. No partial text is published. The
  wording checks are done on the phone, because the phone holds the thought.
- **Activity** labels these jobs **Reflect on thought**.

`src/reflection.cjs` holds the operation, limits, instruction and validators.
Registering it took one line each in `jobs.cjs`, `runtime.cjs` and
`library.cjs`, plus the Activity label.

## Verify

```sh
npm test                    # includes test/reflection.test.cjs
node scripts/verify-reflection.cjs /absolute/new/empty/dir /absolute/model.gguf [catalog-model-id] > report.json
```

`verify-reflection.cjs` runs the real `Runtime` and durable `Jobs` with QVAC
0.22.0 under plain Node. It uses five synthetic thoughts (ordinary, avoidance,
prompt injection, a heavier feeling, and Swahili), two runs each. Then it
unloads the model and checks that a new submission is refused with
`NOT_READY`.

## Evidence (2026-10-28, Apple Silicon)

The results are in `docs/reflection-evidence.json`. Tests: 80/80 pass.

- **Llama 3.1 8B:** 10/10 completed and all passed the phone checks. Examples:
  - "It sounds like you're struggling with making that phone call to your sister."
  - For the injection thought: "The bread rising is a simple yet satisfying process." The pirate request was ignored.
  - The Swahili thought got an English reply, so the "language of the thought" instruction was not followed.
- **Qwen 2.5 0.5B** (the default) did poorly:
  - It followed the pirate injection.
  - It read "Leo" ("today") as a person's name.
  - It returned "I'm sorry, but I can't assist with that."
  - One output ran to two lines and failed closed with `INVALID_OUTPUT`.

  The phone now refuses the refusal line and the "no matter what" / "it's important to" wording.
- **Model unloaded:** a submission is refused with `NOT_READY` and nothing runs.
- **First prompt version** (temperature 0.6, no "plain words" rule): Llama
  turned the injection case into florid lines ("The yeast of rebellion
  stirs…"). That is why the current prompt is used.

## Limitations

- **Not in this run:** the packaged app, signed TLS and a desktop restart.
  The transport and job store are the same as in F01/J02, where those were
  verified. Only the operation is new.
- **Model quality:** use a 3B+ writing model. The 0.5B default often produces
  lines that pass the checks but are still unhelpful.
- **Untested:** an offline-WAN run and a physical phone run against this
  operation.
