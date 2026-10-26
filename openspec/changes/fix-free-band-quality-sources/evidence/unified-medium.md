# Unified fitness hypothesis: medium

Offline frozen snapshots; no inference or routing integration.

Numeric estimates: 53/78.

| Provider/model | Family votes | Coding | General | Coding bands | General bands | Task fallback |
|---|---|---|---|---|---|---|
| api-airforce/google/gemma3-270m:free |  | — | — |  |  |  |
| gemini/lyria-3-clip-preview |  | — | — |  |  |  |
| gemini/lyria-3-pro-preview |  | — | — |  |  |  |
| groq/allam-2-7b |  | — | — |  |  |  |
| groq/canopylabs/orpheus-arabic-saudi |  | — | — |  |  |  |
| groq/canopylabs/orpheus-v1-english |  | — | — |  |  |  |
| groq/groq/compound |  | — | — |  |  |  |
| groq/groq/compound-mini |  | — | — |  |  |  |
| groq/llama-3.1-8b-instant | AA Coding=0.0652 | 0.0652 | 0.0787 | low | low |  |
| groq/llama-3.3-70b-versatile | AA Coding=0.1467 | 0.1467 | 0.0787 | low | low |  |
| groq/meta-llama/llama-4-scout-17b-16e-instruct | AA Coding=0.1033 | 0.1033 | 0.0730 | low | low |  |
| groq/meta-llama/llama-prompt-guard-2-22m |  | — | — |  |  |  |
| groq/meta-llama/llama-prompt-guard-2-86m |  | — | — |  |  |  |
| groq/openai/gpt-oss-120b | SWE-bench=0.1634, Terminal-Bench=0.0660, AA Coding=0.3641 | 0.1634 | 0.1685 | low | low |  |
| groq/openai/gpt-oss-20b | Terminal-Bench=0.0094, AA Coding=0.2663 | 0.1379 | 0.1461 | low | low |  |
| groq/openai/gpt-oss-safeguard-20b |  | — | — |  |  |  |
| groq/qwen/qwen3-32b | AA Coding=0.2174 | 0.2174 | 0.0787 | low | low |  |
| groq/qwen/qwen3.6-27b | SWE-bench=0.7381, Terminal-Bench=0.8019, AA Coding=0.7174 | 0.7381 | 0.3989 | mid,high | low |  |
| groq/qwen/qwen3.8-27b | DeepSWE=0.2969, SWE-bench=0.8500, Terminal-Bench=0.4200, AA Coding=0.7446 | 0.5823 | 0.6011 | mid | mid |  |
| groq/whisper-large-v3 |  | — | — |  |  |  |
| groq/whisper-large-v3-turbo |  | — | — |  |  |  |
| kilocode/cohere/north-mini-code:free | SWE-bench=0.3740, Terminal-Bench=0.4245, AA Coding=0.5054 | 0.4245 | 0.1517 | low | low |  |
| kilocode/dots-studio/dots-3-note-preview:free | SWE-bench=0.8810 | — | — |  |  |  |
| kilocode/kilo-auto/free |  | — | — |  |  |  |
| kilocode/liquid/lfm-2.5-2.6b:free | AA Coding=0.0815 | 0.0815 | 0.0787 | low | low |  |
| kilocode/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free | AA Coding=0.1576 | 0.1576 | 0.1573 | low | low |  |
| kilocode/nvidia/nemotron-3-super-120b-a12b:free | SWE-bench=0.5396, Terminal-Bench=0.3302, AA Coding=0.5109 | 0.5109 | 0.2584 | low,mid | low |  |
| kilocode/nvidia/nemotron-3-ultra-550b-a55b:free | SWE-bench=0.6198, Terminal-Bench=0.0600, AA Coding=0.6739 | 0.6198 | 0.4438 | mid | low |  |
| kilocode/nvidia/nemotron-3.5-content-safety:free |  | — | — |  |  |  |
| kilocode/nvidia/nemotron-3.5-lightning:free | AA Coding=0.4185 | 0.4185 | 0.2640 | low | low |  |
| kilocode/nvidia/nemotron-3.5-super-vl:free | DeepSWE=0.1000, SWE-bench=0.5000, Terminal-Bench=0.1800 | 0.1800 | 0.5674 | low | mid |  |
| kilocode/poolside/laguna-s-2.1:free | DeepSWE=0.3000, SWE-bench=0.8131, Terminal-Bench=0.3800 | 0.3800 | 0.3800 | low | low | coding_fallback |
| kilocode/poolside/laguna-xs-2.1:free | SWE-bench=0.1500, Terminal-Bench=0.4434 | 0.2967 | 0.2967 | low | low | coding_fallback |
| kilocode/reflection/beam-free | DeepSWE=0.5000, SWE-bench=0.9500, Terminal-Bench=0.7000 | 0.7000 | 0.7000 | mid,high | mid,high | coding_fallback |
| kilocode/stealth/glyph-cluster | DeepSWE=0.0156 | — | — |  |  |  |
| kilocode/xingchen-agi/xing4.0-29b-a4b:free | SWE-bench=0.5502, Terminal-Bench=0.1000 | 0.3251 | 0.3251 | low | low | coding_fallback |
| mistral/mistral-medium-3-5 | AA Coding=0.6359 | 0.6359 | 0.2865 | mid | low |  |
| nvidia/deepseek-ai/deepseek-v4.1-flash | DeepSWE=0.9844, Terminal-Bench=0.9800 | 0.9822 | 0.7528 | high | mid,high |  |
| nvidia/google/diffusiongemma-26b-a4b-it | AA Coding=0.2554 | 0.2554 | 0.1461 | low | low |  |
| nvidia/google/gemma-4-31b-it | AA Coding=0.5924 | 0.5924 | 0.2978 | mid | low |  |
| nvidia/meta/llama-3.2-11b-vision-instruct |  | 0.0337 | 0.0337 | low | low | general_fallback |
| nvidia/meta/llama-3.2-90b-vision-instruct |  | 0.0674 | 0.0674 | low | low | general_fallback |
| nvidia/meta/muse-glimmer-30b | AA Coding=0.6576 | 0.6576 | 0.3427 | mid | low |  |
| nvidia/nvidia/nemotron-3.5-lightning-30b-a3b | AA Coding=0.4185 | 0.4185 | 0.2640 | low | low |  |
| nvidia/nvidia/nemotron-3.5-super-vl-120b-a12b | DeepSWE=0.1000, SWE-bench=0.5000, Terminal-Bench=0.1800 | 0.1800 | 0.5674 | low | mid |  |
| nvidia/poolside/laguna-xs-2.1 | SWE-bench=0.1500, Terminal-Bench=0.4434 | 0.2967 | 0.2967 | low | low | coding_fallback |
| nvidia/stepfun-ai/step-5-preview |  | 0.8483 | 0.8483 | high | high | general_fallback |
| nvidia/z-ai/glm-5.3 | DeepSWE=0.8953, Terminal-Bench=0.9400, AA Coding=0.9620 | 0.9400 | 0.7584 | high | mid,high |  |
| nvidia/z-ai/glm-5.3-flash | DeepSWE=0.6859, Terminal-Bench=0.8200, AA Coding=0.9185 | 0.8200 | 0.8258 | high | high |  |
| opencode-zen/beam-free | DeepSWE=0.5000, SWE-bench=0.9500, Terminal-Bench=0.7000 | 0.7000 | 0.6573 | mid,high | mid |  |
| opencode-zen/big-pickle |  | — | — |  |  |  |
| opencode-zen/deepseek-v4.1-flash-free | DeepSWE=0.9844, Terminal-Bench=0.9800 | 0.9822 | 0.7528 | high | mid,high |  |
| opencode-zen/glm-5.3-flash-free | DeepSWE=0.6859, Terminal-Bench=0.8200, AA Coding=0.9185 | 0.8200 | 0.8258 | high | high |  |
| opencode-zen/longcat-2.5-preview-free |  | — | — |  |  |  |
| opencode-zen/mimo-v2.6-flash-free | DeepSWE=0.7969, Terminal-Bench=0.9000 | 0.8484 | 0.7247 | high | mid,high |  |
| opencode-zen/nemotron-3.5-lightning-free | AA Coding=0.4185 | 0.4185 | 0.2640 | low | low |  |
| opencode-zen/nemotron-3.5-super-vl-free | DeepSWE=0.1000, SWE-bench=0.5000, Terminal-Bench=0.1800 | 0.1800 | 0.5674 | low | mid |  |
| opencode-zen/space-bunny-free |  | — | — |  |  |  |
| openrouter/cohere/north-mini-code:free | SWE-bench=0.3740, Terminal-Bench=0.4245, AA Coding=0.5054 | 0.4245 | 0.1517 | low | low |  |
| openrouter/dots-studio/dots-3-note-preview:free | SWE-bench=0.8810 | — | — |  |  |  |
| openrouter/google/gemma-4-26b-a4b-it:free | AA Coding=0.5380 | 0.5380 | 0.3371 | low,mid | low |  |
| openrouter/google/gemma-4-31b-it:free | AA Coding=0.5924 | 0.5924 | 0.2978 | mid | low |  |
| openrouter/google/lyria-3-clip-preview |  | — | — |  |  |  |
| openrouter/google/lyria-3-pro-preview |  | — | — |  |  |  |
| openrouter/liquid/lfm-2.5-2.6b:free | AA Coding=0.0815 | 0.0815 | 0.0787 | low | low |  |
| openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free | AA Coding=0.1576 | 0.1576 | 0.1573 | low | low |  |
| openrouter/nvidia/nemotron-3-super-120b-a12b:free | SWE-bench=0.5396, Terminal-Bench=0.3302, AA Coding=0.5109 | 0.5109 | 0.2584 | low,mid | low |  |
| openrouter/nvidia/nemotron-3-ultra-550b-a55b:free | SWE-bench=0.6198, Terminal-Bench=0.0600, AA Coding=0.6739 | 0.6198 | 0.4438 | mid | low |  |
| openrouter/nvidia/nemotron-3.5-content-safety:free |  | — | — |  |  |  |
| openrouter/nvidia/nemotron-3.5-lightning:free | AA Coding=0.4185 | 0.4185 | 0.2640 | low | low |  |
| openrouter/nvidia/nemotron-3.5-super-vl:free | DeepSWE=0.1000, SWE-bench=0.5000, Terminal-Bench=0.1800 | 0.1800 | 0.5674 | low | mid |  |
| openrouter/openrouter/free |  | — | — |  |  |  |
| openrouter/poolside/laguna-s-2.1:free | DeepSWE=0.3000, SWE-bench=0.8131, Terminal-Bench=0.3800 | 0.3800 | 0.3800 | low | low | coding_fallback |
| openrouter/poolside/laguna-xs-2.1:free | SWE-bench=0.1500, Terminal-Bench=0.4434 | 0.2967 | 0.2967 | low | low | coding_fallback |
| openrouter/recursive/flint-v1.0:free | SWE-bench=0.8762, Terminal-Bench=0.0200 | 0.4481 | 0.4481 | low | low | coding_fallback |
| openrouter/thinkingmachines/inkling-small:free | SWE-bench=0.7676, AA Coding=0.7120 | 0.7398 | 0.5225 | mid,high | low,mid |  |
| openrouter/thinkingmachines/inkling:free | SWE-bench=0.7027, Terminal-Bench=0.2200, AA Coding=0.6902 | 0.6902 | 0.4775 | mid | low,mid |  |
| openrouter/xingchen-agi/xing4.0-29b-a4b:free | SWE-bench=0.5502, Terminal-Bench=0.1000 | 0.3251 | 0.3251 | low | low | coding_fallback |

