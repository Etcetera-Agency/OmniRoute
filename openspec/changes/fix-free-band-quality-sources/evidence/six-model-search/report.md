# Six-model benchmark search

Исследованы только опубликованные результаты для пяти разрешённых benchmark-групп. Дата поиска: 2026-10-25. Вызовов к моделям и запусков benchmark не было.

## Результаты

| Точная цель | Найдено | Результаты |
| --- | ---: | --- |
| `api-airforce/google/gemma3-270m:free` | 0/5 | Для 270M PT/IT результатов в заданных группах не найдено. |
| `groq/allam-2-7b` | 0/5 | Точных опубликованных результатов ALLaM2 7B не найдено. |
| `kilocode/stealth/glyph-cluster` | 1/5 | DeepSWE v1.1: 2.7% ± 0.7% pass@1, `xhigh`, mini-swe-agent 2.4.6. Это self-run; в официальном leaderboard отсутствует. Источник сообщает concurrency caveat для первых часов запуска. [Dataset card](https://huggingface.co/datasets/ProCreations/glyph-cluster-deepswe-traces). |
| `opencode-zen/big-pickle` | 2/5 | SWE-bench Verified Mini: 13/20 (65%). Terminal-Bench 2.1: 10/14 (71%). Оба результата — single-run малых подвыборок из стороннего отчёта, не полные официальные leaderboard прогоны. Harness: OpenCode 1.18.33. [Отчёт автора](https://fellipesoares.com.br/en/opencode-stealth-models-benchmarks/). |
| `opencode-zen/longcat-2.5-preview-free` | 0/5 | Точных результатов LongCat 2.5 Preview не найдено; LongCat 2.0 не использовался. |
| `opencode-zen/space-bunny-free` | 0/5 | Точных результатов для alias не найдено. Результат MiniMax M3.1 Flash не перенесён на Space Bunny. |

Итого: 3 найденных записи в 3 группах из 30 проверок. Все `not_found` сопровождаются поисковыми URL и точными поисковыми запросами в model JSON. Чужие benchmark и метрики в данные не включены.

## Structured output

Вывод исследования **не был server-enforced structured output**. Шесть встроенных collaboration agents получили JSON-контракт в инструкции; их файлы затем проверены lead против `schema.json`. `collaboration.spawn_agent` не принимает output schema или `response_format` параметр.

В проверенном OmniRoute worktree `POST /v1/search` — endpoint нормализованного поиска: он валидирует входной body через `v1SearchSchema`, выполняет search provider и возвращает JSON поисковых данных. Это не schema-constrained LLM response. См. [route.ts](/srv/projects/hermes/.worktrees/free-band-modeldev-sync/src/app/api/v1/search/route.ts:122) и [apiV1.ts](/srv/projects/hermes/.worktrees/free-band-modeldev-sync/src/shared/validation/schemas/apiV1.ts:586).

В Hermes candidate агентский JSON Schema adapter выставляет `strict: false`; для заранее известных несовместимых маршрутов клиент убирает `response_format`. Следовательно, данный код не доказывает принудительное соблюдение схемы провайдером. См. [plugin_llm.py](/srv/projects/hermes/nomadic-sdk/.candidate/hermes-agent/agent/plugin_llm.py:403) и [auxiliary_structured_output.py](/srv/projects/hermes/nomadic-sdk/.candidate/hermes-agent/agent/auxiliary_structured_output.py:90).

Машинная оценка этого workflow в [report.json](report.json): `native_agent_contract_only`.

## Проверка файлов

- Все 6 отдельных JSON прошли проверку по `$defs.target`.
- Consolidated `report.json` прошёл `schema.json` Draft 2020-12; содержит ровно 6 точных model IDs и ровно 5 benchmark-групп на цель.
- Search logs присутствуют для всех 30 model × benchmark групп.
