---
title: TODO working title, plain English, under 60 characters
series: build-log          # build-log | redesign
number: TODO               # 01, 02 ... within the series
target_minutes: 6          # finished runtime, not voice time
voice_wpm: 150             # pace of the one narrator voice
synthetic: voice           # none | voice | footage | voice+footage
studio_ai_toggle: no       # yes if anything realistic could be mistaken for real; see SCRIPT.md
tools: TODO                # comma list, named in the description
---
<!--
Format: one "## " heading per beat; inside it, shots. A shot starts with SCREEN:, then VO: (what
the voice says; wrapped lines continue it), optional ON-SCREEN: (text drawn on the picture) and
DUR: seconds (only for shots with no voice, or to hold longer than the voice). NOTE: lines are
ignored. Tag every fact in VO with [S1], [S2] ... defined under ## SOURCES.
Rules and reasons: SCRIPT.md. Check with: python3 tools/script_lint.py <this file>
-->

## HOOK
<!-- Show the result first. One concrete number. Under 15 seconds, at most 35 words. No greeting. -->
SCREEN: TODO the finished thing, on screen, in the first second
VO: TODO the outcome, the number, and what was at stake.

## PROMISE
<!-- What was built, the one rule it was built under, what you will see. Two or three sentences. -->
SCREEN: TODO
VO: TODO

## STEP 1: TODO name
SCREEN: TODO real screen recording, sped up
ON-SCREEN: TODO lower-third text if any
VO: TODO what was asked or done, and what happened. [S1]

## STEP 2: TODO name
SCREEN: TODO
VO: TODO

## STEP 3: TODO name
SCREEN: TODO
VO: TODO

## THE BREAK
<!-- Required. What actually went wrong, in real time, and how it was found and fixed. At least a tenth of the video. -->
SCREEN: TODO the failure, at real speed
VO: TODO

## PAYOFF
<!-- The result, with what it cost, how long it took, and what is still not right. -->
SCREEN: TODO
VO: TODO

## NEXT
<!-- One sentence on the next real build. True: only promise what is already planned. -->
SCREEN: TODO end card
VO: TODO

## SOURCES
<!-- S1: first-party | where it lives: repo path, commit, log, or session note -->
<!-- S2: https://... | page title | accessed 2026-10-26 -->
S1: TODO
