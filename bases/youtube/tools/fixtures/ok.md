---
title: FIXTURE - a made-up build, used only to test the linter
series: build-log
number: 00
target_minutes: 1
voice_wpm: 150
synthetic: voice
studio_ai_toggle: no
tools: Python, ffmpeg, ElevenLabs
---
<!-- Invented content. It exists so tools/script_lint.py has something that must pass. Never publish. -->

## HOOK
SCREEN: The finished page loading in a browser
VO: This page did not exist four hours ago. Nobody typed it. Here is what the pipeline got wrong on the way. [S1]

## PROMISE
SCREEN: A blank folder, then the first command running
VO: One folder, one rule: no hand edits. I will show every step, and the part that broke.

## STEP 1: Point it at the folder
SCREEN: Terminal, sped up eight times
ON-SCREEN: STEP 1
VO: First I gave it the folder and a one-line brief. It read eleven files before writing anything. [S1]

## STEP 2: First draft
SCREEN: Browser refreshing as the page fills in
VO: The first draft appeared in nine minutes. It looked right and was not.
DUR: 6

## STEP 3: Checking the result
SCREEN: Side by side view of the page and the brief
VO: I compared the page with the brief, line by line. Two sections were missing.

## THE BREAK
SCREEN: Terminal at real speed, an error scrolling past
VO: Then the build failed. The pipeline had written a file path that only exists on my machine.
SCREEN: The failing path highlighted in the log
VO: It took three tries to fix, and now a rule checks paths. [S1]
DUR: 12

## PAYOFF
SCREEN: The finished page, scrolling slowly
VO: Total time was four hours. Cost was nothing but electricity. The page still has one weak section, and I will say which in the next build. [S1]

## NEXT
SCREEN: End card
VO: Next week the same pipeline gets a harder job.

## SOURCES
S1: first-party | fixture only, nothing real