## Reference model counts by benchmark/version

- DeepSWE (unspecified version): 5
- DeepSWE 1.1: 32
- SWE-bench Multilingual: 21
- SWE-bench Pro (unspecified version): 10
- SWE-bench Pro v2: 1
- SWE-bench Verified: 101
- SWE-bench Verified Mini (20-task fixed-seed subset): 1
- Terminal-Bench (unspecified version): 2
- Terminal-Bench 2.0: 53
- Terminal-Bench 2.1: 25
- Terminal-Bench 2.1 (14-task subset): 1
- Terminal-Bench 3.0: 2
- Terminal-Bench 4.0: 2

## Limits

Ranks pool observed effort/agent configurations, with one median per model. Candidate selection prefers exact effort; otherwise it is a marked proxy.
HF duplicates do not add votes. Unknown versions and small subsets stay separate. Cohorts with fewer than five model identities, including singleton subsets, do not supply a cross-model comparison or vote.
The snapshot populations are heterogeneous; this is a relative hypothesis, not measured success probability. Full per-vote raw scores, sources, reference sizes and proxy notes are in the JSON.

## Leave one coding family out

- AA Coding: 14 band changes; median absolute fitness change 0.022343749999999996
- SWE-bench: 16 band changes; median absolute fitness change 0.0
- Terminal-Bench: 12 band changes; median absolute fitness change 0.010351966873705987
- DeepSWE: 8 band changes; median absolute fitness change 0.0
